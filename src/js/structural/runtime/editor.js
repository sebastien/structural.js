import { Cursor as EditorCursor } from "../interaction/cursor.js";
import { EditorTextInput } from "../interaction/input.js";
import { EditorSelectionController, PlaceholderOverlay } from "../interaction/selection.js";
import { EditorHistory } from "../foundation/history.js";
import { TextAdapter, asElement, blockSelectorFromSchema, firstTextNode as domFirstTextNode, lastTextNode as domLastTextNode } from "../foundation/document.js";
import { EditorCommand, EditorNormalizer, EditorSchema, EditorTransaction } from "../foundation/schema.js";
// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Collects plugin-provided capabilities without coupling Editor to feature types.
class EditorPluginHost {
	constructor(editor) {
		this.editor = editor;
		this._capabilities = new Map();
	}

	register(name, value) {
		if (!name || !value) return value;
		const values = this._capabilities.get(name) ?? [];
		if (!values.includes(value)) values.push(value);
		this._capabilities.set(name, values);
		return value;
	}

	registerPlugin(plugin) {
		if (!plugin) return plugin;
		const name = plugin.constructor?.pluginName ?? plugin.pluginName ?? null;
		if (name) this.register(name, plugin);
		this.register("plugin", plugin);
		if (typeof plugin.scopeNodes === "function") this.register("scope-provider", plugin);
		return plugin;
	}

	get(name) {
		return this._capabilities.get(name)?.[0] ?? null;
	}

	all(name) {
		return [...(this._capabilities.get(name) ?? [])];
	}

	clear() {
		this._capabilities.clear();
	}
}

export { EditorPluginHost };

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: keymap
// Default editor key bindings and history-skip command set (no Editor dependency).

// Function: editorKeymap
// Returns the built-in editing keys. Use this helper to compose custom maps.
export function editorKeymap(overrides = {}) {
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
		"Mod+Z": { type: "undo" },
		"Mod+Shift+Z": { type: "redo" },
		"Mod+Y": { type: "redo" },
		Tab: { type: "moveTraversal", args: { direction: "forward" } },
		"Shift+Tab": { type: "moveTraversal", args: { direction: "backward" } },
		Backspace: { type: "deleteBackward" },
		Delete: { type: "deleteForward" },
		...overrides,
	};
}

// Commands that only move selection — never push history.
export const HISTORY_SKIP = new Set([
	"moveCursor",
	"selectAll",
	"selectStructuralScope",
	"moveStructural",
	"moveTraversal",
	"collapseSelection",
	"collapseStructural",
	"undo",
	"redo",
	"copy",
]);

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-08-03

// Module: rules
// Declarative input-rule matching (when predicates + key/match filters).

// Function: matchInputRuleWhen
// Evaluates a rule's `when` predicate or declarative context matcher.
// `options.domain` may supply handlers for keys the generic matcher should not
// treat as plain context field equality (e.g. Blocks slot/edge/selected).
// Domain handlers return true/false, or undefined to fall through to generic.
export function matchInputRuleWhen(when, ctx, event, options = {}) {
	if (when == null) return true;
	if (typeof when === "function") return !!when(ctx, event);
	if (typeof when !== "object") return !!when;

	const domain = options.domain;

	for (const [key, expected] of Object.entries(when)) {
		if (expected === undefined) continue;
		if (key === "not") {
			if (matchInputRuleWhen(expected, ctx, event, options)) return false;
			continue;
		}
		if (key === "or") {
			const list = Array.isArray(expected) ? expected : [expected];
			if (!list.some((item) => matchInputRuleWhen(item, ctx, event, options))) return false;
			continue;
		}
		if (key === "and") {
			const list = Array.isArray(expected) ? expected : [expected];
			if (!list.every((item) => matchInputRuleWhen(item, ctx, event, options))) return false;
			continue;
		}
		if (key === "test" && typeof expected === "function") {
			if (!expected(ctx, event)) return false;
			continue;
		}
		if (domain && typeof domain[key] === "function") {
			const handled = domain[key](expected, ctx, event, when);
			if (handled !== undefined) {
				if (!handled) return false;
				continue;
			}
		}
		const actual = ctx?.[key];
		if (typeof expected === "boolean") {
			if (!!actual !== expected) return false;
			continue;
		}
		if (expected === null) {
			if (actual != null) return false;
			continue;
		}
		if (typeof expected === "string") {
			if (actual === expected) continue;
			// Allow matching DOM token lists / data attributes via context helpers.
			if (actual?.classList?.contains?.(expected)) continue;
			if (actual != null && String(actual) === expected) continue;
			return false;
		}
		if (typeof expected === "function") {
			if (!expected(actual, ctx, event)) return false;
			continue;
		}
		if (expected instanceof RegExp) {
			expected.lastIndex = 0;
			if (!expected.test(String(actual ?? ""))) return false;
			continue;
		}
		if (actual !== expected) return false;
	}
	return true;
}

