// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: editor
// Implements core editor orchestration, schemas, commands, transactions, and event listeners.

import { Cursor as EditorCursor } from "./cursor.js";
import { EditorRangeController } from "./range.js";
import { EditorSelectionController } from "./selection.js";
import { TextAdapter } from "./text.js";

// Function: editorKeymap
// Returns the built-in editing keys. Use this helper to compose custom maps.
function editorKeymap(overrides = {}) {
	return {
		ArrowLeft: { type: "moveCursor", args: { direction: "left" } },
		ArrowRight: { type: "moveCursor", args: { direction: "right" } },
		ArrowUp: { type: "moveCursor", args: { direction: "up" } },
		ArrowDown: { type: "moveCursor", args: { direction: "down" } },
		"Shift+ArrowLeft": { type: "moveCursor", args: { direction: "left", extend: true } },
		"Shift+ArrowRight": { type: "moveCursor", args: { direction: "right", extend: true } },
		"Shift+ArrowUp": { type: "moveCursor", args: { direction: "up", extend: true } },
		"Shift+ArrowDown": { type: "moveCursor", args: { direction: "down", extend: true } },
		"Mod+A": { type: "selectStructuralScope", args: { mode: "expand" } },
		"Mod+Shift+A": { type: "selectStructuralScope", args: { mode: "contract" } },
		"Mod+ArrowLeft": { type: "moveStructural", args: { direction: "left" } },
		"Mod+ArrowRight": { type: "moveStructural", args: { direction: "right" } },
		"Mod+ArrowUp": { type: "moveStructural", args: { direction: "up" } },
		"Mod+ArrowDown": { type: "moveStructural", args: { direction: "down" } },
		"Mod+Shift+ArrowLeft": { type: "moveStructural", args: { direction: "left", extend: true } },
		"Mod+Shift+ArrowRight": { type: "moveStructural", args: { direction: "right", extend: true } },
		"Mod+Shift+ArrowUp": { type: "moveStructural", args: { direction: "up", extend: true } },
		"Mod+Shift+ArrowDown": { type: "moveStructural", args: { direction: "down", extend: true } },
		Tab: { type: "moveTraversal", args: { direction: "forward" } },
		"Shift+Tab": { type: "moveTraversal", args: { direction: "backward" } },
		Backspace: { type: "deleteBackward" },
		Delete: { type: "deleteForward" },
		...overrides,
	};
}

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

// Class: EditorAdapter
// Base class for editor adapters (implementation stub).
class EditorAdapter {}

// Class: EditorCommand
// Represents a serializable representation of an edit intent or action.
// - type: string - the command type
// - args: Object - arguments dictionary
class EditorCommand {
	// Method: constructor
	// Initializes the command instance.
	constructor(type, options = {}) {
		this.type = type;
		this.actor = options.actor ?? null;
		this.args = options.args ?? {};
		this.selection = options.selection ?? null;
		this.mode = options.mode ?? null;
		this.meta = options.meta ?? {};
	}

	// Method: from
	// Coerces or parses a value into a structured `EditorCommand` instance.
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

	// Method: with
	// Clones the command applying specified overrides.
	with(overrides = {}) {
		return new EditorCommand(this.type, {
			actor: overrides.actor ?? this.actor,
			args: { ...this.args, ...(overrides.args ?? {}) },
			selection: overrides.selection ?? this.selection,
			mode: overrides.mode ?? this.mode,
			meta: { ...this.meta, ...(overrides.meta ?? {}) },
		});
	}

	// Method: toJSON
	// Serializes the command details into a JSON-compatible object.
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

// Class: EditorTransaction
// Records the lifecycle, modified steps, and outcome of dispatching a command.
// - command: EditorCommand - parent command
// - steps: Array - recorded steps
class EditorTransaction {
	// Method: constructor
	// Initializes the transaction.
	constructor(command, options = {}) {
		this.command = command;
		this.steps = options.steps ?? [];
		this.inverse = options.inverse ?? [];
		this.selectionBefore = options.selectionBefore ?? null;
		this.selectionAfter = options.selectionAfter ?? null;
		this.result = options.result ?? false;
	}

	// Property: handled
	// Determines if the transaction succeeded.
	get handled() {
		return this.result !== false;
	}

	// Method: toJSON
	// Serializes transaction steps into a JSON object.
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

// Class: EditorNormalizer
// Schema-driven parser that sanitizes, unwraps, and repairs structural DOM trees.
// - schema: EditorSchema - the rule definition source
class EditorNormalizer {
	// Method: constructor
	// Initializes the EditorNormalizer.
	constructor(schema, options = {}) {
		this.schema = schema;
		this.options = options;
	}

	// Method: normalize
	// Performs in-place DOM structural repairs on the target element.
	normalize(target, context = {}) {
		this.root = context.root ?? context.editor?.root ?? target;
		const command = new EditorCommand("normalize", {
			actor: context.session?.actor ?? context.actor ?? null,
			meta: { target: this.schema.tag(target) ?? "#node" },
		});
		const transaction = new EditorTransaction(command, { result: false });
		this.normalizeNode(target, context, transaction);
		if (target.nodeType === Node.ELEMENT_NODE) this.normalizeEmpty(target, transaction);
		transaction.result = transaction.steps.length > 0;
		return transaction;
	}

	// Method: normalizeNode
	// Internal helper to recursively normalize a target node and its children.
	normalizeNode(node, context, transaction) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
		this.renameAlias(node, transaction);
		this.pruneEmptyTextChildren(node, transaction);

		for (const child of [...node.childNodes]) {
			if (!child.isConnected) continue;
			if (child.nodeType === Node.ELEMENT_NODE) {
				this.normalizeNode(child, context, transaction);
				if (!child.isConnected) continue;
			}
			this.normalizeChild(node, child, transaction);
		}

		this.normalizeEmpty(node, transaction);
	}

	// Method: renameAlias
	// Renames an element if it matches a configured schema alias.
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

	// Method: pruneEmptyTextChildren
	// Deletes any empty DOM Text nodes immediately childed to the element.
	pruneEmptyTextChildren(node, transaction) {
		if (!this.schema.options.normalize?.pruneEmptyText) return;
		for (const child of [...node.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) {
				child.remove();
				transaction.steps.push({ type: "removeEmptyText" });
			}
		}
	}

