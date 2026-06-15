import { TextAdapter } from "structural/text";
import { Cursor } from "structural/cursor";

class Schema {
	constructor(rules = {}, options = {}) {
		this.rules = rules;
		this.options = options;
	}

	rule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return tag ? this.rules[tag] ?? null : null;
	}

	isEmpty() {
		return Object.keys(this.rules).length === 0;
	}

	tag(nodeOrTag) {
		if (!nodeOrTag) return null;
		if (typeof nodeOrTag === "string") return nodeOrTag;
		if (nodeOrTag.nodeType === Node.TEXT_NODE) return "#text";
		return nodeOrTag.tagName?.toLowerCase() ?? null;
	}

	group(name) {
		return Array.isArray(this.rules[name]) ? this.rules[name] : [];
	}

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

	contains(parent, child) {
		const rule = this.rule(parent);
		if (!rule?.contains) return false;
		return this.expand(rule.contains).includes(this.tag(child));
	}

	defaultChild(parent, fallback = "p") {
		return this.rule(parent)?.default ?? fallback;
	}

	aliasFor(tag) {
		return this.options.aliases?.[this.tag(tag)] ?? null;
	}

	normalizeRule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return {
			...(this.options.normalize ?? {}),
			...(tag ? this.rule(tag)?.normalize ?? {} : {}),
		};
	}

	normalizeAction(nodeOrTag, condition, fallback = "preserve") {
		return this.normalizeRule(nodeOrTag)?.[condition] ?? fallback;
	}

	enterRule(nodeOrTag) {
		return this.rule(nodeOrTag)?.enter ?? {};
	}

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

	type(tag) {
		return this.rule(tag)?.type ?? null;
	}

	isBlock(tag) {
		return this.type(tag) === "block";
	}

	isInline(tag) {
		return this.type(tag) === "inline";
	}

	tagsOfType(type) {
		return Object.entries(this.rules)
			.filter(([tag, rule]) => !tag.startsWith("@") && rule?.type === type)
			.map(([tag]) => tag);
	}

	selector(type) {
		return this.tagsOfType(type).join(", ");
	}

	allowsInline(tag, context = {}) {
		if (this.isEmpty()) return true;
		const block = context.block ?? context.parent;
		return this.isInline(tag) && (!block || this.contains(block, tag));
	}

	allowsBlock(tag, context = {}) {
		if (this.isEmpty()) return true;
		if (!this.isBlock(tag)) return false;
		const parent = context.parent ?? context.root;
		if (!parent) return true;
		const parentTag = parent === context.root ? ":root" : this.tag(parent);
		return this.contains(parentTag, tag);
	}
}

const richTextRules = {
	":root": {
		type: "root",
		contains: ["h1", "h2", "h3", "p", "ul", "ol", "blockquote"],
		default: "p",
		normalize: { empty: "fill", text: "wrap", invalidChild: "lift" },
	},
	"@inline": ["strong", "em", "code"],
	blockquote: { type: "block", contains: ["p", "h1", "h2", "h3", "ul", "ol"], default: "p", normalize: { empty: "prune", text: "wrap", invalidChild: "lift" } },
	ul: { type: "block", contains: ["li", "ul", "ol"], absorb: ["ul"], default: "li", normalize: { empty: "prune", invalidChild: "wrap" } },
	ol: { type: "block", contains: ["li", "ul", "ol"], absorb: ["ol"], default: "li", normalize: { empty: "prune", invalidChild: "wrap" } },
	li: { type: "block", contains: ["#text", "@inline", "p", "ul", "ol"], wrapIn: "ul", default: "p", normalize: { empty: "placeholder", text: "preserve", invalidChild: "lift" }, enter: { next: "same" } },
	p: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "same" } },
	h1: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	h2: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	h3: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	strong: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	em: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	code: { type: "inline", contains: ["#text"], normalize: { empty: "unwrap", invalidChild: "lift" } },
};

function richTextSchema(overrides = {}, options = {}) {
	return new Schema({ ...richTextRules, ...overrides }, {
		aliases: { b: "strong", i: "em", ...(options.aliases ?? {}) },
		normalize: {
			unknownElement: "unwrap",
			pruneEmptyText: true,
			...options.normalize,
		},
	});
}

