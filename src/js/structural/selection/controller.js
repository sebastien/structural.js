// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: selection
// Manages and overlays selection ranges in the editor.

import { firstTextNode, lastTextNode } from "../dom.js";

// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: EditorSelectionController
// Synchronizes native browser selection and the editor's structural cursor state.
class EditorSelectionController {
	constructor(editor) {
		this.editor = editor;
	}

	// Method: _syncSessionBlock
	// Updates session block bookkeeping from the active cursor anchor.
	_syncSessionBlock(active) {
		active.currentBlock = this.editor.blockFor?.(active.cursor.anchor) ?? active.currentBlock;
		if (active === this.editor.localSession) this.editor._currentBlock = active.currentBlock;
	}

	// Method: _pointWithin
	// Checks if `node` lies within subtree `root`.
	_pointWithin(root, node) {
		if (!root || !node) return false;
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		return !!element && (element === root || root.contains(element));
	}

	// Method: _nativeCaretPointFromClientPoint
	// Resolves a native DOM point from viewport coordinates when available.
	_nativeCaretPointFromClientPoint(x, y) {
		const position = document.caretPositionFromPoint?.(x, y);
		if (position?.offsetNode) {
			return { node: position.offsetNode, offset: position.offset };
		}
		const range = document.caretRangeFromPoint?.(x, y);
		if (range?.startContainer) {
			return { node: range.startContainer, offset: range.startOffset };
		}
		return null;
	}

	// Method: _edgePlacement
	// Resolves whether a point should snap to the subtree start or end.
	_edgePlacement(root, x) {
		const rect = root.getBoundingClientRect();
		return x > rect.left + rect.width / 2 ? "end" : "start";
	}

	// Method: _setEdgeCaret
	// Places the caret at the subtree start or end when block helpers are unavailable.
	_setEdgeCaret(root, placement, session = null) {
		const textNode = placement === "end" ? lastTextNode(root) : firstTextNode(root);
		if (textNode) {
			return this.setCaret(textNode, placement === "end" ? textNode.data.length : 0, session);
		}
		if (root.nodeType !== Node.ELEMENT_NODE) return false;
		return this.setCaret(root, placement === "end" ? root.childNodes.length : 0, session);
	}

	// Method: setCaret
	// Moves the active caret to the specified DOM `node` and `offset`.
	setCaret(node, offset, session = null) {
		const active = this.editor.activeSession(session);
		this.editor.text.refresh();
		// Ensure index resolution can expand window for the provided node/offset
		const index = this.editor.text.indexOfPoint({ node, offset });
		if (index < 0) {
			return false;
		}
		active.cursor.moveTo(index);
		this._syncSessionBlock(active);
		return this.syncToNative(active);
	}

	// Method: previewCaretAtIndex
	// Moves only the virtual caret for hover/drag previews without syncing native selection.
	previewCaretAtIndex(index, session = null, options = {}) {
		const active = this.editor.activeSession(session);
		this.editor.text.ensureIndex(index);
		const move = active.cursor._resolveMoveOffset(index, options);
		if (!move) return false;
		active.cursor._clearNodeSelection();
		active.cursor.selection.clear();
		active.cursor.selectionKind = "caret";
		active.cursor.offset = move.clamped;
		active.cursor.anchor = move.position.focusNode;
		active.cursor.delta = move.position.point.offset;
		active.cursor.direction = move.direction;
		active.cursor.caret.setVirtual(move.position, { editable: options.editable !== false });
		this._syncSessionBlock(active);
		return move.clamped;
	}

