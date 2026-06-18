// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: editor
// Implements core editor orchestration, schemas, commands, transactions, and event listeners.

import { TextAdapter } from "./text.js";
import { Cursor as EditorCursor } from "./cursor.js";
import { EditorRangeController } from "./range.js";
import { EditorSelectionController } from "./selection.js";

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
	}

	// Method: rule
	// Gets the rule associated with a specific tag name or DOM node.
	rule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return tag ? this.rules[tag] ?? null : null;
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
		return this.expand(rule.contains).includes(this.tag(child));
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

	// Method: normalizeRule
	// Gets the normalization rules configured for a tag.
	normalizeRule(nodeOrTag) {
		const tag = this.tag(nodeOrTag);
		return {
			...(this.options.normalize ?? {}),
			...(tag ? this.rule(tag)?.normalize ?? {} : {}),
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

	// Method: normalizeChild
	// Evaluates a child element against parent's schema expectations and repairs if invalid.
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
			transaction.steps.push({ type: "wrapNode", tag: this.schema.tag(child), wrapper: wrapper.tagName.toLowerCase() });
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
			node.appendChild(document.createElement("br"));
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
		return [...node.childNodes].every(child =>
			(child.nodeType === Node.TEXT_NODE && child.data.length === 0) ||
			(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br")
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
		this.nativeSelection = options.nativeSelection ?? "none";
		this.currentBlock = null;
		this.cursor = new EditorCursor(this, options.cursor);
		this.classes = options.classes ? new EditorClassController(this, options.classes).attach() : null;
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
	}

	// Method: snapshotSelection
	// Records a serializable snapshot of the current cursor selection state.
	snapshotSelection() {
		return {
			offset: this.cursor.offset ?? 0,
			selectionKind: this.cursor.selectionKind,
			anchorOffset: this.cursor.anchor ? this.text.indexOfPoint({ node: this.cursor.anchor, offset: 0 }) : -1,
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
		return this.options[key] ?? key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
	}

	// Method: selector
	// Resolves selection elements matching active block/inline tag names.
	selector() {
		const selector = this.options.selector ?? [
			this.editor.schema?.selector("block"),
			this.editor.schema?.selector("inline"),
		].filter(Boolean);
		return Array.isArray(selector) ? selector.filter(Boolean).join(", ") : selector;
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
		this.session = options.session ?? editor.session("local", {
			actor: "local",
			nativeSelection: "sync",
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
		}
		this.editor = null;
		return this;
	}

	// Method: onKeyUp
	// KeyUp handler (not implemented).
	onKeyUp(_event) {
		// Text input is handled during keydown so control keys can be
		// swallowed before they perform browser-default actions.
	}

	// Method: onKeyDown
	// Handles key presses translating arrows, deletes, letters to cursor calls.
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

	// Method: onMouseDown
	// Evaluates pointer coordinate clicks to accurately place caret or select blocks.
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
			if (!this.editor.selection.placeCaretFromPoint(container, event.clientX, event.clientY, this.session, {
				fallback: "none",
			})) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side =
					event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
			}
			return;
		}
		// FIXME: Not great to have this here
		this.editor.selection.placeCaretFromPoint(this.editor.root, event.clientX, event.clientY, this.session);
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
		this.schema = options.schema instanceof EditorSchema
			? options.schema
			: new EditorSchema(options.schema ?? {});
		this.normalizer = options.normalizer ?? new EditorNormalizer(this.schema);
		this.keymap = options.keymap ?? {};
		this.actions = new Map();
		this.history = [];
		this.sessions = new Map();
		this.plugins = [];
		this._active = false;
		this._currentBlock = null;
		this.text = new TextAdapter(node, options.text).attach();
		this.localSession = this.session("local", {
			actor: "local",
			nativeSelection: "sync",
			classes: options.classes,
			cursor: options.cursor,
		});
		this.range = new EditorRangeController(this);
		this.selection = new EditorSelectionController(this);
		this.input = new EditorTextInput(this, { ...options, session: this.localSession });
		this.installPlugins(options.plugins ?? []);
		this.classes = this.localSession.classes;
		this.input.cursor.moveTo(8);
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
		const instance = typeof plugin === "function"
			? (plugin.prototype?.attach ? new plugin() : plugin(this))
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
				if (plugin.constructor?.pluginName === type || plugin.constructor?.name === type) return plugin;
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
		const transaction = result instanceof EditorTransaction
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
		return this.normalizer?.normalize(target, {
			editor: this,
			root: this.root,
			schema: this.schema,
			...context,
		}) ?? new EditorTransaction(new EditorCommand("normalize"), { result: false });
	}

}

export {
	EditorAdapter,
	EditorClassController,
	EditorCommand,
	EditorCursor,
	Editor,
	EditorNormalizer,
	EditorRangeController,
	EditorSchema,
	EditorSelectionController,
	EditorSession,
	EditorTransaction,
};

// EOF