function richTextKeymap(overrides = {}) {
	return {
		"Mod+B": { type: "toggleInline", args: { tag: "strong" } },
		"Mod+I": { type: "toggleInline", args: { tag: "em" } },
		"Mod+`": { type: "toggleInline", args: { tag: "code" } },
		"Mod+1": { type: "toggleBlock", args: { tag: "h1" } },
		"Mod+2": { type: "toggleBlock", args: { tag: "h2" } },
		"Mod+3": { type: "toggleBlock", args: { tag: "h3" } },
		Enter: { type: "splitBlock" },
		"Shift+Enter": { type: "insertLineBreak" },
		Tab: { type: "indent" },
		"Shift+Tab": { type: "dedent" },
		Backspace: { type: "deleteSmart" },
		Delete: { type: "deleteSmart" },
		...overrides,
	};
}

function richTextClasses(options = {}) {
	return {
		selector: ["h1", "h2", "h3", "p", "li", "blockquote", "strong", "em", "code"],
		focus: "focus",
		focusWithin: "focus-within",
		selected: "selected",
		selectedWithin: "selected-within",
		...options,
	};
}

function richTextNormalizer(schema = richTextSchema(), options = {}) {
	return new Normalizer(schema, options);
}

class Adapter {}

class Command {
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
		if (value instanceof Command) return value.with(defaults);
		if (typeof value === "string") {
			const [type, ...parts] = value.split(":");
			return new Command(type, {
				...defaults,
				args: { ...(defaults.args ?? {}), value: parts.join(":") },
			});
		}
		if (typeof value === "function") return value;
		return new Command(value.type, {
			...defaults,
			...value,
			args: { ...(defaults.args ?? {}), ...(value.args ?? {}) },
			meta: { ...(defaults.meta ?? {}), ...(value.meta ?? {}) },
		});
	}

	with(overrides = {}) {
		return new Command(this.type, {
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

class Transaction {
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

class Normalizer {
	constructor(schema, options = {}) {
		this.schema = schema;
		this.options = options;
	}

	normalize(target, context = {}) {
		this.root = context.root ?? context.editor?.root ?? target;
		const command = new Command("normalize", {
			actor: context.session?.actor ?? context.actor ?? null,
			meta: { target: this.schema.tag(target) ?? "#node" },
		});
		const transaction = new Transaction(command, { result: false });
		this.normalizeNode(target, context, transaction);
		if (target.nodeType === Node.ELEMENT_NODE) this.normalizeEmpty(target, transaction);
		transaction.result = transaction.steps.length > 0;
		return transaction;
	}

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
		const known = !!this.schema.rule(childTag);
		const action = known
			? this.schema.normalizeAction(parentTag, "invalidChild", "preserve")
			: this.schema.options.normalize?.unknownElement ?? "unwrap";
		this.applyInvalidAction(parent, child, action, transaction);
	}

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
			transaction.steps.push({ type: "wrapNode", tag: this.schema.tag(child), wrapper: wrapper.tagName.toLowerCase() });
		} else if (action === "lift") {
			parent.parentNode?.insertBefore(child, parent.nextSibling);
			transaction.steps.push({ type: "liftNode", tag: this.schema.tag(child) });
		}
	}

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
			node.appendChild(document.createElement("br"));
			transaction.steps.push({ type: "placeholder", tag });
		} else if (action === "unwrap" && node.parentNode) {
			this.unwrapElement(node);
			transaction.steps.push({ type: "unwrapEmpty", tag });
		}
	}

	schemaTag(node) {
		return node === this.root ? ":root" : this.schema.tag(node);
	}

	isEmpty(node) {
		return [...node.childNodes].every(child =>
			(child.nodeType === Node.TEXT_NODE && child.data.length === 0) ||
			(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br")
		);
	}

	unwrapElement(node) {
		const parent = node.parentNode;
		while (node.firstChild) parent.insertBefore(node.firstChild, node);
		node.remove();
	}
}

