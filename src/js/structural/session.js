// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: session
// Per-actor editor sessions and focus/selection CSS class tracking.

import { Cursor as EditorCursor } from "./cursor.js";
import { EditorCommand } from "./schema.js";

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

export { EditorClassController, EditorSession };
