// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: input/pointer
// Pointer listeners translating raw mouse input to structural cursor operations.

import { wordRangeAtIndex } from "../dom.js";
import {
	LEGACY_ATOM_SELECTOR,
	LEGACY_CONTAINER_SELECTOR,
	LEGACY_SKIPPED_SELECTOR,
} from "../compat.js";

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
			}
			return;
		}
		const root = input.editor?.root;
		if (!root) return;
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
			);
		} else if (input.session?.cursor) {
			focus = input.session.cursor.offsetFromPointIn(root, event.clientX, event.clientY);
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
	}

	// Method: _wordRangeAt
	// Returns structural {start,end} covering the word at logical `offset`, or null.
	_wordRangeAt(offset) {
		const input = this.input;
		return wordRangeAtIndex(input.editor?.text, offset);
	}
}

export { EditorPointerInput };
