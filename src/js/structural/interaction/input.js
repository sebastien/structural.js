import { LEGACY_ATOM_SELECTOR, LEGACY_CONTAINER_SELECTOR, LEGACY_SKIPPED_SELECTOR, wordRangeAtIndex } from "../foundation/document.js";
// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: input/keyboard
// Keyboard listener translating raw user input to structural cursor ops.

// Class: EditorKeyboardInput
// Handles keyboard input for an EditorTextInput controller.
class EditorKeyboardInput {
	constructor(input) {
		this.input = input;
	}

	// Method: onKeyDown
	// Handles key presses translating arrows, deletes, letters to cursor calls.
	onKeyDown(event) {
		const input = this.input;
		const root = input.editor?.root;
		if (!root?.isConnected) return;
		const documentEvent = event.target === document && !input._isForeignEditable(document.activeElement);
		const nativeSelection = window.getSelection?.();
		const selectionInRoot = nativeSelection?.rangeCount > 0 &&
			input.editor.range.within(root, nativeSelection.getRangeAt(0));
		if (!input._eventInRoot(event) && !input._editorActive && !documentEvent && !selectionInRoot) {
			return;
		}
		// Ignore keys meant for other form controls (chat fields, search, ...).
		if (input._isForeignEditable(event.target) || input._isForeignEditable(document.activeElement)) {
			return;
		}
		// Sync before keymap actions (Ctrl+A, Enter, ...) so programmatic/native carets win.
		// Do not overwrite an existing structural range (format ops remap it carefully).
		const kind = input.cursor?.selectionKind;
		if (kind !== "range" && kind !== "node") {
			input._syncNativeSelection({ allowCollapsed: true });
		}
		// Contextual input rules run before the keymap so domain handlers (blocks, menus)
		// can claim keys like Enter/ArrowDown without fighting global bindings.
		if (input.editor?.handleInputEvent?.(event, input.session)) {
			input._guardNativeSync(() => {
				input.editor.selection?.syncToNative(input.session);
			});
			return;
		}

		if (input.editor?.handleKeyEvent(event, input.session)) {
			// Keymap handlers (arrows, deleteSmart, ...) move the structural caret;
			// re-assert native so the next insert does not re-import a stale range.
			input._guardNativeSync(() => {
				input.editor.selection?.syncToNative(input.session);
			});
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;

		let handled = true;
		switch (event.key) {
			case "Enter":
			case "Return":
				// Swallow newline insertion for now.
				break;
			case " ":
				{
					const rt = input.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, input.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(input.session);
						input.cursor.insertText(event.key);
					} else if (input.cursor?.selectionKind === "caret") {
						const ctx = input.cursor.getContext?.();
						const pointNode = ctx?.point?.node;
						if (
							!input.editor?.text?.isWhitespacePreserved?.(pointNode) &&
							/\s/.test(ctx?.char?.after ?? "")
						) {
							// Advance caret past the existing space instead of a silent no-op (no double space inserted).
							input.cursor.right();
						}
						// If caret is already after the space, swallow — position is already post-space.
					}
				}
				break;
			default:
				if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
					const rt = input.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, input.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(input.session);
						input.cursor.insertText(event.key);
					}
				} else {
					handled = false;
				}
				break;
		}
		if (handled) event.preventDefault();
	}
}

export { EditorKeyboardInput };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: input/pointer
// Pointer listeners translating raw mouse input to structural cursor operations.


class EditorPointerInput {
	constructor(input) {
		this.input = input;
	}

	// Method: onMouseUp
	// After a drag gesture, keep structural selection (already updated in mousemove).
	// Simple clicks: re-assert structural placement so Chromium's center-of-glyph caret
	// cannot override mousedown. Range selections (drag or double-click word) are kept.
	onMouseUp(_event) {
		const input = this.input;
		// Ignore mouseups that did not start inside this editor (chat, toolbar, ...).
		if (!input._mouseOwned && input._dragAnchor == null) {
			input._suppressCollapsedNative = false;
			input._dragFocus = null;
			return;
		}
		input._mouseOwned = false;
		const didDrag =
			input._dragAnchor != null &&
			input._dragFocus != null &&
			input._dragFocus !== input._dragAnchor;
		const active = input.editor?.activeSession?.(input.session);
		if (active?.cursor?.selectionKind === "range") {
			// Drag or multi-click word/block selection - keep it and align native.
			input._guardNativeSync(() => {
				input.editor.selection?.syncToNative(active);
			});
		} else if (didDrag) {
			input._syncNativeSelection({ allowCollapsed: false });
		} else if (active) {
			// Prefer a non-collapsed native selection (browser multi-click) when present.
			input._syncNativeSelection({ allowCollapsed: false });
			if (active.cursor?.selectionKind !== "range") {
				input.editor.selection?.syncToNative(active);
			}
		}
		input._suppressCollapsedNative = false;
		input._dragAnchor = null;
		input._dragFocus = null;
		input._dragStartX = null;
	}

