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
		const selection = window.getSelection();
		if (active.nativeSelection !== "none" && selection?.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (this.within(root, range)) return range.cloneRange();
		}
		const cursor = active.cursor;
		if (cursor.selectionKind === "range") {
			const range = cursor.selection.toDomRange();
			return this.within(root, range) ? range : null;
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
