// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Session-bound public selection collaborator.
class CursorSelection {
	constructor(cursor) {
		this.cursor = cursor;
	}

	// Method: _setRangeSelection
	// Applies a text range selection and renders visual updates.
	_setRangeSelection(anchorOffset, focusOffset, move, caretEditable = true) {
		const cursor = this.cursor;
		const previous = cursor._snapshot();
		cursor._clearNodeSelection();
		cursor.selection.set(anchorOffset, focusOffset);
		const normalized = cursor.selection.normalizedRange();
		cursor.offset = move.clamped;
		cursor.anchor = move.position.focusNode;
		cursor.delta = move.position.point.offset;
		cursor.direction = move.direction;
		if (normalized.collapsed) {
			cursor.selectionKind = "caret";
			cursor.selection.clear();
			const caret = cursor.caret.setVirtual(move.position, {
				editable: caretEditable,
			});
			cursor._syncStructuralToNative();
			const current = {
				...cursor._snapshot(),
				requestedOffset: move.requested,
				kind: move.position.kind,
				boundary: move.position.boundary,
				char: move.position.char,
				remap: {
					from: move.requested,
					to: move.clamped,
					reasons: move.reasons,
				},
				caretEditable: caret?.editable ?? false,
				caretVisible: caret?.visible ?? false,
				caretSource: caret?.source ?? null,
			};
			cursor._emitMove(previous, current);
			return;
		}
		cursor.selectionKind = "range";
		cursor.caret.setVirtual(null);
		const render = cursor.selection.apply();
		cursor._syncStructuralToNative();
		const current = {
			...cursor._snapshot(),
			requestedOffset: move.requested,
			kind: move.position.kind,
			boundary: move.position.boundary,
			char: move.position.char,
			remap: {
				from: move.requested,
				to: move.clamped,
				reasons: move.reasons,
			},
			caretEditable: false,
			caretVisible: false,
			caretSource: null,
			selectionVisible: render.visible,
		};
		cursor._emitMove(previous, current);
	}

	// Method: select
	// Applies semantic text or node selection depending on argument shape.
	select(target, focusOrOptions) {
		const cursor = this.cursor;
		if (typeof target === "number") {
			const anchorOffset = target;
			const focusOffset = focusOrOptions;
			if (typeof focusOffset !== "number") {
				return false;
			}

			const previous = cursor._snapshot();
			cursor._clearNodeSelection();
			cursor.selection.set(anchorOffset, focusOffset);
			const normalized = cursor.selection.normalizedRange();
			if (normalized.collapsed) {
				cursor.selection.clear();
				cursor.moveTo(focusOffset);
				return true;
			}

			cursor.selectionKind = "range";
			cursor.offset = cursor.text.clampIndex(focusOffset);
			cursor.anchor = cursor.text.focusNodeAt(cursor.offset) || cursor.anchor;
			const point = cursor.text.pointAt(cursor.offset);
			cursor.delta = point?.offset ?? cursor.delta;
			cursor.direction =
				previous.offset === undefined
					? 0
					: cursor.offset > previous.offset
						? 1
						: cursor.offset < previous.offset
							? -1
							: 0;
			cursor.caret.setVirtual(null);
			const render = cursor.selection.apply();
			cursor._syncStructuralToNative();
			cursor._emitMove(previous, {
				...cursor._snapshot(),
				requestedOffset: focusOffset,
				kind: "range-selection",
				boundary: null,
				char: null,
				remap: {
					from: focusOffset,
					to: cursor.offset,
					reasons: [],
				},
				caretEditable: false,
				caretVisible: false,
				caretSource: null,
				selectionVisible: render.visible,
			});
			return true;
		}

		if (target?.nodeType === Node.ELEMENT_NODE) {
			const node = target;
			const options = focusOrOptions ?? {};
			const kind =
				options.kind ??
				(cursor.text.isAtom(node)
					? "atom"
					: cursor.text.isContainer(node)
						? "container"
						: null);
			if (!kind) {
				return false;
			}

			const side = options.side ?? "before";
			const direction = options.direction ?? (side === "after" ? -1 : 1);
			const offset = options.offset ?? cursor._boundaryIndexForNode(node, side);
			const behavior = options.behavior ?? (kind === "atom" ? "skip" : "enter");
			cursor._selectNode(node, offset, direction, behavior);
			return true;
		}

		return false;
	}

