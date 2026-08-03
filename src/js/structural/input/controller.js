// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: input/controller
// Keyboard and mouse listeners translating raw user input to structural cursor ops.

import { EditorKeyboardInput } from "./keyboard.js";
import { EditorPointerInput } from "./pointer.js";

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
		// True from an in-root mousedown until the matching mouseup (incl. drag-out).
		this._mouseOwned = false;
		// True after the user last interacted with this editor (survives mouseup).
		// Used so paste/copy still target us when focus stays on body (virtual caret).
		this._editorActive = false;
		// While true, ignore collapsed browser carets (click placement is often off-by-one
		// vs our point resolution). Cleared after mouseup re-asserts structural→native.
		this._suppressCollapsedNative = false;
		this._syncingNative = false;
		this._nativeSyncEpoch = 0;
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
		this.keyboard = new EditorKeyboardInput(this);
		this.pointer = new EditorPointerInput(this);
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
		this._mouseOwned = false;
		this._editorActive = false;
		return this;
	}

	// Method: onKeyUp
	// KeyUp handler (not implemented).
	onKeyUp(_event) {
		// Text input is handled during keydown so control keys can be
		// swallowed before they perform browser-default actions.
	}

	// Method: _guardNativeSync
	// Runs `fn` while selectionchange→syncFromNative is suppressed. Chromium fires
	// selectionchange asynchronously after setBaseAndExtent/addRange, so the guard
	// stays up until the next macrotask (not only for the sync call stack).
	_guardNativeSync(fn) {
		this._syncingNative = true;
		const epoch = ++this._nativeSyncEpoch;
		try {
			return fn?.();
		} finally {
			const release = () => {
				if (this._nativeSyncEpoch === epoch) this._syncingNative = false;
			};
			if (typeof queueMicrotask === "function") {
				queueMicrotask(() => {
					if (typeof setTimeout === "function") setTimeout(release, 0);
					else release();
				});
			} else if (typeof setTimeout === "function") {
				setTimeout(release, 0);
			} else {
				release();
			}
		}
	}

	// Method: onSelectionChange
	// Syncs browser selection into the structural cursor. Collapsed carets are skipped
	// while a click is in progress (_suppressCollapsedNative) or in virtual-only mode.
	onSelectionChange() {
		if (this._dragAnchor != null || this._syncingNative) return;
		if (this.cursor?.selectionKind === "range" || this.cursor?.selectionKind === "node") {
			const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
			if (!sel?.rangeCount || sel.isCollapsed) return;
		}
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

	// Method: _isForeignEditable
	// True when `el` is a native editable control outside this editor root.
	// Document-level key listeners must not steal keys from foreign inputs/textareas.
	_isForeignEditable(el) {
		const root = this.editor?.root;
		if (!el || !root || el === root || root.contains(el)) return false;
		const tag = el.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
		return !!el.isContentEditable;
	}

	// Method: _eventInRoot
	// True when the event target is the editor root or a descendant.
	_eventInRoot(event) {
		const root = this.editor?.root;
		if (!root?.isConnected || !event) return false;
		const t =
			event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
		return !!t && (t === root || root.contains(t));
	}

	// Method: onKeyDown
	// Handles key presses translating arrows, deletes, letters to cursor calls.
	onKeyDown(event) {
		return this.keyboard.onKeyDown(event);
	}

	// Method: onMouseUp
	// After a drag gesture, keep structural selection (already updated in mousemove).
	// Simple clicks: re-assert structural placement so Chromium's center-of-glyph caret
	// cannot override mousedown. Range selections (drag or double-click word) are kept.
	onMouseUp(_event) {
		return this.pointer.onMouseUp(_event);
	}

	// Method: onMouseMove
	// While the mouse button is held, extend the selection from the drag anchor.
	// This provides reliable drag-to-select (including across block boundaries)
	// even when using virtual selection mode (which clears native ranges).
	onMouseMove(event) {
		return this.pointer.onMouseMove(event);
	}

	// Method: onMouseDown
	// Evaluates pointer coordinate clicks to accurately place caret or select blocks.
	// Also initiates drag selection tracking (and shift-click extend).
	onMouseDown(event) {
		return this.pointer.onMouseDown(event);
	}

	// Method: _wordRangeAt
	// Returns structural {start,end} covering the word at logical `offset`, or null.
	_wordRangeAt(offset) {
		return this.pointer._wordRangeAt(offset);
	}
}

export { EditorTextInput };