	/* Method: normalizeChild
	 * Keeps atoms and unknown custom elements; otherwise applies schema actions. */
	normalizeChild(parent, child, transaction) {
		const parentTag = this.schemaTag(parent);
		const childTag = this.schema.tag(child);
		if (childTag === "br") return;
		if (this.schema.contains(parentTag, childTag)) return;

		if (child.nodeType === Node.TEXT_NODE) {
			this.normalizeText(parent, child, transaction);
			return;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) return;
		if (this.schema.isAtom?.(child) || childTag.includes("-")) {
			return;
		}
		const known = !!this.schema.rule(childTag);
		const action = known
			? this.schema.normalizeAction(parentTag, "invalidChild", "preserve")
			: (this.schema.options.normalize?.unknownElement ?? "unwrap");
		this.applyInvalidAction(parent, child, action, transaction);
	}

	// Method: normalizeText
	// Validates and wraps or prunes loose DOM text nodes.
	normalizeText(parent, child, transaction) {
		if (child.data.length === 0) return;
		const parentTag = this.schemaTag(parent);
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

	// Method: applyInvalidAction
	// Executes designated schema-driven correction actions on an invalid child.
	applyInvalidAction(parent, child, action, transaction) {
		if (action === "prune") {
			child.remove();
			transaction.steps.push({ type: "pruneNode", tag: this.schema.tag(child) });
		} else if (action === "unwrap") {
			this.unwrapElement(child);
			transaction.steps.push({ type: "unwrapNode", tag: this.schema.tag(child) });
		} else if (action === "wrap") {
			const wrapper = document.createElement(this.schema.defaultChild(this.schemaTag(parent)));
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

	// Method: normalizeEmpty
	// Resolves correct empty block behavior (filling, placing placeholder br, pruning, etc).
	normalizeEmpty(node, transaction) {
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		if (!this.isEmpty(node)) return;
		const tag = this.schemaTag(node);
		const action = this.schema.normalizeAction(tag, "empty", "preserve");
		if (action === "prune" && node.parentNode) {
			node.remove();
			transaction.steps.push({ type: "pruneEmpty", tag });
		} else if (action === "fill") {
			const child = document.createElement(this.schema.defaultChild(tag));
			node.appendChild(child);
			this.normalizeEmpty(child, transaction);
			transaction.steps.push({ type: "fillEmpty", tag });
		} else if (action === "placeholder") {
			const placeholders = [...node.childNodes].filter(
				(child) => child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br",
			);
			if (placeholders.length === 0) {
				node.appendChild(document.createElement("br"));
			} else if (placeholders.length > 1 || placeholders.length !== node.childNodes.length) {
				node.replaceChildren(document.createElement("br"));
			}
			transaction.steps.push({ type: "placeholder", tag });
		} else if (action === "unwrap" && node.parentNode) {
			this.unwrapElement(node);
			transaction.steps.push({ type: "unwrapEmpty", tag });
		}
	}

	// Method: schemaTag
	// Resolves schema key tag name for target node.
	schemaTag(node) {
		return node === this.root ? ":root" : this.schema.tag(node);
	}

	// Method: isEmpty
	// Checks if the node contains only empty text or placeholder line breaks.
	isEmpty(node) {
		return [...node.childNodes].every(
			(child) =>
				(child.nodeType === Node.TEXT_NODE && child.data.length === 0) ||
				(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br"),
		);
	}

	// Method: unwrapElement
	// Unwraps target DOM node contents into its parent and removes target.
	unwrapElement(node) {
		const parent = node.parentNode;
		while (node.firstChild) parent.insertBefore(node.firstChild, node);
		node.remove();
	}
}

// Class: EditorSession
// Encapsulates a distinct user or collaborative session within a structural Editor.
// - editor: Editor - the parent editor
// - id: string - unique session identifier
class EditorSession {
	// Method: constructor
	// Initializes a session tracking session state, cursors, and trackers.
	constructor(editor, id, options = {}) {
		this.editor = editor;
		this.id = id;
		this.actor = options.actor ?? id;
		this.mode = options.mode ?? "insert";
		const caretOpt =
			options.caret !== undefined ? options.caret : options.cursor?.caret;
		const selOpt =
			options.selection !== undefined
				? options.selection
				: options.cursor?.selection;
		const wantNativeCaret = caretOpt === "native" || (caretOpt && caretOpt.mode === "native");
		const wantNativeSel = selOpt === "native" || (selOpt && selOpt.mode === "native");
		this.nativeSelection =
			options.nativeSelection ?? (wantNativeCaret || wantNativeSel ? "sync" : "none");
		this.currentBlock = null;
		const cursorOpts = { ...(options.cursor || {}) };
		if (options.caret !== undefined) {
			cursorOpts.caret = options.caret;
		} else if (options.cursor && options.cursor.caret !== undefined) {
			cursorOpts.caret = options.cursor.caret;
		}
		if (options.selection !== undefined) {
			cursorOpts.selection = options.selection;
		} else if (options.cursor && options.cursor.selection !== undefined) {
			cursorOpts.selection = options.cursor.selection;
		}
		// also allow session-level caret/selection to be picked up by Cursor
		if (options.caret !== undefined && cursorOpts.caret === undefined)
			cursorOpts.caret = options.caret;
		if (options.selection !== undefined && cursorOpts.selection === undefined)
			cursorOpts.selection = options.selection;
		this.cursor = new EditorCursor(this, cursorOpts);
		this.classes = options.classes
			? new EditorClassController(this, options.classes).attach()
			: null;
	}

	// Property: root
	// Gets editor container element.
	get root() {
		return this.editor.root;
	}

	// Property: text
	// Gets document text adapter.
	get text() {
		return this.editor.text;
	}

	// Method: destroy
	// Detaches event listeners and class trackers for session clean up.
	destroy() {
		this.classes?.detach();
		this.cursor?.caret?.destroy?.();
		this.cursor?.selection?.overlay?.destroy?.();
	}

	// Method: snapshotSelection
	// Records a serializable snapshot of the current cursor selection state.
	snapshotSelection() {
		// ensure current window before snapshot
		this.text.ensurePositions();
		return {
			offset: this.cursor.offset ?? 0,
			selectionKind: this.cursor.selectionKind,
			anchorOffset: this.cursor.anchor
				? this.text.indexOfPoint({ node: this.cursor.anchor, offset: 0 })
				: -1,
		};
	}

	// Method: command
	// Factory to construct structured commands contextualized for the session.
	command(value, options = {}) {
		return EditorCommand.from(value, {
			actor: this.actor,
			mode: this.mode,
			selection: this.snapshotSelection(),
			...options,
		});
	}

	// Method: action
	// Directly triggers a pre-registered command action.
	action(spec, event = null) {
		return this.editor.action(spec, { event, session: this });
	}

	// Method: dispatch
	// Dispatches a command to the parent editor.
	dispatch(command, options = {}) {
		return this.editor.dispatch(command, { ...options, session: this });
	}
}

// Class: EditorClassController
// Monitors cursor location to dynamically attach CSS focus and selection classes on elements.
// - state: Object - map of tracking elements
class EditorClassController {
	// Method: constructor
	// Initializes the EditorClassController.
	constructor(target, options = {}) {
		this.session = target instanceof EditorSession ? target : null;
		this.editor = this.session?.editor ?? target;
		this.options = options;
		this._onSelectionChange = this.update.bind(this);
		this._onCursorMove = this.update.bind(this);
		this.state = {
			focus: new Set(),
			focusWithin: new Set(),
			selected: new Set(),
			selectedWithin: new Set(),
		};
	}

	// Method: attach
	// Registers event listeners to trigger automatic CSS class tracking.
	attach() {
		document.addEventListener("selectionchange", this._onSelectionChange);
		this.editor.root.addEventListener("CursorMove", this._onCursorMove);
		this.update();
		return this;
	}

	// Method: detach
	// Removes event listeners and cleans up all active focus/selection CSS classes.
	detach() {
		document.removeEventListener("selectionchange", this._onSelectionChange);
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		for (const key of Object.keys(this.state)) {
			for (const node of this.state[key]) node.classList.remove(this.className(key));
			this.state[key].clear();
		}
		return this;
	}

	// Method: className
	// Resolves custom or standard class name for target status category.
	className(key) {
		return this.options[key] ?? key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
	}

	// Method: selector
	// Resolves selection elements matching active block/inline tag names.
	selector() {
		const tracked = this.editor.schema?.tagsWithRenderHint("track", true)?.join(", ");
		const selector =
			this.options.selector ??
			[this.editor.schema?.selector("block"), this.editor.schema?.selector("inline")].filter(
				Boolean,
			);
		if (Array.isArray(selector)) {
			return [...selector, tracked].filter(Boolean).join(", ");
		}
		return [selector, tracked].filter(Boolean).join(", ");
	}

	// Method: trackedFor
	// Finds the nearest ancestor matching registered schema block/inline tags.
	trackedFor(node) {
		const selector = this.selector();
		if (!selector) return null;
		const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const tracked = el?.closest(selector);
		return tracked && this.editor.root.contains(tracked) ? tracked : null;
	}

	// Method: trackedAncestors
	// Recursively gathers matching parent nodes up to editor root.
	trackedAncestors(node) {
		const selector = this.selector();
		if (!selector) return [];
		const ancestors = [];
		let current = node?.parentElement?.closest(selector) ?? null;
		while (current && this.editor.root.contains(current)) {
			ancestors.push(current);
			current = current.parentElement?.closest(selector) ?? null;
		}
		return ancestors;
	}

	// Method: rangeWithinEditor
	// Checks if the given range is safely enclosed in editor root.
	rangeWithinEditor(range) {
		return this.editor.range.within(this.editor.root, range);
	}

	// Method: selectedNodes
	// Calculates the list of elements overlapping with the active selection.
	selectedNodes() {
		const selector = this.selector();
		const nodes = new Set();
		const cursor = this.session?.cursor ?? this.editor.input.cursor;
		if (!selector) return nodes;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const tracked = this.trackedFor(cursor.selectedNode);
			if (tracked) nodes.add(tracked);
			return nodes;
		}

		let range = null;
		if (cursor.selectionKind === "range") range = cursor.selection.toDomRange();
		const nativeSelection = window.getSelection();
		if (
			(!range || range.collapsed) &&
			nativeSelection?.rangeCount > 0 &&
			!nativeSelection.isCollapsed
		) {
			const nativeRange = nativeSelection.getRangeAt(0);
			if (this.rangeWithinEditor(nativeRange)) range = nativeRange;
		}
		if (!range || range.collapsed || !this.rangeWithinEditor(range)) return nodes;

		const candidates = [];
		for (const tracked of this.editor.root.querySelectorAll(selector)) {
			if (range.intersectsNode(tracked)) candidates.push(tracked);
		}
		for (const tracked of candidates) {
			const hasIntersectingChild = candidates.some(
				(candidate) => candidate !== tracked && tracked.contains(candidate),
			);
			if (!hasIntersectingChild) nodes.add(tracked);
		}
		return nodes;
	}

	// Method: update
	// Automatically recalculates active focus/selection lists and modifies DOM classes.
	update() {
		const cursor = this.session?.cursor ?? this.editor.input.cursor;
		const nextState = {
			focus: new Set(),
			focusWithin: new Set(),
			selected: this.selectedNodes(),
			selectedWithin: new Set(),
		};

		const focused = this.trackedFor(cursor.anchor);
		if (focused) {
			nextState.focus.add(focused);
			for (const ancestor of this.trackedAncestors(focused)) nextState.focusWithin.add(ancestor);
		}
		for (const tracked of nextState.selected) {
			for (const ancestor of this.trackedAncestors(tracked)) nextState.selectedWithin.add(ancestor);
		}

		for (const key of Object.keys(this.state)) {
			const className = this.className(key);
			for (const node of this.state[key]) {
				if (!nextState[key].has(node)) node.classList.remove(className);
			}
			for (const node of nextState[key]) {
				if (!this.state[key].has(node)) node.classList.add(className);
			}
			this.state[key] = nextState[key];
		}
	}
}

// Class: EditorTextInput
// Keyboard and Mouse listener translating raw user inputs to structural cursor operations.
// - session: EditorSession - associated editor session
class EditorTextInput {
	// Method: constructor
	// Initializes inputs and binds event listeners to the document.
	constructor(editor, options = {}) {
		this._onKeyUp = this.onKeyUp.bind(this);
		this._onKeyDown = this.onKeyDown.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		this._onMouseMove = this.onMouseMove.bind(this);
		this._onMouseUp = this.onMouseUp.bind(this);
		this._onSelectionChange = this.onSelectionChange.bind(this);
		this._dragAnchor = null;
		this._dragFocus = null;
		// While true, ignore collapsed browser carets (click placement is often off-by-one
		// vs our point resolution). Cleared after mouseup re-asserts structural→native.
		this._suppressCollapsedNative = false;
		this._syncingNative = false;
		let c = options.caret;
		if (c === undefined) c = options.cursor?.caret;
		if (typeof c === "string") c = { mode: c };
		let s = options.selection;
		if (s === undefined) s = options.cursor?.selection;
		// propagate native mode hints to nativeSelection default
		const wantNative =
			c === "native" || (c && c.mode === "native") || s === "native" || (s && s.mode === "native");
		const ns = options.nativeSelection ?? (wantNative ? "sync" : "none");
		this.session =
			options.session ??
			editor.session("local", {
				actor: "local",
				nativeSelection: ns,
				caret: c,
				selection: s,
				cursor: options.cursor,
			});
		this.cursor = this.session.cursor;
		this.editor = null;
		this.bind(editor);
	}

	// Method: bind
	// Subscribes key and mouse listeners.
	bind(editor) {
		if (this.editor !== editor) {
			this.unbind();
			const node = document;
			node.addEventListener("keyup", this._onKeyUp);
			node.addEventListener("keydown", this._onKeyDown);
			node.addEventListener("mousedown", this._onMouseDown);
			node.addEventListener("mousemove", this._onMouseMove);
			node.addEventListener("mouseup", this._onMouseUp);
			node.addEventListener("selectionchange", this._onSelectionChange);
			this.editor = editor;
		}
		return this;
	}

	// Method: unbind
	// Unsubscribes key and mouse listeners.
	unbind(_editor = this.editor) {
		const node = document; // editor?.root;
		if (node) {
			node.removeEventListener("keyup", this._onKeyUp);
			node.removeEventListener("keydown", this._onKeyDown);
			node.removeEventListener("mousedown", this._onMouseDown);
			node.removeEventListener("mousemove", this._onMouseMove);
			node.removeEventListener("mouseup", this._onMouseUp);
			node.removeEventListener("selectionchange", this._onSelectionChange);
		}
		this.editor = null;
		this._dragAnchor = null;
		this._dragFocus = null;
		return this;
	}

	// Method: onKeyUp
	// KeyUp handler (not implemented).
	onKeyUp(_event) {
		// Text input is handled during keydown so control keys can be
		// swallowed before they perform browser-default actions.
	}

	// Method: onSelectionChange
	// Syncs browser selection into the structural cursor. Collapsed carets are skipped
	// while a click is in progress (_suppressCollapsedNative) or in virtual-only mode.
	onSelectionChange() {
		if (this._dragAnchor != null || this._syncingNative) return;
		this._syncNativeSelection({ allowCollapsed: true });
	}

	// Method: _syncNativeSelection
	// Imports browser selection into structural state.
	// - Non-collapsed ranges always import (mouse drag / programmatic select).
	// - Collapsed carets import only when allowCollapsed and not suppressed (suppressed
	//   between mousedown placement and mouseup re-assert, to ignore off-by-one clicks).
	_syncNativeSelection({ allowCollapsed = false } = {}) {
		if (this._syncingNative) return;
		try {
			const sel = window.getSelection?.();
			if (!sel || sel.rangeCount === 0) return;
			if (sel.isCollapsed && (!allowCollapsed || this._suppressCollapsedNative)) return;
			const r = sel.getRangeAt(0);
			if (this.editor?.range?.within(this.editor.root, r)) {
				this._syncingNative = true;
				this.editor.selection?.syncFromNative(this.editor.root, this.session);
			}
		} catch (_) {
		} finally {
			this._syncingNative = false;
		}
	}

	// Method: onKeyDown
	// Handles key presses translating arrows, deletes, letters to cursor calls.
	onKeyDown(event) {
		// Sync before keymap actions (Ctrl+A, Enter, …) so programmatic/native carets win.
		// Do not overwrite an existing structural range (format ops remap it carefully).
		const kind = this.cursor?.selectionKind;
		if (kind !== "range" && kind !== "node") {
			this._syncNativeSelection({ allowCollapsed: true });
		}
		if (this.editor?.handleKeyEvent(event, this.session)) {
			// Keymap handlers (arrows, deleteSmart, …) move the structural caret;
			// re-assert native so the next insert does not re-import a stale range.
			this._syncingNative = true;
			try {
				this.editor.selection?.syncToNative(this.session);
			} finally {
				this._syncingNative = false;
			}
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;

		let handled = true;
		switch (event.key) {
			case "ArrowLeft":
				this.cursor.left(event.shiftKey);
				break;
			case "ArrowRight":
				this.cursor.right(event.shiftKey);
				break;
			case "ArrowUp":
				this.cursor.up(event.shiftKey);
				break;
			case "ArrowDown":
				this.cursor.down(event.shiftKey);
				break;
			case "Backspace":
				this.cursor.backspace();
				break;
			case "Delete":
				this.cursor.delete();
				break;
			case "Enter":
			case "Return":
				// Swallow newline insertion for now.
				break;
			case " ":
				{
					const shouldInsert = this.editor.shouldInsertText?.(event.key, this.session) !== false;
					if (shouldInsert) {
						this.editor.removePlaceholderInCurrentBlock?.(this.session);
						this.cursor.insertText(event.key);
					} else if (this.cursor?.selectionKind === "caret") {
						const ctx = this.cursor.getContext?.();
						const pointNode = ctx?.point?.node;
						if (
							!this.editor?.text?.isWhitespacePreserved?.(pointNode) &&
							/\s/.test(ctx?.char?.after ?? "")
						) {
							// Advance caret past the existing space instead of a silent no-op (no double space inserted).
							this.cursor.right();
						}
						// If caret is already after the space, swallow — position is already post-space.
					}
				}
				break;
			default:
				if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
					const shouldInsert = this.editor.shouldInsertText?.(event.key, this.session) !== false;
					if (shouldInsert) {
						this.editor.removePlaceholderInCurrentBlock?.(this.session);
						this.cursor.insertText(event.key);
					}
				} else {
					handled = false;
				}
				break;
		}
		if (handled) event.preventDefault();
	}

	// Method: onMouseUp
	// After a drag gesture, keep structural selection (already updated in mousemove).
	// Simple clicks: re-assert structural placement so Chromium's center-of-glyph caret
	// cannot override mousedown. Range selections (drag or double-click word) are kept.
	onMouseUp(_event) {
		const didDrag =
			this._dragAnchor != null &&
			this._dragFocus != null &&
			this._dragFocus !== this._dragAnchor;
		const active = this.editor?.activeSession?.(this.session);
		if (active?.cursor?.selectionKind === "range") {
			// Drag or multi-click word/block selection — keep it and align native.
			this._syncingNative = true;
			try {
				this.editor.selection?.syncToNative(active);
			} finally {
				this._syncingNative = false;
			}
		} else if (didDrag) {
			this._syncNativeSelection({ allowCollapsed: false });
		} else if (active) {
			// Prefer a non-collapsed native selection (browser multi-click) when present.
			this._syncNativeSelection({ allowCollapsed: false });
			if (active.cursor?.selectionKind !== "range") {
				this.editor.selection?.syncToNative(active);
			}
		}
		this._suppressCollapsedNative = false;
		this._dragAnchor = null;
		this._dragFocus = null;
	}

	// Method: onMouseMove
	// While the mouse button is held, extend the selection from the drag anchor.
	// This provides reliable drag-to-select (including across block boundaries)
	// even when using virtual selection mode (which clears native ranges).
	onMouseMove(event) {
		if (!event || event.buttons === 0 || this._dragAnchor == null) {
			if (this._dragAnchor != null && event && event.buttons === 0) {
				this._dragAnchor = null;
				this._dragFocus = null;
			}
			return;
		}
		const root = this.editor?.root;
		if (!root) return;
		let focus = null;
		if (
			this.editor.selection &&
			typeof this.editor.selection.resolveOffsetFromPoint === "function"
		) {
			focus = this.editor.selection.resolveOffsetFromPoint(
				root,
				event.clientX,
				event.clientY,
				this.session,
			);
		} else if (this.session?.cursor) {
			focus = this.session.cursor.offsetFromPointIn(root, event.clientX, event.clientY);
		}
		if (focus == null || focus === this._dragFocus) return;
		this._dragFocus = focus;
		// Drive the selection structurally. This updates the virtual (or native) selection
		// directly from pointer coords, without depending on the browser maintaining a live
		// native range during the drag.
		this.editor.selection.select(this._dragAnchor, focus, this.session);
	}

	// Method: onMouseDown
	// Evaluates pointer coordinate clicks to accurately place caret or select blocks.
	// Also initiates drag selection tracking (and shift-click extend).
	onMouseDown(event) {
		const targetElement =
			event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
		const atom = targetElement?.closest(".atom, .atomic");
		if (atom && this.editor?.text.isAtom(atom)) {
			this.cursor._desiredX = null;
			const rect = atom.getBoundingClientRect();
			const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
			this.cursor.selectAtom(atom, side);
			this._dragAnchor = null;
			this._dragFocus = null;
			return;
		}
		const container = targetElement?.closest(".container, .C");
		if (container && this.editor?.text.isContainer(container)) {
			const skipped = targetElement?.closest(".skipped, .skip, .S");
			if (skipped && container.contains(skipped)) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
				this._dragAnchor = null;
				this._dragFocus = null;
				return;
			}
			if (
				!this.editor.selection.placeCaretFromPoint(
					container,
					event.clientX,
					event.clientY,
					this.session,
					{
						fallback: "none",
					},
				)
			) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
			}
			this._dragAnchor = null;
			this._dragFocus = null;
			return;
		}

		const root = this.editor.root;
		const focus =
			this.editor.selection && typeof this.editor.selection.resolveOffsetFromPoint === "function"
				? this.editor.selection.resolveOffsetFromPoint(
						root,
						event.clientX,
						event.clientY,
						this.session,
					)
				: (this.session?.cursor?.offsetFromPointIn?.(root, event.clientX, event.clientY) ?? null);

		if (event.shiftKey && focus != null) {
			// Shift-click / shift-mousedown: extend from current anchor instead of resetting caret
			const active = this.editor.activeSession(this.session);
			const cur = active.cursor;
			const anchor =
				cur.selection?.isActive
					? cur.selection.anchorOffset
					: (cur.offset ?? focus);
			this.editor.selection.select(anchor, focus, this.session);
			this._dragAnchor = anchor;
			this._dragFocus = focus;
			return;
		}

		const active = this.editor.activeSession(this.session);

		// Double-click selects the word; triple+ selects the current block. Do not
		// collapse to a caret first — that was wiping browser multi-click selection.
		if (event.detail >= 2 && focus != null && active?.cursor) {
			active.cursor._desiredX = null;
			active.cursor.moveTo(focus, { skipBoundaryCollapse: true });
			if (event.detail === 2) {
				const word = this._wordRangeAt(active.cursor.offset);
				if (word) {
					this.editor.selection.select(word.start, word.end, this.session);
					this._syncingNative = true;
					try {
						this.editor.selection.syncToNative(active);
					} finally {
						this._syncingNative = false;
					}
					this._suppressCollapsedNative = false;
					this._dragAnchor = null;
					this._dragFocus = null;
					return;
				}
			} else {
				const block =
					this.editor.blockFor?.(active.cursor.anchor) ??
					this.editor.blockFor?.(targetElement) ??
					root;
				const range = this.editor.structuralRangeFor?.(block);
				if (range && range.end > range.start) {
					this.editor.selection.select(range.start, range.end, this.session);
					this._syncingNative = true;
					try {
						this.editor.selection.syncToNative(active);
					} finally {
						this._syncingNative = false;
					}
					this._suppressCollapsedNative = false;
					this._dragAnchor = null;
					this._dragFocus = null;
					return;
				}
			}
		}

		// Normal click: place caret (this will be the drag anchor if user starts dragging)
		// Reuse the resolved offset above. Resolving it again through setCaret() can
		// refresh the text cache and, at a paragraph edge, may choose an outer
		// boundary instead of the text endpoint used to start a drag.
		let placed = false;
		if (focus != null && active?.cursor) {
			active.cursor._desiredX = null;
			active.cursor.moveTo(focus);
			this.editor.selection.syncToNative(active);
			placed = true;
		} else {
			const block = this.editor.blockFor?.(targetElement) ?? root;
			placed = this.editor.selection.placeCaretFromPoint(
				block,
				event.clientX,
				event.clientY,
				this.session,
			);
		}
		// Suppress collapsed native imports until mouseup re-syncs structural→native.
		// Otherwise selectionchange/keydown pick up Chromium's post-click caret.
		this._suppressCollapsedNative = true;
		this._dragAnchor = placed && active?.cursor ? active.cursor.offset : null;
	}

	// Method: _wordRangeAt
	// Returns structural {start,end} covering the word at logical `offset`, or null.
	_wordRangeAt(offset) {
		const text = this.editor?.text;
		if (!text || offset == null) return null;
		text.ensureIndex(offset);
		const point = text.pointAt(offset);
		if (!point || point.node?.nodeType !== Node.TEXT_NODE) return null;
		const data = point.node.data;
		let start = point.offset;
		let end = point.offset;
		// If caret sits at a boundary after a word char, prefer the word to the left.
		if (start > 0 && start === end && !/\w/.test(data[start] ?? "") && /\w/.test(data[start - 1] ?? "")) {
			start -= 1;
			end = start + 1;
		}
		while (start > 0 && /\w/.test(data[start - 1])) start -= 1;
		while (end < data.length && /\w/.test(data[end])) end += 1;
		if (start === end) return null;
		const startIndex = text.indexOfPoint({ node: point.node, offset: start });
		const endIndex = text.indexOfPoint({ node: point.node, offset: end });
		if (startIndex < 0 || endIndex < startIndex) return null;
		return { start: startIndex, end: endIndex };
	}
}

// Class: Editor
// Orchestrates editor state, schema normalizations, keymaps, and action dispatches.
// - root: HTMLElement - container editor element
class Editor {
	// Method: constructor
	// Initializes and configures the parent Editor environment.
	constructor(node, options = {}) {
		this.root = node;
		this.schema =
			options.schema instanceof EditorSchema
				? options.schema
				: new EditorSchema(options.schema ?? {});
		this.normalizer = options.normalizer ?? new EditorNormalizer(this.schema);
		// Custom maps override individual defaults without disabling unrelated editor keys.
		this.keymap = editorKeymap(options.keymap ?? {});
		this.actions = new Map();
		this.history = [];
		this.sessions = new Map();
		this.plugins = [];
		this._active = false;
		this._currentBlock = null;
		this.text = new TextAdapter(node, options.text).attach();
		this.text._schema = this.schema;
		const topC = options.caret !== undefined ? options.caret : options.cursor?.caret;
		const topS = options.selection !== undefined ? options.selection : options.cursor?.selection;
		const wantTopNative =
			topC === "native" ||
			(topC && topC.mode === "native") ||
			topS === "native" ||
			(topS && topS.mode === "native");
		const sessionOpts = {
			actor: "local",
			nativeSelection: options.nativeSelection ?? (wantTopNative ? "sync" : "none"),
			classes: options.classes,
			cursor: options.cursor,
		};
		const topCaret = options.caret !== undefined ? options.caret : options.cursor?.caret;
		if (topCaret !== undefined) {
			let c = topCaret;
			if (typeof c === "string") c = { mode: c };
			if (c && typeof c === "object" && c.mode !== "native" && c.focused == null) {
				c = { ...c, focused: true };
			}
			sessionOpts.caret = c;
		}
		const topSel = options.selection !== undefined ? options.selection : options.cursor?.selection;
		if (topSel !== undefined) {
			sessionOpts.selection = topSel;
		}
		this.localSession = this.session("local", sessionOpts);
		this.range = new EditorRangeController(this);
		this.selection = new EditorSelectionController(this);
		this.input = new EditorTextInput(this, { ...options, session: this.localSession });
		this.configureActions({
			moveCursor: (command, { session }) => {
				const cursor = session.cursor;
				const extend = command.args.extend === true;
				switch (command.args.direction) {
					case "left":
						cursor.left(extend);
						break;
					case "right":
						cursor.right(extend);
						break;
					case "up":
						cursor.up(extend);
						break;
					case "down":
						cursor.down(extend);
						break;
					default:
						return false;
				}
				return true;
			},
			selectAll: (_command, { session }) => {
				const end = this.text.clampIndex(0x7fffffff);
				return session.cursor.select(0, end);
			},
			selectStructuralScope: (command, { session }) =>
				this.selectStructuralScope(command.args.mode, session),
			moveStructural: (command, { session }) =>
				this.moveStructural(command.args.direction, command.args.extend === true, session),
			moveTraversal: (command, { session }) => this.moveTraversal(command.args.direction, session),
			collapseSelection: (_command, { session }) => {
				const cursor = session.cursor;
				cursor.moveTo(cursor.selection.isActive ? cursor.selection.focusOffset : cursor.offset);
				return true;
			},
			deleteBackward: (_command, { session }) => {
				session.cursor.backspace();
				return true;
			},
			deleteForward: (_command, { session }) => {
				session.cursor.delete();
				return true;
			},
		});
		this.installPlugins(options.plugins ?? []);
		this.classes = this.localSession.classes;
		// Do not force an initial cursor position here; callers (or first interaction)
		// should place the caret at a valid/visible slot. A previous moveTo(8) was a
		// debug leftover that caused bad initial state on small/empty documents.
	}