// Function: matchInputRuleKey
// Matches event.key against rule.key (string|string[]) and/or rule.match (RegExp).
export function matchInputRuleKey(rule, event) {
	if (!event) return false;
	const key = event.key;
	const hasMod = !!(event.ctrlKey || event.metaKey);
	if (rule.mod != null) {
		if (hasMod !== !!rule.mod) return false;
	} else if (hasMod && rule.allowMod !== true && (rule.key != null || rule.match != null)) {
		// Character/key rules ignore ctrl/meta chords (those belong in the keymap).
		return false;
	}
	if (rule.alt != null && !!event.altKey !== !!rule.alt) return false;
	if (rule.shift != null && !!event.shiftKey !== !!rule.shift) return false;

	let keyOk = true;
	if (rule.key != null) {
		const keys = Array.isArray(rule.key) ? rule.key : [rule.key];
		keyOk = keys.some((k) => {
			if (k === "Space") return key === " ";
			return k === key || (typeof k === "string" && k.toLowerCase() === key.toLowerCase());
		});
	}
	let matchOk = true;
	if (rule.match != null) {
		const re = rule.match instanceof RegExp ? rule.match : new RegExp(rule.match);
		re.lastIndex = 0;
		matchOk = re.test(key);
	}
	// If neither key nor match specified, key always matches (when-only rule).
	if (rule.key == null && rule.match == null) return true;
	if (rule.key != null && rule.match != null) return keyOk || matchOk;
	if (rule.key != null) return keyOk;
	return matchOk;
}