class EditorSession {
	constructor(editor, id, options = {}) {
		this.editor = editor;
		this.id = id;
		this.actor = options.actor ?? id;
		this.mode = options.mode ?? "insert";
		this.nativeSelection = options.nativeSelection ?? "none";
		this.currentBlock = null;
		this.cursor = new Cursor(this, options.cursor);
		this.classes = options.classes ? new ClassTracker(this, options.classes).attach() : null;
	}

	get root() {
		return this.editor.root;
	}

	get text() {
		return this.editor.text;
	}

	destroy() {
		this.classes?.detach();
	}

	snapshotSelection() {
		return {
			offset: this.cursor.offset ?? 0,
			selectionKind: this.cursor.selectionKind,
			anchorOffset: this.cursor.anchor ? this.text.indexOfPoint({ node: this.cursor.anchor, offset: 0 }) : -1,
		};
	}

	command(value, options = {}) {
		return Command.from(value, {
			actor: this.actor,
			mode: this.mode,
			selection: this.snapshotSelection(),
			...options,
		});
	}

	action(spec, event = null) {
		return this.editor.action(spec, { event, session: this });
	}

	dispatch(command, options = {}) {
		return this.editor.dispatch(command, { ...options, session: this });
	}
}

class ClassTracker {
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

	attach() {
		document.addEventListener("selectionchange", this._onSelectionChange);
		this.editor.root.addEventListener("CursorMove", this._onCursorMove);
		this.update();
		return this;
	}

	detach() {
		document.removeEventListener("selectionchange", this._onSelectionChange);
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		for (const key of Object.keys(this.state)) {
			for (const node of this.state[key]) node.classList.remove(this.className(key));
			this.state[key].clear();
		}
		return this;
	}

	className(key) {
		return this.options[key] ?? key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
	}

	selector() {
		const selector = this.options.selector ?? [
			this.editor.schema?.selector("block"),
			this.editor.schema?.selector("inline"),
		].filter(Boolean);
		return Array.isArray(selector) ? selector.filter(Boolean).join(", ") : selector;
	}

	trackedFor(node) {
		const selector = this.selector();
		if (!selector) return null;
		const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const tracked = el?.closest(selector);
		return tracked && this.editor.root.contains(tracked) ? tracked : null;
	}

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

	rangeWithinEditor(range) {
		if (!range) return false;
		const start = range.startContainer?.nodeType === Node.ELEMENT_NODE
			? range.startContainer
			: range.startContainer?.parentElement;
		const end = range.endContainer?.nodeType === Node.ELEMENT_NODE
			? range.endContainer
			: range.endContainer?.parentElement;
		return !!start && !!end && this.editor.root.contains(start) && this.editor.root.contains(end);
	}

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
		if ((!range || range.collapsed) && nativeSelection?.rangeCount > 0 && !nativeSelection.isCollapsed) {
			const nativeRange = nativeSelection.getRangeAt(0);
			if (this.rangeWithinEditor(nativeRange)) range = nativeRange;
		}
		if (!range || range.collapsed || !this.rangeWithinEditor(range)) return nodes;

		const candidates = [];
		for (const tracked of this.editor.root.querySelectorAll(selector)) {
			if (range.intersectsNode(tracked)) candidates.push(tracked);
		}
		for (const tracked of candidates) {
			const hasIntersectingChild = candidates.some(candidate =>
				candidate !== tracked && tracked.contains(candidate)
			);
			if (!hasIntersectingChild) nodes.add(tracked);
		}
		return nodes;
	}

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

class TextInput {
	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	constructor(editor, options = {}) {
		this._onKeyUp = this.onKeyUp.bind(this);
		this._onKeyDown = this.onKeyDown.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		this.session = options.session ?? editor.session("local", {
			actor: "local",
			nativeSelection: "sync",
			cursor: options.cursor,
		});
		this.cursor = this.session.cursor;
		this.editor = null;
		this.bind(editor);
	}

	bind(editor) {
		if (this.editor !== editor) {
			this.unbind();
			const node = document;
			node.addEventListener("keyup", this._onKeyUp);
			node.addEventListener("keydown", this._onKeyDown);
			node.addEventListener("mousedown", this._onMouseDown);
			this.editor = editor;
		}
		return this;
	}