	// Method: structuralScopeNodes
	// Resolves the nearest declared block (or root child without block rules) and its ancestors.
	structuralScopeNodes(session = null) {
		const active = this.activeSession(session);
		const anchor = active.cursor.anchor;
		let element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		if (!element || !this.root.contains(element)) element = this.root;

		const blockTags = this.schema.tagsOfType("block");
		let scope = null;
		if (blockTags.length) {
			const selector = blockTags.join(", ");
			scope = element.closest(selector);
			if (!scope || !this.root.contains(scope)) scope = null;
		} else {
			while (element !== this.root && element.parentElement && element.parentElement !== this.root)
				element = element.parentElement;
			scope = element === this.root ? this.root : element;
		}
		if (!scope) scope = this.root;

		const scopes = [];
		for (let current = scope; current?.isConnected; current = current.parentElement) {
			scopes.push(current);
			if (current === this.root) break;
		}
		return scopes;
	}

	// Method: structuralRangeFor
	// Converts an element's text contents to the editor's logical selection range.
	structuralRangeFor(node) {
		if (!node?.isConnected) return null;
		// Prefer content text nodes. Formatting-only whitespace between blocks is not
		// always present in the position index, so a raw TreeWalker end can miss.
		const acceptContentText = {
			acceptNode: (n) => {
				if (!n?.data || !n.data.replace(/\u200b/g, "").trim()) {
					return NodeFilter.FILTER_REJECT;
				}
				if (this.text.isSkipped?.(n.parentElement) || this.text.isSkipped?.(n)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		};
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, acceptContentText);
		let first = null;
		let last = null;
		while (walker.nextNode()) {
			if (!first) first = walker.currentNode;
			last = walker.currentNode;
		}
		const startPoint = first
			? { node: first, offset: 0 }
			: this.text.pointAtOffsetWithin(node, 0, "forward");
		const endPoint = last
			? { node: last, offset: last.data.length }
			: this.text.pointAtOffsetWithin(
					node,
					Math.max(0, this.text.offsetWithin(node, { node, offset: node.childNodes.length })),
					"backward",
				);
		// indexOfPoint expands the lazy window as needed for far nodes.
		const start = startPoint ? this.text.indexOfPoint(startPoint) : -1;
		const end = endPoint ? this.text.indexOfPoint(endPoint) : -1;
		return start >= 0 && end >= start ? { start, end } : null;
	}

	// Method: structuralScopes
	// Gets selectable structural ranges from innermost scope through the editor root.
	structuralScopes(session = null) {
		const scopes = [];
		for (const node of this.structuralScopeNodes(session)) {
			const range = this.structuralRangeFor(node);
			if (
				range &&
				range.end > range.start &&
				!scopes.some((scope) => scope.start === range.start && scope.end === range.end)
			) {
				scopes.push(range);
			}
		}
		return scopes;
	}

	// Method: selectStructuralScope
	// Selects the current block (innermost scope containing caret). If the
	// current block is already exactly selected, expands (or contracts) to
	// the adjacent scope. This matches the requested Ctrl-A behavior:
	// "only select the current block and expand up if the current block is selected".
	selectStructuralScope(mode = "expand", session = null) {
		const active = this.activeSession(session);
		const storedScopes = active.cursor._structuralScopePath?.filter((node) => node.isConnected);
		const scopes = storedScopes?.length ? storedScopes : this.structuralScopeNodes(active);
		if (!scopes.length) return false;
		let currentIdx = scopes.indexOf(active.cursor._structuralScopeNode);

		if (mode === "contract") {
			if (currentIdx <= 0) {
				// Contract from the innermost scope to a caret at the current focus.
				active.cursor.moveTo(
					active.cursor.selection.focusOffset ?? active.cursor.offset ?? 0,
				);
				return this.selection.syncToNative(active);
			}
			currentIdx -= 1;
		} else {
			// First Ctrl+A selects the innermost block; subsequent presses move to
			// its enclosing DOM scopes without relying on rebuilt numeric offsets.
			currentIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, scopes.length - 1);
		}

		// Walk outward until a resolvable text range is found (root may include
		// only formatting whitespace at the edges that is not indexable).
		for (let i = currentIdx; mode === "expand" ? i < scopes.length : i >= 0; mode === "expand" ? (i += 1) : (i -= 1)) {
			const target = scopes[i];
			const range = this.structuralRangeFor(target);
			if (!range || range.end <= range.start) continue;
			this.selection.select(range.start, range.end, active);
			active.cursor._structuralScopeNode = target;
			active.cursor._structuralScopePath = scopes;
			return this.selection.syncToNative(active);
		}
		// Still handled: swallow browser Ctrl+A even if we cannot grow further.
		return active.cursor.selectionKind === "range";
	}

