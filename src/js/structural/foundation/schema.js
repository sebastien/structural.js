
// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Serializable representation of an edit intent or action.
class EditorCommand {
	constructor(type, options = {}) {
		this.type = type;
		this.actor = options.actor ?? null;
		this.args = options.args ?? {};
		this.selection = options.selection ?? null;
		this.mode = options.mode ?? null;
		this.meta = options.meta ?? {};
	}

	static from(value, defaults = {}) {
		if (!value) return null;
		if (value instanceof EditorCommand) return value.with(defaults);
		if (typeof value === "string") {
			const [type, ...parts] = value.split(":");
			return new EditorCommand(type, {
				...defaults,
				args: { ...(defaults.args ?? {}), value: parts.join(":") },
			});
		}
		if (typeof value === "function") return value;
		return new EditorCommand(value.type, {
			...defaults,
			...value,
			args: { ...(defaults.args ?? {}), ...(value.args ?? {}) },
			meta: { ...(defaults.meta ?? {}), ...(value.meta ?? {}) },
		});
	}

	with(overrides = {}) {
		return new EditorCommand(this.type, {
			actor: overrides.actor ?? this.actor,
			args: { ...this.args, ...(overrides.args ?? {}) },
			selection: overrides.selection ?? this.selection,
			mode: overrides.mode ?? this.mode,
			meta: { ...this.meta, ...(overrides.meta ?? {}) },
		});
	}

	toJSON() {
		return {
			type: this.type,
			actor: this.actor,
			args: this.args,
			selection: this.selection,
			mode: this.mode,
			meta: this.meta,
		};
	}
}

export { EditorCommand };

// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Records the lifecycle, modified steps, and outcome of dispatching a command.
class EditorTransaction {
	constructor(command, options = {}) {
		this.command = command;
		this.steps = options.steps ?? [];
		this.inverse = options.inverse ?? [];
		this.selectionBefore = options.selectionBefore ?? null;
		this.selectionAfter = options.selectionAfter ?? null;
		this.result = options.result ?? false;
	}

	get handled() {
		return this.result !== false;
	}

	toJSON() {
		return {
			command: this.command?.toJSON?.() ?? this.command,
			steps: this.steps,
			inverse: this.inverse,
			selectionBefore: this.selectionBefore,
			selectionAfter: this.selectionAfter,
			result: this.result,
		};
	}
}

export { EditorTransaction };

// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License


// Schema-driven parser that sanitizes, unwraps, and repairs structural DOM trees.
class EditorNormalizer {
	constructor(schema, options = {}) {
		this.schema = schema;
		this.options = options;
	}

	normalize(target, context = {}) {
		const root = context.root ?? context.editor?.root ?? target;
		const command = new EditorCommand("normalize", {
			actor: context.session?.actor ?? context.actor ?? null,
			meta: { target: this.schema.tag(target) ?? "#node" },
		});
		const transaction = new EditorTransaction(command, { result: false });
		const normalized = this.normalizeNode(target, root, transaction);
		if (normalized?.nodeType === Node.ELEMENT_NODE) this.normalizeEmpty(normalized, root, transaction);
		transaction.result = transaction.steps.length > 0;
		return transaction;
	}

