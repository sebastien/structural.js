// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: input
// Keyboard and mouse listeners translating raw user input to structural cursor ops.

import { wordRangeAtIndex } from "./dom.js";

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
		const root = this.editor?.root;
		if (!root?.isConnected) return;
		// Ignore keys meant for other form controls (chat fields, search, …).
		if (this._isForeignEditable(event.target) || this._isForeignEditable(document.activeElement)) {
			return;
		}
		// Sync before keymap actions (Ctrl+A, Enter, …) so programmatic/native carets win.
		// Do not overwrite an existing structural range (format ops remap it carefully).
		const kind = this.cursor?.selectionKind;
		if (kind !== "range" && kind !== "node") {
			this._syncNativeSelection({ allowCollapsed: true });
		}
		// Contextual input rules run before the keymap so domain handlers (blocks, menus)
		// can claim keys like Enter/ArrowDown without fighting global bindings.
		if (this.editor?.handleInputEvent?.(event, this.session)) {
			this._guardNativeSync(() => {
				this.editor.selection?.syncToNative(this.session);
			});
			return;
		}

		if (this.editor?.handleKeyEvent(event, this.session)) {
			// Keymap handlers (arrows, deleteSmart, …) move the structural caret;
			// re-assert native so the next insert does not re-import a stale range.
			this._guardNativeSync(() => {
				this.editor.selection?.syncToNative(this.session);
			});
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
					const rt = this.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, this.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(this.session);
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
					const rt = this.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, this.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(this.session);
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
		// Ignore mouseups that did not start inside this editor (chat, toolbar, …).
		if (!this._mouseOwned && this._dragAnchor == null) {
			this._suppressCollapsedNative = false;
			this._dragFocus = null;
			return;
		}
		this._mouseOwned = false;
		const didDrag =
			this._dragAnchor != null &&
			this._dragFocus != null &&
			this._dragFocus !== this._dragAnchor;
		const active = this.editor?.activeSession?.(this.session);
		if (active?.cursor?.selectionKind === "range") {
			// Drag or multi-click word/block selection — keep it and align native.
			this._guardNativeSync(() => {
				this.editor.selection?.syncToNative(active);
			});
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
		// Document-level listener: only own clicks that hit this editor's root tree.
		if (!this._eventInRoot(event)) {
			this._mouseOwned = false;
			this._editorActive = false;
			this._dragAnchor = null;
			this._dragFocus = null;
			return;
		}
		this._mouseOwned = true;
		this._editorActive = true;
		// Focus the root so clipboard paste/copy target this editor (virtual caret hosts
		// are often not contenteditable, so click alone may leave focus on body).
		const root = this.editor?.root;
		if (root && typeof root.focus === "function" && document.activeElement !== root) {
			try {
				root.focus({ preventScroll: true });
			} catch (_) {
				root.focus?.();
			}
		}
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
					this._guardNativeSync(() => {
						this.editor.selection.syncToNative(active);
					});
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
					this._guardNativeSync(() => {
						this.editor.selection.syncToNative(active);
					});
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
		return wordRangeAtIndex(this.editor?.text, offset);
	}
}

export { EditorTextInput };