	// Method: structuralBlocks
	// Returns navigable leaf blocks in document order, falling back to root children.
	structuralBlocks() {
		const tags = this.schema.tagsOfType("block");
		if (!tags.length) {
			const children = [...this.root.children];
			return children.length ? children : [this.root];
		}
		const selector = tags.join(", ");
		const all = [...this.root.querySelectorAll(selector)];
		return all.filter((node) => !node.querySelector(selector));
	}

	// Method: moveStructural
	// Moves to a block boundary; extension retains the active selection anchor.
	moveStructural(direction, extend = false, session = null) {
		const active = this.activeSession(session);
		const blocks = this.structuralBlocks();
		if (!blocks.length) return false;
		const offset = active.cursor.offset ?? 0;
		const scopes = this.structuralScopeNodes(active);
		let index = blocks.findIndex((block) => scopes.includes(block));
		if (index < 0) {
			const containing = blocks.findIndex((block) =>
				block.contains(this.text.pointAt(offset)?.node),
			);
			index = containing >= 0 ? containing : 0;
		}
		const backwards = direction === "left" || direction === "up";
		let range = this.structuralRangeFor(blocks[index]);
		if (!range) return false;
		if (backwards && offset <= range.start && index > 0)
			range = this.structuralRangeFor(blocks[--index]);
		if (!backwards && offset >= range.end && index < blocks.length - 1)
			range = this.structuralRangeFor(blocks[++index]);
		if (!range) return false;
		const target = backwards ? range.start : range.end;
		if (extend) {
			const anchor = active.cursor.selection.isActive
				? active.cursor.selection.anchorOffset
				: offset;
			this.selection.select(anchor, target, active);
		} else {
			active.cursor.moveTo(target);
		}
		return this.selection.syncToNative(active);
	}