	normalizeNode(node, root, transaction) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return node;
		node = this.renameAlias(node, transaction);
		this.pruneEmptyTextChildren(node, transaction);
		for (const child of [...node.childNodes]) {
			if (!child.isConnected) continue;
			let normalizedChild = child;
			if (normalizedChild.nodeType === Node.ELEMENT_NODE) {
				normalizedChild = this.normalizeNode(normalizedChild, root, transaction);
				if (!normalizedChild?.isConnected) continue;
			}
			this.normalizeChild(node, normalizedChild, root, transaction);
		}
		this.normalizeEmpty(node, root, transaction);
		return node;
	}

	renameAlias(node, transaction) {
		const alias = this.schema.aliasFor(node);
		if (!alias || this.schema.tag(node) === alias) return node;
		const next = document.createElement(alias);
		while (node.firstChild) next.appendChild(node.firstChild);
		for (const attr of node.attributes) next.setAttribute(attr.name, attr.value);
		node.replaceWith(next);
		transaction.steps.push({ type: "renameElement", from: node.tagName.toLowerCase(), to: alias });
		return next;
	}

	pruneEmptyTextChildren(node, transaction) {
		if (!this.schema.options.normalize?.pruneEmptyText) return;
		for (const child of [...node.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) {
				child.remove();
				transaction.steps.push({ type: "removeEmptyText" });
			}
		}
	}

	normalizeChild(parent, child, root, transaction) {
		const parentTag = this.schemaTag(parent, root);
		const childTag = this.schema.tag(child);
		if (childTag === "br" || this.schema.contains(parentTag, childTag)) return;
		if (child.nodeType === Node.TEXT_NODE) {
			this.normalizeText(parent, child, root, transaction);
			return;
		}
		if (child.nodeType !== Node.ELEMENT_NODE || this.schema.isAtom?.(child) || childTag.includes("-")) {
			return;
		}
		const action = this.schema.rule(childTag)
			? this.schema.normalizeAction(parentTag, "invalidChild", "preserve")
			: (this.schema.options.normalize?.unknownElement ?? "unwrap");
		this.applyInvalidAction(parent, child, action, root, transaction);
	}

	normalizeText(parent, child, root, transaction) {
		if (child.data.length === 0) return;
		const parentTag = this.schemaTag(parent, root);
		if (!this.schema.contains(parentTag, "#text") && child.data.trim() === "") {
			child.remove();
			transaction.steps.push({ type: "pruneWhitespace" });
			return;
		}
		const action = this.schema.normalizeAction(parentTag, "text", "preserve");
		if (action === "prune") {
			child.remove();
			transaction.steps.push({ type: "pruneText" });
		} else if (action === "wrap") {
			const wrapper = document.createElement(this.schema.defaultChild(parentTag));
			parent.insertBefore(wrapper, child);
			wrapper.appendChild(child);
			transaction.steps.push({ type: "wrapText", tag: wrapper.tagName.toLowerCase() });
		}
	}

	applyInvalidAction(parent, child, action, root, transaction) {
		if (action === "prune") {
			child.remove();
			transaction.steps.push({ type: "pruneNode", tag: this.schema.tag(child) });
		} else if (action === "unwrap") {
			this.unwrapElement(child);
			transaction.steps.push({ type: "unwrapNode", tag: this.schema.tag(child) });
		} else if (action === "wrap") {
			const wrapper = document.createElement(this.schema.defaultChild(this.schemaTag(parent, root)));
			parent.insertBefore(wrapper, child);
			wrapper.appendChild(child);
			transaction.steps.push({
				type: "wrapNode",
				tag: this.schema.tag(child),
				wrapper: wrapper.tagName.toLowerCase(),
			});
		} else if (action === "lift") {
			parent.parentNode?.insertBefore(child, parent.nextSibling);
			transaction.steps.push({ type: "liftNode", tag: this.schema.tag(child) });
		}
	}

	normalizeEmpty(node, root, transaction) {
		if (node.nodeType !== Node.ELEMENT_NODE || !this.isEmpty(node)) return;
		const tag = this.schemaTag(node, root);
		const action = this.schema.normalizeAction(tag, "empty", "preserve");
		if (action === "prune" && node.parentNode) {
			node.remove();
			transaction.steps.push({ type: "pruneEmpty", tag });
		} else if (action === "fill") {
			const child = document.createElement(this.schema.defaultChild(tag));
			node.appendChild(child);
			this.normalizeEmpty(child, root, transaction);
			transaction.steps.push({ type: "fillEmpty", tag });
		} else if (action === "placeholder") {
			const placeholders = [...node.childNodes].filter(
				(child) => child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br",
			);
			if (placeholders.length === 0) node.appendChild(document.createElement("br"));
			else if (placeholders.length > 1 || placeholders.length !== node.childNodes.length) {
				node.replaceChildren(document.createElement("br"));
			}
			transaction.steps.push({ type: "placeholder", tag });
		} else if (action === "unwrap" && node.parentNode) {
			this.unwrapElement(node);
			transaction.steps.push({ type: "unwrapEmpty", tag });
		}
	}

	schemaTag(node, root) {
		return node === root ? ":root" : this.schema.tag(node);
	}

	isEmpty(node) {
		return [...node.childNodes].every(
			(child) =>
				(child.nodeType === Node.TEXT_NODE && child.data.length === 0) ||
				(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br"),
		);
	}

	unwrapElement(node) {
		const parent = node.parentNode;
		while (node.firstChild) parent.insertBefore(node.firstChild, node);
		node.remove();
	}
}