	// Method: previewCaretFromPoint
	// Places only the virtual caret from viewport coordinates using cached text positions.
	previewCaretFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return false;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			this.editor.text.ensurePositions();
			const index = this.editor.text.indexOfPoint(nativePoint);
			return index >= 0 ? this.previewCaretAtIndex(index, session, options) : false;
		}
		const active = this.editor.activeSession(session);
		const offset = active.cursor.offsetFromPointIn(root, x, y);
		return offset !== null ? this.previewCaretAtIndex(offset, active, options) : false;
	}

	// Method: select
	// Applies a structural text selection from `start` to `end`.
	select(start, end, session = null) {
		const active = this.editor.activeSession(session);
		active.cursor.select(start, end);
		this._syncSessionBlock(active);
		return true;
	}

	// Method: resolveOffsetFromPoint
	// Resolves a structural text offset from viewport coordinates without moving the cursor or syncing native selection.
	resolveOffsetFromPoint(root, x, y, session = null) {
		if (!root?.isConnected) return null;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			this.editor.text.ensurePositions();
			const index = this.editor.text.indexOfPoint(nativePoint);
			return index >= 0 ? index : null;
		}
		const active = this.editor.activeSession(session);
		const offset = active.cursor.offsetFromPointIn(root, x, y);
		return offset;
	}

	// Method: placeCaretFromPoint
	// Places the caret within subtree `root` using viewport coordinates `x` and `y`.
	placeCaretFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return false;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			return this.setCaret(nativePoint.node, nativePoint.offset, session);
		}

		const offset = this.resolveOffsetFromPoint(root, x, y, session);
		if (offset !== null) {
			const active = this.editor.activeSession(session);
			active.cursor._desiredX = null;
			active.cursor.moveTo(offset);
			this._syncSessionBlock(active);
			return this.syncToNative(active);
		}

		const active = this.editor.activeSession(session);
		if (options.fallback === "none") {
			return false;
		}

		const placement = this._edgePlacement(root, x);
		const rt = this.editor.capability?.("richtext") ?? this.editor.richText;
		return placement === "end"
			? (rt?.moveCursorToBlockEnd?.(root, active) ?? this._setEdgeCaret(root, "end", active))
			: (rt?.moveCursorToBlockStart?.(root, active) ?? this._setEdgeCaret(root, "start", active));
	}

	// Method: syncToNative
	// Syncs the active structural caret or range to the browser selection.
	// Always writes a native range so clipboard, getSelection(), and tests stay
	// consistent even when a virtual caret/selection overlay is also active.
	syncToNative(session = null) {
		const active = this.editor.activeSession(session);
		try {
			const selection = window.getSelection();
			if (!selection) return false;
			if (active.cursor.selectionKind === "range") {
				const range = active.cursor.selection.toDomRange();
				if (!range) return false;
				if (
					selection.rangeCount === 1 &&
					!selection.isCollapsed &&
					selection.anchorNode === range.startContainer &&
					selection.anchorOffset === range.startOffset &&
					selection.focusNode === range.endContainer &&
					selection.focusOffset === range.endOffset
				) {
					return true;
				}
				if (typeof selection.setBaseAndExtent === "function") {
					selection.setBaseAndExtent(
						range.startContainer,
						range.startOffset,
						range.endContainer,
						range.endOffset,
					);
				} else {
					selection.removeAllRanges();
					selection.addRange(range);
				}
				return true;
			}
			const point = this.editor.text.pointAt(active.cursor.offset ?? 0);
			if (!point?.node?.isConnected) return false;
			if (
				selection.rangeCount === 1 &&
				selection.isCollapsed &&
				selection.anchorNode === point.node &&
				selection.anchorOffset === point.offset
			) {
				return true;
			}
			if (typeof selection.setBaseAndExtent === "function") {
				selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
			} else {
				const range = document.createRange();
				range.setStart(point.node, point.offset);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			return true;
		} catch (_e) {
			return false;
		}
	}

	// Method: _indexFromRangeBoundary
	// Resolves a structural index for a DOM Range boundary, including element
	// offsets used by Range.selectNode() (parent + child index).
	_indexFromRangeBoundary(container, offset, edge = "start") {
		if (!container) return -1;
		if (container.nodeType === Node.TEXT_NODE) {
			return this.editor.text.indexOfPoint({ node: container, offset });
		}
		if (container.nodeType !== Node.ELEMENT_NODE) return -1;
		const child =
			edge === "end"
				? container.childNodes[Math.max(0, offset - 1)]
				: container.childNodes[offset];
		if (child?.nodeType === Node.TEXT_NODE) {
			return this.editor.text.indexOfPoint({
				node: child,
				offset: edge === "end" ? child.data.length : 0,
			});
		}
		if (child?.nodeType === Node.ELEMENT_NODE) {
			const range = this.editor.structuralRangeFor?.(child);
			if (range) return edge === "end" ? range.end : range.start;
			const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
			let text = null;
			let first = null;
			while (walker.nextNode()) {
				if (!first) first = walker.currentNode;
				text = walker.currentNode;
			}
			const node = edge === "end" ? text : first;
			if (node) {
				return this.editor.text.indexOfPoint({
					node,
					offset: edge === "end" ? node.data.length : 0,
				});
			}
		}
		return this.editor.text.indexOfPoint({ node: container, offset });
	}

	// Method: syncFromNative
	// Maps the browser selection back into the active structural cursor state.
	syncFromNative(root = this.editor.root, session = null) {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return false;
		const range = selection.getRangeAt(0);
		if (!this.editor.range.within(root, range)) return false;
		let start = this.editor.text.indexOfPoint({
			node: range.startContainer,
			offset: range.startOffset,
		});
		let end = this.editor.text.indexOfPoint({
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0) {
			start = this._indexFromRangeBoundary(range.startContainer, range.startOffset, "start");
		}
		if (end < 0) {
			end = this._indexFromRangeBoundary(range.endContainer, range.endOffset, "end");
		}
		if (start < 0 || end < 0) return false;

		const active = this.editor.activeSession(session);
		if (range.collapsed || start === end) {
			// Preserve the exact text index from the native caret. Boundary collapse can
			// push a text-end index onto the following element-boundary and break typing.
			if (
				active.cursor.selectionKind === "caret" &&
				active.cursor.offset === end &&
				!active.cursor.selection?.isActive
			) {
				this._syncSessionBlock(active);
				return true;
			}
			active.cursor.moveTo(end, { skipBoundaryCollapse: true });
		} else {
			const lo = Math.min(start, end);
			const hi = Math.max(start, end);
			const cur = active.cursor.selection?.isActive
				? active.cursor.selection.normalizedRange()
				: null;
			if (
				active.cursor.selectionKind === "range" &&
				cur &&
				cur.start === lo &&
				cur.end === hi
			) {
				this._syncSessionBlock(active);
				return true;
			}
			active.cursor.select(start, end);
		}
		this._syncSessionBlock(active);
		active.classes?.update();
		return true;
	}
}

export {
	EditorSelectionController,
};

// EOF