	// Method: traversalTargets
	// Lists editable atoms and terminal elements in document traversal order.
	traversalTargets() {
		const targets = [];
		const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_ELEMENT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (this.text.isSkipped(node) || node.contentEditable === "false") continue;
			if (this.text.isAtom(node) || node.children.length === 0) targets.push(node);
		}
		return targets;
	}

	// Method: moveTraversal
	// Selects the next/previous editable atom or moves to a terminal element's edge.
	moveTraversal(direction = "forward", session = null) {
		const active = this.activeSession(session);
		const targets = this.traversalTargets();
		if (!targets.length) return false;
		const backwards = direction === "backward";
		const point = this.text.pointAt(active.cursor.offset ?? 0);
		let element =
			active.cursor.selectedNode ??
			(point?.node?.nodeType === Node.ELEMENT_NODE ? point.node : point?.node?.parentElement);
		if (!element && active.cursor.anchor) {
			element =
				active.cursor.anchor.nodeType === Node.ELEMENT_NODE
					? active.cursor.anchor
					: active.cursor.anchor.parentElement;
		}
		// Robust lookup: walk up from element to find a traversal target, or find a target contained in element.
		let index = -1;
		if (element) {
			let node = element;
			while (node && this.root.contains(node)) {
				const i = targets.indexOf(node);
				if (i >= 0) {
					index = i;
					break;
				}
				node = node.parentElement;
			}
		}
		if (index < 0 && element) {
			for (let i = 0; i < targets.length; i++) {
				if (element.contains(targets[i]) || targets[i].contains(element)) {
					index = i;
					break;
				}
			}
		}
		if (index < 0) {
			index = backwards ? targets.length - 1 : 0;
		} else if (index >= 0) {
			index += backwards ? -1 : 1;
		}
		if (index < 0 || index >= targets.length) {
			index = backwards ? targets.length - 1 : 0;
		}

		const target = targets[index];
		if (this.text.isAtom(target)) {
			active.cursor.selectAtom(target, backwards ? "after" : "before");
		} else {
			// Prefer an explicit position at the target element itself. This ensures
			// we land on a distinct slot even for empty placeholders/slots (structuralRangeFor
			// can return collapsed ranges when there's no text content inside).
			this.text.refresh();
			let pos = this.text.indexOfPoint({ node: target, offset: 0 });
			if (pos < 0 && target.childNodes.length > 0) {
				pos = this.text.indexOfPoint({ node: target, offset: target.childNodes.length });
			}
			const moveOpts = { skipBoundaryCollapse: true };
			if (pos >= 0) {
				active.cursor.moveTo(pos, moveOpts);
			} else {
				const range = this.structuralRangeFor(target);
				if (!range) return false;
				active.cursor.moveTo(backwards ? range.end : range.start, moveOpts);
			}
			// Ensure visual caret is at the target for empty terminals (0-text slots).
			// Force using target's BCR; fall back to a positive height so caret shows
			// even if target has no intrinsic size yet (empty placeholder before styles/content).
			const cr = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
		if (cr && active.cursor?.caret?.node) {
				const c = active.cursor.caret;
				const h = cr.height > 0 ? cr.height : 18;
				const parent = c.node.offsetParent;
				const local = parent
					? {
						x: cr.left - parent.getBoundingClientRect().left + parent.scrollLeft,
						y: cr.top - parent.getBoundingClientRect().top + parent.scrollTop,
					}
					: { x: cr.left + window.scrollX, y: cr.top + window.scrollY };
				c._showAt(local.x, local.y, h);
			}
		}
		return this.selection.syncToNative(active);
	}