	unbind(_editor = this.editor) {
		const node = document; // editor?.root;
		if (node) {
			node.removeEventListener("keyup", this._onKeyUp);
			node.removeEventListener("keydown", this._onKeyDown);
			node.removeEventListener("mousedown", this._onMouseDown);
		}
		this.editor = null;
		return this;
	}

	// ========================================================================
	// EVENTS
	// ========================================================================

	onKeyUp(_event) {
		// Text input is handled during keydown so control keys can be
		// swallowed before they perform browser-default actions.
	}

	onKeyDown(event) {
		if (this.editor?.handleKeyEvent(event, this.session)) return;

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
			default:
				if (
					event.key.length === 1 &&
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey
				) {
					this.editor.removePlaceholderInCurrentBlock?.(this.session);
					this.cursor.insertText(event.key);
				} else {
					handled = false;
				}
				break;
		}
		if (handled) event.preventDefault();
	}

	onMouseDown(event) {
		const targetElement = event.target?.nodeType === Node.ELEMENT_NODE
			? event.target
			: event.target?.parentElement;
		const atom = targetElement?.closest(".atom, .atomic");
		if (atom && this.editor?.text.isAtom(atom)) {
			this.cursor._desiredX = null;
			const rect = atom.getBoundingClientRect();
			const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
			this.cursor.selectAtom(atom, side);
			return;
		}
		const container = targetElement?.closest(".container, .C");
		if (container && this.editor?.text.isContainer(container)) {
			const skipped = targetElement?.closest(".skipped, .skip, .S");
			if (skipped && container.contains(skipped)) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side =
					event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
				return;
			}
			const offset = this.cursor.offsetFromPoint(event.clientX, event.clientY);
			const position = this.editor.text.positionSlotAt(offset);
			if (
				!this.editor.text.acceptsText(position) ||
				!this.cursor._isWithinNode(container, position?.point?.node)
			) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side =
					event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
				return;
			}
			this.cursor._desiredX = null;
			this.cursor.moveTo(offset);
			return;
		}
		// FIXME: Not great to have this here
		this.cursor._desiredX = null;
		this.cursor.moveTo(
			this.cursor.offsetFromPoint(event.clientX, event.clientY),
		);
	}
}

class Editor {
	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	constructor(node, options = {}) {
		this.root = node;
		this.schema = options.schema instanceof Schema
			? options.schema
			: new Schema(options.schema ?? {});
		this.normalizer = options.normalizer ?? new Normalizer(this.schema);
		this.keymap = options.keymap ?? {};
		this.actions = new Map();
		this.history = [];
		this.sessions = new Map();
		this._active = false;
		this._currentBlock = null;
		this.text = new TextAdapter(node, options.text).attach();
		this.localSession = this.session("local", {
			actor: "local",
			nativeSelection: "sync",
			classes: options.classes,
			cursor: options.cursor,
		});
		this.input = new TextInput(this, { ...options, session: this.localSession });
		this.configureActions({
			splitBlock: (_command, context) => this.splitCurrentBlock(context.session),
			insertLineBreak: (_command, context) => this.insertLineBreak(context.session),
			deleteSmart: (_command, context) => this.deleteSelectedBlocks(context.session) || this.deleteEmptyBlock(context.session) || this.mergeBlockBackward(context.session, context.event),
			indent: (_command, context) => this.indentCurrentListItem(context.session),
			dedent: (_command, context) => this.dedentCurrentListItem(context.session),
		});
		this.classes = this.localSession.classes;
		this.input.cursor.moveTo(8);
	}

	destroy() {
		for (const session of this.sessions.values()) session.destroy();
		this.input.unbind();
		this.text.detach();
	}

	session(id = "local", options = {}) {
		if (id instanceof EditorSession) return id;
		if (!this.sessions.has(id)) {
			this.sessions.set(id, new EditorSession(this, id, options));
		}
		return this.sessions.get(id);
	}

	activeSession(session = null) {
		return this.session(session ?? this.localSession ?? "local");
	}

	configureActions(actions = {}) {
		for (const [name, action] of Object.entries(actions)) this.actions.set(name, action);
		return this;
	}

	action(spec, options = {}) {
		if (!spec) return false;
		return this.dispatch(spec, options).handled;
	}