	// Method: onMouseMove
	// While the mouse button is held, extend the selection from the drag anchor.
	// This provides reliable drag-to-select (including across block boundaries)
	// even when using virtual selection mode (which clears native ranges).
	onMouseMove(event) {
		const input = this.input;
		if (!event || event.buttons === 0 || input._dragAnchor == null) {
			if (input._dragAnchor != null && event && event.buttons === 0) {
				input._dragAnchor = null;
				input._dragFocus = null;
				input._dragStartX = null;
			}
			return;
		}
		const root = input.editor?.root;
		if (!root) return;
		const affinity =
			input._dragStartX != null && event.clientX < input._dragStartX
				? "before"
				: "after";
		let focus = null;
		if (
			input.editor.selection &&
			typeof input.editor.selection.resolveOffsetFromPoint === "function"
		) {
			focus = input.editor.selection.resolveOffsetFromPoint(
				root,
				event.clientX,
				event.clientY,
				input.session,
				{ affinity },
			);
		} else if (input.session?.cursor) {
			focus = input.session.cursor.offsetFromPointIn(root, event.clientX, event.clientY);
		}
		if (
			affinity === "before" &&
			focus != null &&
			input._dragAnchor != null &&
			focus >= input._dragAnchor &&
			input._dragAnchor > 0
		) {
			focus = input._dragAnchor - 1;
		}
		if (focus == null || focus === input._dragFocus) return;
		input._dragFocus = focus;
		// Drive the selection structurally. This updates the virtual (or native) selection
		// directly from pointer coords, without depending on the browser maintaining a live
		// native range during the drag.
		input.editor.selection.select(input._dragAnchor, focus, input.session);
	}