	// Method: destroy
	// Tears down sessions, normalizers, input events, and adapters.
	destroy() {
		for (const plugin of this.plugins) plugin.detach?.(this);
		for (const session of this.sessions.values()) session.destroy();
		this.input.unbind();
		this.text.detach();
	}

	// Method: session
	// Creates or retrieves a collaborative or local editing session by `id`.
	session(id = "local", options = {}) {
		if (id instanceof EditorSession) return id;
		if (!this.sessions.has(id)) {
			this.sessions.set(id, new EditorSession(this, id, options));
		}
		return this.sessions.get(id);
	}

	// Method: activeSession
	// Resolves current active or fallback session.
	activeSession(session = null) {
		return this.session(session ?? this.localSession ?? "local");
	}

	// Method: configureActions
	// Registers execution callbacks for command types.
	configureActions(actions = {}) {
		for (const [name, action] of Object.entries(actions)) this.actions.set(name, action);
		return this;
	}

	// Method: installPlugins
	// Installs editor plugins or plugin factories.
	installPlugins(plugins = []) {
		for (const plugin of plugins) this.installPlugin(plugin);
		return this;
	}

	// Method: installPlugin
	// Installs a single editor plugin instance, class, or factory.
	installPlugin(plugin) {
		if (!plugin) return null;
		const instance =
			typeof plugin === "function"
				? plugin.prototype?.attach
					? new plugin()
					: plugin(this)
				: plugin;
		instance?.attach?.(this);
		if (instance) this.plugins.push(instance);
		return instance ?? null;
	}