	dispatch(value, options = {}) {
		const session = this.activeSession(options.session);
		if (typeof value === "function") {
			const result = value(this, options.event, session);
			return new Transaction(null, { result });
		}
		const command = session.command(value);
		if (!command?.type) return new Transaction(command, { result: false });
		const fn = this.actions.get(command.type);
		if (!fn) return new Transaction(command, { result: false });
		const selectionBefore = session.snapshotSelection();
		const result = fn(command, { editor: this, session, event: options.event });
		const transaction = result instanceof Transaction
			? result
			: new Transaction(command, {
				result,
				selectionBefore,
				selectionAfter: session.snapshotSelection(),
			});
		if (transaction.handled) this.history.push(transaction);
		return transaction;
	}

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

	blockSelector() {
		const blocks = this.schema.tagsOfType("block")
			.filter(tag => this.schema.contains(tag, "#text") || tag === "blockquote");
		return blocks.join(", ") || "p, h1, h2, h3, h4, h5, h6, li, blockquote, div";
	}

	rangeWithinEditor(range) {
		if (!range) return false;
		const start = range.startContainer?.nodeType === Node.ELEMENT_NODE
			? range.startContainer
			: range.startContainer?.parentElement;
		const end = range.endContainer?.nodeType === Node.ELEMENT_NODE
			? range.endContainer
			: range.endContainer?.parentElement;
		return !!start && !!end && this.root.contains(start) && this.root.contains(end);
	}

	nativeRange(session = null) {
		const active = this.activeSession(session);
		const selection = window.getSelection();
		if (active.nativeSelection !== "none" && selection?.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (this.rangeWithinEditor(range)) return range.cloneRange();
		}
		const cursor = active.cursor;
		if (cursor.selectionKind === "range") return cursor.selection.toDomRange();
		const point = this.text.pointAt(cursor.offset ?? 0);
		if (!point) return null;
		const range = document.createRange();
		range.setStart(point.node, point.offset);
		range.collapse(true);
		return range;
	}

	blockFor(node) {
		const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const block = el?.closest(this.blockSelector());
		return block && this.root.contains(block) ? block : null;
	}

	createBlock(tag = "p") {
		const block = document.createElement(tag);
		this.ensureEditableContent(block, true);
		return block;
	}

	replaceBlock(block, tag) {
		const next = this.createBlock(tag);
		block.replaceWith(next);
		return next;
	}

	firstTextNode(node) {
		if (!node) return null;
		if (node.nodeType === Node.TEXT_NODE) return node;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		return walker.nextNode();
	}

	lastTextNode(node) {
		if (!node) return null;
		if (node.nodeType === Node.TEXT_NODE) return node;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		let text = null;
		while (walker.nextNode()) text = walker.currentNode;
		return text;
	}