// Domain matchers for structural-block context fields (used by Blocks).
export const blockWhenDomain = {
	slot(expected, ctx) {
		if (expected === "empty" || expected === true) {
			return !!(ctx.slotEmpty || ctx.emptySlot);
		}
		if (typeof expected === "string") {
			return ctx.slotKind === expected || (expected === "empty" && ctx.slotEmpty);
		}
		return undefined;
	},
	slotEmpty(expected, ctx) {
		return !!ctx.slotEmpty === !!expected;
	},
	selected(expected, ctx) {
		const sel = expected;
		if (sel === "op") return !!ctx.isOpSelected;
		if (sel === "hole") return !!ctx.isHoleSelected;
		if (sel === "unit") return !!ctx.isUnitSelected;
		if (sel === "node") return ctx.selectionKind === "node";
		if (sel === true) return ctx.selectionKind === "node";
		if (typeof sel === "string") {
			return ctx.selectedRole === sel || !!ctx.selected?.classList?.contains?.(sel);
		}
		return undefined;
	},
	unit(expected, ctx) {
		if (expected === true) return !!ctx.unit;
		if (expected === false) return !ctx.unit;
		return undefined;
	},
	edge(expected, ctx) {
		if (expected === "start") return ctx.edge === "start";
		if (expected === "end") return ctx.edge === "end";
		if (expected === "inside") return ctx.edge === "inside";
		if (expected === "boundary") return ctx.edge === "start" || ctx.edge === "end";
		return undefined;
	},
	leaf(expected, ctx) {
		if (expected === true) return !!ctx.leaf;
		if (expected === false) return !ctx.leaf;
		if (typeof expected === "string") return !!ctx.leaf?.classList?.contains?.(expected);
		return undefined;
	},
	inLeaf(expected, ctx) {
		return !!ctx.inLeaf === !!expected;
	},
	block(expected, ctx) {
		if (expected === true) return !!ctx.block;
		if (typeof expected === "string") return ctx.block?.dataset?.op === expected;
		return undefined;
	},
	role(expected, ctx) {
		return ctx.role === expected || ctx.selectedRole === expected;
	},
};

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: session
// Per-actor editor sessions and focus/selection CSS class tracking.


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
		const selection = this.cursor.selection;
		const anchor = selection?._anchorPoint;
		return {
			offset: this.cursor.offset ?? 0,
			selectionKind: this.cursor.selectionKind,
			anchorOffset: anchor ? this.text.indexOfPoint(anchor) : this.cursor.offset ?? -1,
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

export { EditorClassController, EditorSession };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-19

// Module: range
// Editor-level DOM range helpers, snapshots, and restoration utilities.

// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: EditorRangeController
// Coordinates DOM Range access and subtree-local range snapshots for an Editor.
class EditorRangeController {
	constructor(editor) {
		this.editor = editor;
	}

	// Method: _elementFor
	// Resolves an element container for `node`.
	_elementFor(node) {
		if (!node) return null;
		return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	}

	// Method: _contains
	// Checks if `root` contains `node`.
	_contains(root, node) {
		const element = this._elementFor(node);
		return !!element && (element === root || root.contains(element));
	}

	// Method: within
	// Validates whether `range` stays fully within `root`.
	within(root = this.editor.root, range) {
		if (!root || !range) return false;
		return this._contains(root, range.startContainer) && this._contains(root, range.endContainer);
	}

	// Method: current
	// Returns the current DOM range or caret range within `root`.
	current(root = this.editor.root, session = null) {
		const active = this.editor.activeSession(session);
		const cursor = active.cursor;
		if (cursor.selectionKind === "range") {
			const range = cursor.selection.toDomRange();
			if (this.within(root, range) && !range.collapsed) return range;
		}
		const selection = window.getSelection();
		if (active.nativeSelection !== "none" && selection?.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (this.within(root, range)) return range.cloneRange();
		}
		const point = this.editor.text.pointAt(cursor.offset ?? 0);
		if (!point?.node || !this._contains(root, point.node)) return null;
		const range = document.createRange();
		range.setStart(point.node, point.offset);
		range.collapse(true);
		return range;
	}

	// Method: selected
	// Returns the current expanded DOM range within `root`.
	selected(root = this.editor.root, session = null) {
		const range = this.current(root, session);
		return range && !range.collapsed ? range : null;
	}

	// Method: atBlockEdge
	// Checks if `range` is collapsed at the requested block edge.
	atBlockEdge(range, block, edge = "start") {
		if (!range?.collapsed || !this._contains(block, range.startContainer)) return false;
		const probe = document.createRange();
		probe.selectNodeContents(block);
		if (edge === "end") probe.setStart(range.startContainer, range.startOffset);
		else probe.setEnd(range.startContainer, range.startOffset);
		return probe.toString().replace(/\u200b/g, "") === "";
	}

	// Method: atBlockStart
	// Checks if `range` is collapsed at the start edge of `block`.
	atBlockStart(range, block) {
		return this.atBlockEdge(range, block, "start");
	}

	// Method: atBlockEnd
	// Checks if `range` is collapsed at the end edge of `block`.
	atBlockEnd(range, block) {
		return this.atBlockEdge(range, block, "end");
	}

	// Method: split
	// Deletes selected contents and collapses the range to its start.
	split(range) {
		if (!range.collapsed) {
			range.deleteContents();
			range.collapse(true);
		}
		return range;
	}

	// Method: snapshot
	// Saves a subtree-local text range snapshot for the active selection.
	snapshot(root = this.editor.root, session = null) {
		const range = this.selected(root, session);
		if (!range) return null;
		const start = this.editor.text.offsetWithin(root, {
			node: range.startContainer,
			offset: range.startOffset,
		});
		const end = this.editor.text.offsetWithin(root, {
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0 || end < 0) return null;
		return { start, end };
	}

	// Method: restore
	// Restores a subtree-local text range snapshot.
	restore(snapshot, root = this.editor.root, session = null) {
		if (!snapshot || !root?.isConnected) return false;
		this.editor.text.refresh();
		const startPoint = this.editor.text.pointAtOffsetWithin(root, snapshot.start ?? 0, "forward");
		const endPoint = this.editor.text.pointAtOffsetWithin(root, snapshot.end ?? snapshot.start ?? 0, "backward");
		if (!startPoint?.node || !endPoint?.node) return false;
		// indexOfPoint will expand window to cover points if needed
		const start = this.editor.text.indexOfPoint(startPoint);
		const end = this.editor.text.indexOfPoint(endPoint);
		if (start < 0 || end < 0) return false;
		return start === end
			? this.editor.selection.setCaret(endPoint.node, endPoint.offset, session)
			: this.editor.selection.select(start, end, session);
	}
}

export { EditorRangeController };

// EOF

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: editor
// Implements core editor orchestration and action dispatch.
// Sessions, schema, history, input, and keymap live in sibling modules.


// Class: Editor
// Orchestrates editor state, schema normalizations, keymaps, and action dispatches.
// - root: HTMLElement - container editor element
class Editor {
	// Method: constructor
	// Initializes and configures the parent Editor environment.
	constructor(node, options = {}) {
		this.root = node;
		if (this.root && this.root.tabIndex < 0) this.root.tabIndex = 0;
		this.schema =
			options.schema instanceof EditorSchema
				? options.schema
				: new EditorSchema(options.schema ?? {});
		this.normalizer = options.normalizer ?? new EditorNormalizer(this.schema);
		// Custom maps override individual defaults without disabling unrelated editor keys.
		this.keymap = editorKeymap(options.keymap ?? {});
		this.actions = new Map();
		// Contextual input rules matched before the keymap (see handleInputEvent / onKeyDown).
		this.inputRules = [];
		if (Array.isArray(options.inputRules)) this.addInputRules(options.inputRules);
		this.history = new EditorHistory(this, options.history);
		this.sessions = new Map();
		this.plugins = [];
		this.pluginHost = new EditorPluginHost(this);
		this._active = false;
		this._currentBlock = null;
		// Optional app/plugin hook: (session) => partial context merged into contextAt().
		this._contextAt = typeof options.contextAt === "function" ? options.contextAt : null;
		// Optional scope provider (e.g. Blocks): { scopeNodes, applyScopeSelection, collapseScopeSelection }.
		this.scopeProvider = options.scopeProvider ?? null;
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
						if (command.args.word) cursor.wordLeft(extend);
						else cursor.left(extend);
						break;
					case "right":
						if (command.args.word) cursor.wordRight(extend);
						else cursor.right(extend);
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
			undo: () => this.undo(),
			redo: () => this.redo(),
		});
		this.installPlugins(options.plugins ?? []);
		this.classes = this.localSession.classes;
		this.placeholder =
			options.placeholder === false ? null : new PlaceholderOverlay(this, options.placeholder);
		// Do not force an initial cursor position here; callers (or first interaction)
		// should place the caret at a valid/visible slot. A previous moveTo(8) was a
		// debug leftover that caused bad initial state on small/empty documents.
	}

	// Method: blockSelector
	// CSS selector for navigable/editable blocks (schema-driven; plugins may override).
	blockSelector() {
		return blockSelectorFromSchema(this.schema);
	}

	// Method: blockFor
	// Nearest ancestor block element for `node`, or null if outside the editor.
	blockFor(node) {
		const el = asElement(node);
		const block = el?.closest(this.blockSelector());
		return block && this.root.contains(block) ? block : null;
	}

	// Method: firstTextNode / lastTextNode
	// DOM text-node helpers (shared with plugins; kept on Editor for app convenience).
	firstTextNode(node) {
		return domFirstTextNode(node);
	}

	lastTextNode(node) {
		return domLastTextNode(node);
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

	// Method: scopeNodes
	// Ladder for selectStructuralScope. Consults registered scope providers first.
	scopeNodes(session = null) {
		const active = this.activeSession(session);
		const providers = [
			...this.pluginHost.all("scope-provider"),
			...(this.scopeProvider ? [this.scopeProvider] : []),
		];
		for (const provider of new Set(providers)) {
			if (typeof provider?.scopeNodes !== "function") continue;
			const nodes = provider.scopeNodes(active);
			if (Array.isArray(nodes)) return nodes;
		}
		return this.structuralScopeNodes(active);
	}

	// Method: applyScopeSelection
	// Selects a scope ladder node. Default: text range. Provider may node-select.
	applyScopeSelection(node, session = null, options = {}) {
		const active = this.activeSession(session);
		const providers = [
			...this.pluginHost.all("scope-provider"),
			...(this.scopeProvider ? [this.scopeProvider] : []),
		];
		for (const provider of new Set(providers)) {
			if (typeof provider?.applyScopeSelection !== "function") continue;
			const result = provider.applyScopeSelection(node, active, options);
			if (result !== undefined) return result;
		}
		const range = this.structuralRangeFor(node);
		if (!range || range.end <= range.start) return false;
		this.selection.select(range.start, range.end, active);
		return this.selection.syncToNative(active);
	}

	// Method: collapseScopeSelection
	// Exits the scope ladder to a caret (or provider-specific inner focus).
	collapseScopeSelection(session = null) {
		const active = this.activeSession(session);
		const providers = [
			...this.pluginHost.all("scope-provider"),
			...(this.scopeProvider ? [this.scopeProvider] : []),
		];
		for (const provider of new Set(providers)) {
			if (typeof provider?.collapseScopeSelection !== "function") continue;
			const result = provider.collapseScopeSelection(active);
			if (result !== undefined) return result;
		}
		const cursor = active.cursor;
		cursor.moveTo(cursor.selection?.focusOffset ?? cursor.offset ?? 0);
		return this.selection.syncToNative(active);
	}

	// Method: structuralRangeFor
	// Converts an element's text contents to the editor's logical selection range.
	structuralRangeFor(node) {
		if (!node?.isConnected) return null;
		// Prefer content text nodes. Formatting-only whitespace between blocks is not
		// always present in the position index, so a raw TreeWalker end can miss.
		const acceptContentText = {
			acceptNode: (n) => {
				if (!n?.data?.replace(/\u200b/g, "").trim()) {
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
	// Expands/contracts along scopeNodes(). First expand selects the innermost
	// scope; further expands walk outward. Contract steps in, then collapses.
	// scopeProvider (e.g. Blocks) supplies the ladder and selection style.
	selectStructuralScope(mode = "expand", session = null) {
		const active = this.activeSession(session);
		const cursor = active.cursor;
		const fresh = this.scopeNodes(active);
		if (!fresh.length) return false;

		const stored = cursor._structuralScopePath?.filter((node) => node?.isConnected);
		const path =
			stored?.length && stored.some((n) => fresh.includes(n)) ? stored : fresh;

		let currentIdx = path.indexOf(cursor._structuralScopeNode);
		if (currentIdx < 0 && cursor.selectedNode) {
			currentIdx = path.indexOf(cursor.selectedNode);
		}

		if (mode === "contract") {
			if (currentIdx <= 0) {
				cursor._structuralScopeNode = null;
				cursor._structuralScopePath = null;
				return this.collapseScopeSelection(active);
			}
			currentIdx -= 1;
		} else {
			// First press: innermost (0). Later presses: step outward.
			currentIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, path.length - 1);
		}

		// Walk until apply succeeds (range unresolvable / node detached).
		for (
			let i = currentIdx;
			mode === "expand" ? i < path.length : i >= 0;
			i += mode === "expand" ? 1 : -1
		) {
			const target = path[i];
			if (!target?.isConnected) continue;
			if (this.applyScopeSelection(target, active, { mode }) !== false) {
				cursor._structuralScopeNode = target;
				cursor._structuralScopePath = path;
				return true;
			}
		}
		// Still handled: swallow browser Ctrl+A even if we cannot grow further.
		return cursor.selectionKind === "range" || cursor.selectionKind === "node";
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
		this.placeholder?.destroy();
		this.placeholder = null;
		for (const plugin of this.plugins) plugin.detach?.(this);
		this.pluginHost.clear();
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

	// Method: addInputRules
	// Appends (or prepends) contextual input rules matched by handleInputEvent.
	addInputRules(rules = [], options = {}) {
		if (!Array.isArray(rules) || !rules.length) return this;
		if (options.prepend) this.inputRules.unshift(...rules);
		else this.inputRules.push(...rules);
		return this;
	}

	// Method: removeInputRules
	// Removes the exact rule instances previously registered by a plugin.
	removeInputRules(rules = []) {
		if (!Array.isArray(rules) || !rules.length) return this;
		const remove = new Set(rules);
		this.inputRules = this.inputRules.filter((rule) => !remove.has(rule));
		return this;
	}

	// Method: contextAt
	// Builds a cursor/selection context object. Plugins may enrich via enrichContext().
	contextAt(session = null) {
		const active = this.activeSession(session);
		const cursor = active.cursor;
		const anchor = cursor.anchor;
		const selected = cursor.selectionKind === "node" ? cursor.selectedNode : null;
		const point = this.text.pointAt(cursor.offset ?? 0);
		const ctx = {
			session: active,
			cursor,
			offset: cursor.offset ?? 0,
			selectionKind: cursor.selectionKind,
			selected,
			anchor,
			point,
			root: this.root,
		};
		if (typeof this._contextAt === "function") {
			Object.assign(ctx, this._contextAt.call(this, active, ctx) ?? {});
		}
		for (const plugin of this.plugins) {
			plugin.enrichContext?.(ctx, active);
		}
		return ctx;
	}

	// Method: matchInputRule
	// Returns the first input rule matching event + context, or null.
	matchInputRule(event, context = null) {
		if (!event || !this.inputRules?.length) return null;
		const ctx = context ?? this.contextAt();
		for (const rule of this.inputRules) {
			if (!rule || rule.enabled === false) continue;
			if (!matchInputRuleWhen(rule.when, ctx, event)) continue;
			if (!matchInputRuleKey(rule, event)) continue;
			return rule;
		}
		return null;
	}

	// Method: handleInputEvent
	// Runs matching input rules in order. Returns true when a rule claims the event.
	// A handler may return false to decline and let the next matching rule try.
	handleInputEvent(event, session = null) {
		if (!event || !this.inputRules?.length) return false;
		const active = this.activeSession(session);
		const ctx = this.contextAt(active);
		for (const rule of this.inputRules) {
			if (!rule || rule.enabled === false) continue;
			if (!matchInputRuleWhen(rule.when, ctx, event)) continue;
			if (!matchInputRuleKey(rule, event)) continue;

			const args = {
				...(typeof rule.args === "function" ? rule.args(ctx, event) : (rule.args ?? {})),
			};
			if (args.key === undefined) args.key = event.key;
			if (args.event === undefined) args.event = event;
			if (args.context === undefined) args.context = ctx;

			let result;
			if (typeof rule.do === "function") {
				result = rule.do(args, { editor: this, session: active, event, context: ctx, rule });
			} else if (typeof rule.do === "string") {
				result = this.action(
					{ type: rule.do, args: { ...args, ...(rule.actionArgs ?? {}) } },
					{ event, session: active },
				);
			} else if (rule.do && typeof rule.do === "object") {
				const spec = rule.do.type
					? {
							...rule.do,
							args: {
								...(rule.do.args ?? {}),
								...args,
							},
						}
					: rule.do;
				result = this.action(spec, { event, session: active });
			} else {
				continue;
			}
			if (result === false) continue;
			event.preventDefault();
			event.stopPropagation();
			return true;
		}
		return false;
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
		if (instance) {
			this.plugins.push(instance);
			this.pluginHost.registerPlugin(instance);
		}
		return instance ?? null;
	}

	// Method: capability
	// Resolves the first plugin registered for a capability name.
	capability(name) {
		return this.pluginHost.get(name);
	}

	// Method: capabilities
	// Returns every plugin registered for a capability name in installation order.
	capabilities(name) {
		return this.pluginHost.all(name);
	}

	// Method: plugin
	// Resolves an installed plugin by constructor, name, or exact instance.
	plugin(type) {
		if (!type) return null;
		if (typeof type === "string") {
			const registered = this.capability(type);
			if (registered) return registered;
		}
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

	// Method: undo
	// Restores the previous document snapshot.
	undo(session = null) {
		return this.history.undo(this.activeSession(session));
	}

	// Method: redo
	// Re-applies a previously undone snapshot.
	redo(session = null) {
		return this.history.redo(this.activeSession(session));
	}

	// Method: noteEdit
	// Records a before-change history snapshot (used by cursor text ops).
	noteEdit(kind = "edit", session = null) {
		this.history.record(kind, this.activeSession(session));
		return this;
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
		// Text ops record inside Cursor; deleteSmart records via history.run;
		// undo/redo must not snapshot themselves.
		const skipRecord =
			HISTORY_SKIP.has(command.type) ||
			options.history === false ||
			command.type === "deleteBackward" ||
			command.type === "deleteForward" ||
			command.type === "deleteSmart" ||
			command.type === "cut" ||
			command.type === "paste";
		if (!skipRecord) {
			const kind =
				command.type === "splitBlock" || command.type === "insertLineBreak"
					? "input"
					: command.type;
			this.history.record(kind, session);
		}
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
	// Matched bindings always swallow the event so browser chords (Ctrl+B bookmark,
	// Ctrl+I info panel, …) cannot fire even when the action is a no-op.
	handleKeyEvent(event, session = null) {
		const spec = this.keymap?.[this.keyCombo(event)] ?? this.keymap?.[event.key];
		if (!spec) return false;
		this.action(spec, { event, session });
		event.preventDefault();
		event.stopPropagation();
		return true;
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

	/* Replaces or commits editor content and resolves after paint. */
	setContent(content = undefined, options = {}) {
		const active = this.activeSession(options.session);
		const range = active.cursor.selection.normalizedRange();
		const selection = options.selection ?? {
			start: range.start ?? active.cursor.offset ?? 0,
			end: range.end ?? active.cursor.offset ?? 0,
		};
		// External content replace resets history; internal refresh keeps it.
		if (content !== undefined && content !== this.root && options.history !== true) {
			this.history.clear();
		}
		if (content !== undefined && content !== this.root) this.root.replaceChildren(content);
		this.lastNormalization = this.normalize(this.root, { session: active });
		this.text.refresh();
		if (selection.node?.isConnected) {
			if (selection.position) this.selection._setEdgeCaret(selection.node, selection.position, active);
			else this.selection.setCaret(selection.node, selection.offset ?? 0, active);
		} else if (typeof selection.start === "number" && typeof selection.end === "number") {
			this.selection.select(this.text.clampIndex(selection.start), this.text.clampIndex(selection.end), active);
		} else {
			this.selection._setEdgeCaret(this.root, "start", active);
		}
		active.classes?.update();
		return new Promise((resolve) => {
			const frame = globalThis.requestAnimationFrame ?? ((callback) => queueMicrotask(callback));
			frame(() => resolve(this.lastNormalization));
		});
	}
}

export {
	Editor,
	EditorCommand,
	EditorCursor,
	EditorHistory,
	EditorNormalizer,
	EditorSchema,
	EditorSelectionController,
	EditorTextInput,
	EditorTransaction,
};

// EOF