	// Method: plugin
	// Resolves an installed plugin by constructor, name, or exact instance.
	plugin(type) {
		if (!type) return null;
		for (const plugin of this.plugins) {
			if (plugin === type) return plugin;
			if (typeof type === "string") {
				if (plugin.constructor?.pluginName === type || plugin.constructor?.name === type)
					return plugin;
			} else if (plugin instanceof type) {
				return plugin;
			}
		}
		return null;
	}

	// Method: action
	// Dispatches command and returns success flag.
	action(spec, options = {}) {
		if (!spec) return false;
		return this.dispatch(spec, options).handled;
	}

	// Method: dispatch
	// Direct execution engine routing commands to registered actions and recording history.
	dispatch(value, options = {}) {
		const session = this.activeSession(options.session);
		if (typeof value === "function") {
			const result = value(this, options.event, session);
			return new EditorTransaction(null, { result });
		}
		const command = session.command(value);
		if (!command?.type) return new EditorTransaction(command, { result: false });
		const fn = this.actions.get(command.type);
		if (!fn) return new EditorTransaction(command, { result: false });
		const selectionBefore = session.snapshotSelection();
		const result = fn(command, { editor: this, session, event: options.event });
		const transaction =
			result instanceof EditorTransaction
				? result
				: new EditorTransaction(command, {
						result,
						selectionBefore,
						selectionAfter: session.snapshotSelection(),
					});
		if (transaction.handled) this.history.push(transaction);
		return transaction;
	}

