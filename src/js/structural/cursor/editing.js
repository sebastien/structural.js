// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Session-bound public editing collaborator.
class CursorEditing {
	constructor(cursor) {
		this.cursor = cursor;
	}

	// Method: insertText
	// Inserts the specified `text` at the current cursor position or replaces selected content.
	insertText(text) {
		const cursor = this.cursor;
		cursor._ensureSelectionFromNativeIfPresent();
		if (cursor.selectionKind === "range") {
			cursor.editor?.noteEdit?.("input", cursor.session);
			const next = cursor.selection.replaceWithText(text);
			if (next) {
				cursor._desiredX = null;
				cursor.moveTo(next.index, { skipBoundaryCollapse: true });
			}
			return;
		}
		if (cursor.selectionKind === "node") {
			cursor.editor?.noteEdit?.("input", cursor.session);
			cursor.replaceSelectedNode(text);
			return;
		}
		cursor.text.ensureIndex(cursor.offset);
		const position = cursor.text.positionSlotAt(cursor.offset);
		if (!cursor.text.acceptsText(position)) {
			return;
		}
		cursor.editor?.noteEdit?.("input", cursor.session);
		const next = cursor.text.insertAtIndex(cursor.offset, text);
		cursor._desiredX = null;
		cursor.moveTo(next.index, { skipBoundaryCollapse: true });
	}

	// Method: backspace
	// Deletes the character or node immediately preceding the cursor.
	backspace() {
		const cursor = this.cursor;
		cursor._ensureSelectionFromNativeIfPresent();
		if (cursor.selectionKind === "range") {
			cursor.editor?.noteEdit?.("delete", cursor.session);
			const next = cursor.selection.replaceWithText("");
			if (next) {
				cursor._desiredX = null;
				cursor.moveTo(next.index);
			}
			return;
		}
		if (cursor.selectionKind === "node") {
			cursor.editor?.noteEdit?.("delete", cursor.session);
			cursor.removeSelectedNode();
			return;
		}
		cursor.text.ensureIndex(cursor.offset);
		cursor.editor?.noteEdit?.("delete", cursor.session);
		const next = cursor.text.deleteBackwardAtIndex(cursor.offset);
		cursor._desiredX = null;
		cursor.moveTo(next.index, {
			skipBoundaryCollapse: true,
			skipFormattingWhitespace: true,
		});
	}

	// Method: delete
	// Deletes the character or node immediately following the cursor.
	delete() {
		const cursor = this.cursor;
		cursor._ensureSelectionFromNativeIfPresent();
		if (cursor.selectionKind === "range") {
			cursor.editor?.noteEdit?.("delete", cursor.session);
			const next = cursor.selection.replaceWithText("");
			if (next) {
				cursor._desiredX = null;
				cursor.moveTo(next.index);
			}
			return;
		}
		if (cursor.selectionKind === "node") {
			cursor.editor?.noteEdit?.("delete", cursor.session);
			cursor.removeSelectedNode();
			return;
		}
		cursor.text.ensureIndex(cursor.offset);
		cursor.editor?.noteEdit?.("delete", cursor.session);
		const next = cursor.text.deleteForwardAtIndex(cursor.offset);
		cursor._desiredX = null;
		cursor.moveTo(next.index, {
			skipBoundaryCollapse: true,
			skipFormattingWhitespace: true,
		});
	}

	// Method: replaceSelectedNode
	// Replaces selected element node with plain text `text`.
	replaceSelectedNode(text) {
		const cursor = this.cursor;
		const node = cursor.selectedNode;
		const offset = cursor.selectedOffset ?? cursor.offset;
		if (!node?.parentNode) {
			cursor._clearNodeSelection();
			cursor.selectionKind = "caret";
			cursor.moveTo(offset);
			return;
		}
		const textNode = document.createTextNode(text);
		node.replaceWith(textNode);
		cursor.text.invalidatePositions();
		cursor.text.ensurePositions();
		const nextIndex = cursor.text.indexOfPoint({ node: textNode, offset: text.length });
		cursor._desiredX = null;
		cursor._clearNodeSelection();
		cursor.selectionKind = "caret";
		cursor.moveTo(nextIndex >= 0 ? nextIndex : offset);
	}

	// Method: removeSelectedNode
	// Deletes the currently selected node from DOM tree.
	removeSelectedNode() {
		const cursor = this.cursor;
		const node = cursor.selectedNode;
		const offset = cursor.selectedOffset ?? cursor.offset;
		if (node?.parentNode) {
			node.remove();
			cursor.text.invalidatePositions();
			cursor.text.ensurePositions();
		}
		cursor._desiredX = null;
		cursor._clearNodeSelection();
		cursor.selectionKind = "caret";
		cursor.moveTo(offset);
	}
}

export { CursorEditing };