	pruneEmptyTextChildren(block) {
		if (!block || block.nodeType !== Node.ELEMENT_NODE) return;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) child.remove();
		}
	}

	ensureEditableContent(block, preferBr = false) {
		this.pruneEmptyTextChildren(block);
		if (block.childNodes.length > 0) return;
		if (preferBr) block.appendChild(document.createElement("br"));
	}

	setCursorAtPoint(node, offset, session = null) {
		const active = this.activeSession(session);
		this.text.refresh();
		const index = this.text.indexOfPoint({ node, offset });
		if (index >= 0) {
			active.cursor.moveTo(index);
			return this.syncNativeSelectionToCursor(active);
		}
		return false;
	}

	syncNativeSelectionToCursor(session = null) {
		const active = this.activeSession(session);
		if (active.nativeSelection === "none") return true;
		const point = this.text.pointAt(active.cursor.offset ?? 0);
		if (!point?.node?.isConnected) return false;
		try {
			const range = document.createRange();
			range.setStart(point.node, point.offset);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			return true;
		} catch (_e) {
			return false;
		}
	}

	moveCursorToBlockStart(block, session = null) {
		this.ensureEditableContent(block, true);
		const textNode = this.firstTextNode(block);
		return textNode ? this.setCursorAtPoint(textNode, 0, session) : this.setCursorAtPoint(block, 0, session);
	}

	moveCursorToBlockEnd(block, session = null) {
		this.ensureEditableContent(block, true);
		const textNode = this.lastTextNode(block);
		return textNode
			? this.setCursorAtPoint(textNode, textNode.data.length, session)
			: this.setCursorAtPoint(block, block.childNodes.length, session);
	}

	firstBlockIn(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		if (node.matches(this.blockSelector())) return node;
		return node.querySelector(this.blockSelector());
	}

	lastBlockIn(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		const blocks = node.matches(this.blockSelector())
			? [node, ...node.querySelectorAll(this.blockSelector())]
			: [...node.querySelectorAll(this.blockSelector())];
		return blocks.at(-1) ?? null;
	}

	normalize(target = this.root, context = {}) {
		return this.normalizer?.normalize(target, {
			editor: this,
			root: this.root,
			schema: this.schema,
			...context,
		}) ?? new Transaction(new Command("normalize"), { result: false });
	}

	blockText(block) {
		return (block?.textContent ?? "").replace(/\u200b/g, "").trim();
	}

	isEmptyBlock(block) {
		return !!block && this.blockText(block) === "";
	}

	removePlaceholderInCurrentBlock(session = null) {
		const block = this.currentEditableBlock(session);
		if (!block || !this.isEmptyBlock(block)) return false;
		let removed = false;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
				child.remove();
				removed = true;
			}
		}
		if (removed) this.text.refresh();
		return removed;
	}

	syncAfterMutation(move, session = null) {
		const active = this.activeSession(session);
		this.lastNormalization = this.normalize(this.root, { session: active });
		this.text.refresh();
		let placed = false;
		if (move?.type === "end" && move.block?.isConnected) {
			placed = this.moveCursorToBlockEnd(move.block, active);
		} else if (move?.block?.isConnected) {
			placed = this.moveCursorToBlockStart(move.block, active);
		}
		if (!placed) {
			const fallback = this.firstBlockIn(this.root);
			if (fallback) placed = this.moveCursorToBlockStart(fallback, active);
		}
		active.currentBlock = this.blockFor(active.cursor.anchor) ?? (move?.block?.isConnected ? move.block : null);
		if (active === this.localSession) this._currentBlock = active.currentBlock;
		active.classes?.update();
	}

	currentEditableBlock(session = null) {
		const active = this.activeSession(session);
		const range = this.nativeRange(active);
		const selectedBlock = range ? this.blockFor(range.startContainer) : null;
		if (selectedBlock) {
			active.currentBlock = selectedBlock;
			if (active === this.localSession) this._currentBlock = selectedBlock;
			return selectedBlock;
		}
		const anchorBlock = this.blockFor(active.cursor.anchor);
		if (anchorBlock) {
			active.currentBlock = anchorBlock;
			if (active === this.localSession) this._currentBlock = anchorBlock;
			return anchorBlock;
		}
		return active.currentBlock?.isConnected ? active.currentBlock : null;
	}

	selectedRange(session = null) {
		const cursor = this.activeSession(session).cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) return null;
		const range = this.nativeRange(session);
		return range && !range.collapsed ? range : null;
	}

	isFullySelectedBlock(range, block) {
		const blockRange = document.createRange();
		blockRange.selectNode(block);
		return (
			range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
			range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0
		);
	}

	fullySelectedBlocks(session = null) {
		const cursor = this.activeSession(session).cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const block = this.blockFor(cursor.selectedNode);
			return block ? [block] : [];
		}
		const range = this.selectedRange(session);
		if (!range) return [];
		const blocks = [];
		for (const block of this.root.querySelectorAll(this.blockSelector())) {
			if (range.intersectsNode(block) && this.isFullySelectedBlock(range, block)) blocks.push(block);
		}
		return blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
	}

	removeBlock(block) {
		if (!block?.isConnected) return;
		const tag = block.tagName.toLowerCase();
		if (tag === "li") {
			const list = block.parentElement;
			block.remove();
			if (list && !list.querySelector(":scope > li")) list.remove();
			return;
		}
		if (tag === "p" && block.parentElement?.tagName?.toLowerCase() === "blockquote") {
			const quote = block.parentElement;
			block.remove();
			if (!quote.querySelector(this.blockSelector())) quote.remove();
			return;
		}
		block.remove();
	}

	deleteSelectedBlocks(session = null) {
		const blocks = this.fullySelectedBlocks(session);
		if (blocks.length === 0) return false;
		const afterBlock = blocks.map(block => this.firstBlockIn(block.nextElementSibling)).find(Boolean);
		const beforeBlock = [...blocks].reverse().map(block => this.lastBlockIn(block.previousElementSibling)).find(Boolean);
		for (const block of blocks) this.removeBlock(block);
		this.syncAfterMutation(afterBlock ? { block: afterBlock } : beforeBlock ? { block: beforeBlock, type: "end" } : null, session);
		return true;
	}

	deleteEmptyBlock(session = null) {
		const range = this.nativeRange(session);
		if (!range?.collapsed) return false;
		const block = this.blockFor(range.startContainer);
		if (!block || !this.isEmptyBlock(block)) return false;
		const afterBlock = this.firstBlockIn(block.nextElementSibling);
		const beforeBlock = this.lastBlockIn(block.previousElementSibling);
		this.removeBlock(block);
		this.syncAfterMutation(afterBlock ? { block: afterBlock } : beforeBlock ? { block: beforeBlock, type: "end" } : null, session);
		return true;
	}

	rangeAtBlockStart(range, block) {
		if (!range?.collapsed || !block?.contains(range.startContainer)) return false;
		const before = document.createRange();
		before.selectNodeContents(block);
		before.setEnd(range.startContainer, range.startOffset);
		return before.toString().replace(/\u200b/g, "") === "";
	}

	previousEditableBlock(block) {
		let sibling = block?.previousElementSibling ?? null;
		while (sibling) {
			const previous = this.lastBlockIn(sibling);
			if (previous) return previous;
			sibling = sibling.previousElementSibling;
		}
		return null;
	}

	mergeBlockBackward(session = null, event = null) {
		if (event && event.key !== "Backspace") return false;
		const range = this.nativeRange(session);
		if (!range?.collapsed) return false;
		const block = this.blockFor(range.startContainer);
		if (!block || !this.rangeAtBlockStart(range, block)) return false;
		const previous = this.previousEditableBlock(block);
		if (!previous) return false;

		for (const child of [...previous.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") child.remove();
		}
		const markerText = this.lastTextNode(previous);
		const markerNode = markerText ?? previous;
		const markerOffset = markerText ? markerText.data.length : previous.childNodes.length;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
				child.remove();
			} else {
				previous.appendChild(child);
			}
		}
		block.remove();
		const active = this.activeSession(session);
		this.lastNormalization = this.normalize(this.root, { session: active });
		this.text.refresh();
		this.setCursorAtPoint(markerNode, markerOffset, active);
		active.currentBlock = previous;
		if (active === this.localSession) this._currentBlock = previous;
		active.classes?.update();
		return true;
	}

	splitRange(range) {
		if (!range.collapsed) {
			range.deleteContents();
			range.collapse(true);
		}
		return range;
	}

	exitEmptyBlock(block, session = null) {
		if (!this.isEmptyBlock(block)) return false;
		const container = block.parentElement ?? this.root;
		if (container === this.root) {
			const defaultTag = this.schema.defaultChild(":root");
			const next = this.schema.tag(block) === defaultTag ? block : this.replaceBlock(block, defaultTag);
			next.replaceChildren();
			this.ensureEditableContent(next, true);
			this.syncAfterMutation({ block: next }, session);
			return true;
		}
		const outerParent = container.parentElement ?? this.root;
		const nextBlock = this.createBlock(this.schema.defaultChild(outerParent === this.root ? ":root" : outerParent));
		container.parentNode.insertBefore(nextBlock, container.nextSibling);
		block.remove();
		this.syncAfterMutation({ block: nextBlock }, session);
		return true;
	}

	splitBlockElement(block, range, session = null) {
		if (this.isEmptyBlock(block)) return this.exitEmptyBlock(block, session);
		const parent = block.parentElement === this.root ? null : block.parentElement;
		const nextTag = this.schema.enterNext(block, parent, this.schema.defaultChild(":root"));
		const nextBlock = document.createElement(nextTag);
		const trailing = document.createRange();
		trailing.selectNodeContents(block);
		trailing.setStart(range.startContainer, range.startOffset);
		nextBlock.appendChild(trailing.extractContents());
		this.ensureEditableContent(block, true);
		this.ensureEditableContent(nextBlock, true);
		block.parentNode.insertBefore(nextBlock, block.nextSibling);
		this.syncAfterMutation({ block: nextBlock }, session);
		return true;
	}

	splitListItem(item, range, session = null) {
		if (this.isEmptyBlock(item)) return this.exitEmptyBlock(item, session);
		const nextItem = document.createElement("li");
		const trailing = document.createRange();
		trailing.selectNodeContents(item);
		trailing.setStart(range.startContainer, range.startOffset);
		nextItem.appendChild(trailing.extractContents());
		this.ensureEditableContent(item, true);
		this.ensureEditableContent(nextItem, true);
		item.parentNode.insertBefore(nextItem, item.nextSibling);
		this.syncAfterMutation({ block: nextItem }, session);
		return true;
	}

	insertLineBreak(session = null) {
		const range = this.nativeRange(session);
		if (!range) return false;
		const block = this.blockFor(range.startContainer);
		if (!block) return false;
		this.splitRange(range);
		const br = document.createElement("br");
		const tail = document.createTextNode("");
		range.insertNode(tail);
		range.insertNode(br);
		this.syncAfterMutation(null, session);
		this.setCursorAtPoint(tail, 0, session);
		this.activeSession(session).classes?.update();
		return true;
	}

		splitCurrentBlock(session = null) {
			const range = this.nativeRange(session);
			if (!range) return false;
			const block = this.blockFor(range.startContainer);
			if (!block?.contains(range.startContainer)) return false;
			this.splitRange(range);
			return block.tagName.toLowerCase() === "li"
				? this.splitListItem(block, range, session)
				: this.splitBlockElement(block, range, session);
		}

		indentListItem(item, session = null) {
			const previous = item.previousElementSibling;
			const list = item.parentElement;
			if (previous?.tagName?.toLowerCase() !== "li" || !list) return false;
			let nested = previous.lastElementChild;
			const tag = list.tagName.toLowerCase();
		if (!nested || nested.tagName.toLowerCase() !== tag) {
			nested = document.createElement(tag);
			previous.appendChild(nested);
		}
		nested.appendChild(item);
		this.syncAfterMutation({ block: item }, session);
		return true;
	}

	dedentListItem(item, session = null) {
		const list = item.parentElement;
		const parentItem = list?.parentElement?.closest("li");
		if (parentItem) {
			parentItem.parentElement.insertBefore(item, parentItem.nextSibling);
			if (!list.querySelector(":scope > li")) list.remove();
			this.syncAfterMutation({ block: item }, session);
			return true;
		}
		if (!list) return false;
		const paragraph = document.createElement(this.schema.defaultChild(":root"));
		while (item.firstChild) paragraph.appendChild(item.firstChild);
		this.ensureEditableContent(paragraph, true);
		list.parentNode.insertBefore(paragraph, list.nextSibling);
		item.remove();
		if (!list.querySelector(":scope > li")) list.remove();
		this.syncAfterMutation({ block: paragraph }, session);
		return true;
	}

	currentListItem(session = null) {
		const active = this.activeSession(session);
		const block = active.currentBlock?.isConnected && active.currentBlock.tagName?.toLowerCase() === "li"
			? active.currentBlock
			: this.currentEditableBlock(active);
		return block?.tagName?.toLowerCase() === "li" ? block : null;
	}

	indentCurrentListItem(session = null) {
		const item = this.currentListItem(session);
		return item ? this.indentListItem(item, session) : false;
	}

	dedentCurrentListItem(session = null) {
		const item = this.currentListItem(session);
		return item ? this.dedentListItem(item, session) : false;
	}
}

export { Schema, Adapter, ClassTracker, Command, Cursor, Editor, EditorSession, Normalizer, Transaction, richTextClasses, richTextKeymap, richTextNormalizer, richTextSchema };
// EOF