	// Method: _nodeSelectionRange
	// Gets selection index boundaries for currently highlighted node.
	_nodeSelectionRange() {
		const cursor = this.cursor;
		if (!cursor.selectedNode) {
			return null;
		}
		return {
			start: cursor._boundaryIndexForNode(cursor.selectedNode, "before"),
			end: cursor._boundaryIndexForNode(cursor.selectedNode, "after"),
		};
	}

	// Method: _collapseRangeSelection
	// Collapses range selection in designated `direction`.
	_collapseRangeSelection(direction) {
		const cursor = this.cursor;
		const normalized = cursor.selection.normalizedRange();
		const target = direction < 0 ? normalized.start : normalized.end;
		cursor._desiredX = null;
		cursor.moveTo(target);
	}

	// Method: _selectNode
	// Selects entire container or atom element `node` at boundary index.
	_selectNode(node, offset, direction, behavior = "enter") {
		const cursor = this.cursor;
		const previous = cursor._snapshot();
		cursor.selection.clear();
		cursor.selectionKind = "node";
		cursor.selectedNode = node;
		cursor.selectedOffset = offset;
		cursor.selectedDirection = direction;
		cursor.selectedBehavior = behavior;
		cursor.offset = offset;
		cursor.anchor = node;
		cursor.delta = null;
		cursor.direction = direction;
		cursor.caret.setVirtual(null);
		const current = {
			...cursor._snapshot(),
			requestedOffset: offset,
			kind: "node-selection",
			boundary: null,
			char: null,
			remap: {
				from: offset,
				to: offset,
				reasons: ["container-selection"],
			},
			caretEditable: false,
			caretVisible: false,
			caretSource: null,
		};
		cursor._emitMove(previous, current);
	}

	// Method: selectNode
	// Applies semantic node selection for container or atom `node`.
	selectNode(node, options = {}) {
		const cursor = this.cursor;
		return cursor.select(node, options);
	}

	// Method: selectAtom
	// Directly selects atomic `node` element at designated `side`.
	selectAtom(node, side = "before") {
		const cursor = this.cursor;
		if (node?.nodeType !== Node.ELEMENT_NODE || !cursor.text.isAtom(node)) {
			return false;
		}
		return cursor.select(node, { kind: "atom", side, behavior: "skip" });
	}

	// Method: selectContainer
	// Directly selects structural container `node` at designated `side`.
	selectContainer(node, side = "before") {
		const cursor = this.cursor;
		if (node?.nodeType !== Node.ELEMENT_NODE || !cursor.text.isContainer(node)) {
			return false;
		}
		return cursor.select(node, { kind: "container", side, behavior: "enter" });
	}

	// Method: _moveFromSelectedNode
	// Resolves next caret position when exiting a node selection in `direction`.
	_moveFromSelectedNode(direction) {
		const cursor = this.cursor;
		const originOffset = cursor.selectedOffset ?? cursor.offset;
		const selectedNode = cursor.selectedNode;
		const selectedDirection = cursor.selectedDirection;
		const selectedBehavior = cursor.selectedBehavior;
		if (!selectedNode) {
			cursor._clearNodeSelection();
			cursor.selectionKind = "caret";
			cursor.moveTo(originOffset);
			return;
		}
		if (direction === selectedDirection) {
			if (selectedBehavior === "skip") {
				const exitIndex = cursor._exitIndexForNode(
					selectedNode,
					direction,
					originOffset,
				);
				cursor._clearNodeSelection();
				cursor.selectionKind = "caret";
				cursor.moveTo(exitIndex);
				return;
			}
			const entry = cursor._entryIndexForNode(selectedNode, direction);
			cursor._clearNodeSelection();
			cursor.selectionKind = "caret";
			if (entry !== null) {
				cursor.moveTo(entry);
				return;
			}
		}
		cursor._clearNodeSelection();
		cursor.selectionKind = "caret";
		cursor.moveTo(originOffset);
	}
}

export { CursorSelection };