	// Method: keyCombo
	// Decodes KeyboardEvent details into standard hotkey strings (e.g. Mod+B).
	keyCombo(event) {
		const parts = [];
		if (event.ctrlKey || event.metaKey) parts.push("Mod");
		if (event.altKey) parts.push("Alt");
		if (event.shiftKey) parts.push("Shift");
		let key = event.key === " " ? "Space" : event.key;
		if (key.length === 1 && key !== "`") key = key.toUpperCase();
		parts.push(key);
		return parts.join("+");
	}

	// Method: handleKeyEvent
	// Evaluates keyboard combinations against configured hotkeys.
	handleKeyEvent(event, session = null) {
		const spec = this.keymap?.[this.keyCombo(event)] ?? this.keymap?.[event.key];
		if (!spec) return false;
		const handled = this.action(spec, { event, session });
		if (handled) {
			event.preventDefault();
			event.stopPropagation();
		}
		return handled;
	}

	// Method: normalize
	// Performs incremental DOM sanitizations on designated targets.
	normalize(target = this.root, context = {}) {
		return (
			this.normalizer?.normalize(target, {
				editor: this,
				root: this.root,
				schema: this.schema,
				...context,
			}) ?? new EditorTransaction(new EditorCommand("normalize"), { result: false })
		);
	}
}

export {
	Editor,
	EditorAdapter,
	EditorClassController,
	EditorCommand,
	EditorCursor,
	EditorNormalizer,
	EditorRangeController,
	EditorSchema,
	EditorSelectionController,
	EditorSession,
	EditorTransaction,
	editorKeymap,
};

// EOF