	// Method: onMouseDown
	// Evaluates pointer coordinate clicks to accurately place caret or select blocks.
	// Also initiates drag selection tracking (and shift-click extend).
	onMouseDown(event) {
		const input = this.input;
		// Document-level listener: only own clicks that hit this editor's root tree.
		if (!input._eventInRoot(event)) {
			input._mouseOwned = false;
			input._editorActive = false;
			input._dragAnchor = null;
			input._dragFocus = null;
			return;
		}
		input._mouseOwned = true;
		input._editorActive = true;
		// Focus the root so clipboard paste/copy target this editor (virtual caret hosts
		// are often not contenteditable, so click alone may leave focus on body).
		const root = input.editor?.root;
		if (root && typeof root.focus === "function" && document.activeElement !== root) {
			try {
				root.focus({ preventScroll: true });
			} catch (_) {
				root.focus?.();
			}
		}
		const targetElement =
			event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
		const atom = targetElement?.closest(LEGACY_ATOM_SELECTOR);
		if (atom && input.editor?.text.isAtom(atom)) {
			input.cursor._desiredX = null;
			const rect = atom.getBoundingClientRect();
			const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
			input.cursor.selectAtom(atom, side);
			input._dragAnchor = null;
			input._dragFocus = null;
			return;
		}
		const container = targetElement?.closest(LEGACY_CONTAINER_SELECTOR);
		if (container && input.editor?.text.isContainer(container)) {
			const skipped = targetElement?.closest(LEGACY_SKIPPED_SELECTOR);
			if (skipped && container.contains(skipped)) {
				input.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				input.cursor.selectContainer(container, side);
				input._dragAnchor = null;
				input._dragFocus = null;
				return;
			}
			if (
				!input.editor.selection.placeCaretFromPoint(
					container,
					event.clientX,
					event.clientY,
					input.session,
					{
						fallback: "none",
					},
				)
			) {
				input.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				input.cursor.selectContainer(container, side);
			}
			input._dragAnchor = null;
			input._dragFocus = null;
			return;
		}

		const focus =
			input.editor.selection && typeof input.editor.selection.resolveOffsetFromPoint === "function"
				? input.editor.selection.resolveOffsetFromPoint(
						root,
						event.clientX,
						event.clientY,
						input.session,
					)
				: (input.session?.cursor?.offsetFromPointIn?.(root, event.clientX, event.clientY) ?? null);

		if (event.shiftKey && focus != null) {
			// Shift-click / shift-mousedown: extend from current anchor instead of resetting caret
			const active = input.editor.activeSession(input.session);
			const cur = active.cursor;
			const anchor =
				cur.selection?.isActive
					? cur.selection.anchorOffset
					: (cur.offset ?? focus);
			input.editor.selection.select(anchor, focus, input.session);
			input._dragAnchor = anchor;
			input._dragFocus = focus;
			input._dragStartX = event.clientX;
			return;
		}

		const active = input.editor.activeSession(input.session);

		// Double-click selects the word; triple+ selects the current block. Do not
		// collapse to a caret first - that was wiping browser multi-click selection.
		if (event.detail >= 2 && focus != null && active?.cursor) {
			active.cursor._desiredX = null;
			active.cursor.moveTo(focus, { skipBoundaryCollapse: true });
			if (event.detail === 2) {
				const word = this._wordRangeAt(active.cursor.offset);
				if (word) {
					input.editor.selection.select(word.start, word.end, input.session);
					input._guardNativeSync(() => {
						input.editor.selection.syncToNative(active);
					});
					input._suppressCollapsedNative = false;
					input._dragAnchor = null;
					input._dragFocus = null;
					return;
				}
			} else {
				const block =
					input.editor.blockFor?.(active.cursor.anchor) ??
					input.editor.blockFor?.(targetElement) ??
					root;
				const range = input.editor.structuralRangeFor?.(block);
				if (range && range.end > range.start) {
					input.editor.selection.select(range.start, range.end, input.session);
					input._guardNativeSync(() => {
						input.editor.selection.syncToNative(active);
					});
					input._suppressCollapsedNative = false;
					input._dragAnchor = null;
					input._dragFocus = null;
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
			input.editor.selection.syncToNative(active);
			placed = true;
		} else {
			const block = input.editor.blockFor?.(targetElement) ?? root;
			placed = input.editor.selection.placeCaretFromPoint(
				block,
				event.clientX,
				event.clientY,
				input.session,
			);
		}
		// Suppress collapsed native imports until mouseup re-syncs structural->native.
		// Otherwise selectionchange/keydown pick up Chromium's post-click caret.
		input._suppressCollapsedNative = true;
		input._dragAnchor = placed && active?.cursor ? active.cursor.offset : null;
		input._dragStartX = input._dragAnchor != null ? event.clientX : null;
	}

	// Method: _wordRangeAt
	// Returns structural {start,end} covering the word at logical `offset`, or null.
	_wordRangeAt(offset) {
		const input = this.input;
		return wordRangeAtIndex(input.editor?.text, offset);
	}
}

export { EditorPointerInput };

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: input/controller
// Keyboard and mouse listeners translating raw user input to structural cursor ops.


// Class: EditorTextInput
// Keyboard and Mouse listener translating raw user inputs to structural cursor operations.
// - session: EditorSession - associated editor session
class EditorTextInput {
	// Method: constructor
	// Initializes inputs and binds event listeners to the document.
	constructor(editor, options = {}) {
		this._onKeyDown = this.onKeyDown.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		this._onMouseMove = this.onMouseMove.bind(this);
		this._onMouseUp = this.onMouseUp.bind(this);
		this._onSelectionChange = this.onSelectionChange.bind(this);
		this._dragAnchor = null;
		this._dragFocus = null;
		this._dragStartX = null;
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
		this.session = options.session ?? editor.localSession;
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
			node.removeEventListener("keydown", this._onKeyDown);
			node.removeEventListener("mousedown", this._onMouseDown);
			node.removeEventListener("mousemove", this._onMouseMove);
			node.removeEventListener("mouseup", this._onMouseUp);
			node.removeEventListener("selectionchange", this._onSelectionChange);
		}
		this.editor = null;
		this._dragAnchor = null;
		this._dragFocus = null;
		this._dragStartX = null;
		this._mouseOwned = false;
		this._editorActive = false;
		return this;
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