export { EditorNormalizer };

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: schema
// Schema validation, normalization, and serializable command/transaction types.


// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: EditorSchema
// Defines structural validation, normalization, and element rules for the editor.
// - rules: Object - map of tag names to structural rules
// - options: Object - configuration settings
class EditorSchema {
	// Method: constructor
	// Initializes the `EditorSchema` with rules and options.
	constructor(rules = {}, options = {}) {
		this.rules = rules;
		this.options = options;
		/* atoms: list of opaque tags (e.g. "aos-ref") preserved by normalizer and skipped in positions */
		this._atomTags = new Set(
			(options.atoms || [])
				.map((t) => (typeof t === "string" ? t.toLowerCase() : t))
				.filter(Boolean),
		);
	}

	// Method: rule
	// Gets the rule associated with a specific tag name or DOM node.
	rule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return tag ? (this.rules[tag] ?? null) : null;
	}

	// Method: renderHint
	// Gets render metadata associated with a specific tag name or DOM node.
	renderHint(nodeOrTag) {
		return this.rule(nodeOrTag)?.render ?? null;
	}

	// Method: renderHintValue
	// Resolves a single render metadata key for a tag name or DOM node.
	renderHintValue(nodeOrTag, key, fallback = undefined) {
		const hint = this.renderHint(nodeOrTag);
		return hint && key in hint ? hint[key] : fallback;
	}

	// Method: isEmpty
	// Checks if the schema has no rules configured.
	isEmpty() {
		return Object.keys(this.rules).length === 0;
	}

	// Method: tag
	// Resolves the normalized tag name representing the given node or string.
	tag(nodeOrTag) {
		if (!nodeOrTag) return null;
		if (typeof nodeOrTag === "string") return nodeOrTag;
		if (nodeOrTag.nodeType === Node.TEXT_NODE) return "#text";
		return nodeOrTag.tagName?.toLowerCase() ?? null;
	}

	// Method: group
	// Gets the list of tags belonging to a defined group.
	group(name) {
		return Array.isArray(this.rules[name]) ? this.rules[name] : [];
	}

	// Method: expand
	// Expands group references (starting with '@') into full lists of tags.
	expand(items = []) {
		const expanded = [];
		for (const item of items) {
			if (typeof item === "string" && item.startsWith("@")) {
				expanded.push(...this.group(item));
			} else {
				expanded.push(item);
			}
		}
		return expanded;
	}

	// Method: contains
	// Verifies if the schema allows `child` inside `parent`.
	contains(parent, child) {
		const rule = this.rule(parent);
		if (!rule?.contains) return false;
		const t = this.tag(child);
		const exp = this.expand(rule.contains);
		if (this.isAtom(child) && (exp.includes("@inline") || exp.includes(t))) return true;
		return exp.includes(t);
	}

	// Method: defaultChild
	// Resolves the default child tag for a given parent.
	defaultChild(parent, fallback = "p") {
		return this.rule(parent)?.default ?? fallback;
	}

	// Method: aliasFor
	// Retrieves the schema alias for a specific tag name.
	aliasFor(tag) {
		return this.options.aliases?.[this.tag(tag)] ?? null;
	}

	/* Method: isAtom
	 * Returns true if tag/node is an opaque atom per schema options.atoms. */
	isAtom(nodeOrTag) {
		const t = this.tag(nodeOrTag);
		if (!t) return false;
		if (this._atomTags.has(t)) return true;
		return false;
	}

	// Method: normalizeRule
	// Gets the normalization rules configured for a tag.
	normalizeRule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return {
			...(this.options.normalize ?? {}),
			...(tag ? (this.rule(tag)?.normalize ?? {}) : {}),
		};
	}

	// Method: normalizeAction
	// Resolves the normalization action for a tag under a specific condition.
	normalizeAction(nodeOrTag, condition, fallback = "preserve") {
		return this.normalizeRule(nodeOrTag)?.[condition] ?? fallback;
	}

	// Method: enterRule
	// Resolves behavior rules associated with Enter keypress on a tag.
	enterRule(nodeOrTag) {
		return this.rule(nodeOrTag)?.enter ?? {};
	}

	// Method: enterNext
	// Determines the next tag to spawn on Enter press.
	enterNext(nodeOrTag, parent = null, fallback = "p") {
		const next = this.enterRule(nodeOrTag).next ?? "parentDefault";
		if (next === "same") return this.tag(nodeOrTag) ?? fallback;
		if (next === "rootDefault") return this.defaultChild(":root", fallback);
		if (next === "parentDefault") {
			const parentTag = parent === null ? ":root" : this.tag(parent);
			return this.defaultChild(parentTag ?? ":root", fallback);
		}
		return next;
	}

	// Method: type
	// Gets the structural type of a tag ("block", "inline", etc.).
	type(tag) {
		return this.rule(tag)?.type ?? null;
	}

	// Method: isBlock
	// Checks if a tag is a block-level element.
	isBlock(tag) {
		return this.type(tag) === "block";
	}

	// Method: isInline
	// Checks if a tag is an inline element.
	isInline(tag) {
		return this.type(tag) === "inline";
	}

	// Method: tagsOfType
	// Collects all tags configured for a specific type.
	tagsOfType(type) {
		return Object.entries(this.rules)
			.filter(([tag, rule]) => !tag.startsWith("@") && rule?.type === type)
			.map(([tag]) => tag);
	}

	// Method: tagsWithRenderHint
	// Collects tags whose render metadata contains `key`, optionally matching `value`.
	tagsWithRenderHint(key, value = undefined) {
		return Object.entries(this.rules)
			.filter(([tag, rule]) => {
				if (tag.startsWith("@") || !rule?.render || !(key in rule.render)) return false;
				return value === undefined ? true : rule.render[key] === value;
			})
			.map(([tag]) => tag);
	}

	// Method: selector
	// Returns a CSS selector targeting all tags of the specified type.
	selector(type) {
		return this.tagsOfType(type).join(", ");
	}

	// Method: allowsInline
	// Verifies if an inline tag is allowed within a specific context.
	allowsInline(tag, context = {}) {
		if (this.isEmpty()) return true;
		const block = context.block ?? context.parent;
		return this.isInline(tag) && (!block || this.contains(block, tag));
	}

	// Method: allowsBlock
	// Verifies if a block tag is allowed within a specific context.
	allowsBlock(tag, context = {}) {
		if (this.isEmpty()) return true;
		if (!this.isBlock(tag)) return false;
		const parent = context.parent ?? context.root;
		if (!parent) return true;
		const parentTag = parent === context.root ? ":root" : this.tag(parent);
		return this.contains(parentTag, tag);
	}
}

export { EditorSchema };
