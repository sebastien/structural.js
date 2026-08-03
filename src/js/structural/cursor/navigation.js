// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Session-bound public navigation collaborator.
class CursorNavigation {
	constructor(cursor) {
		this.cursor = cursor;
	}

	left(extend = false) {
		this._moveHorizontal(-1, extend);
	}

	wordLeft(extend = false) {
		this._moveWord(-1, extend);
	}

	right(extend = false) {
		this._moveHorizontal(1, extend);
	}

	wordRight(extend = false) {
		this._moveWord(1, extend);
	}

	up(extend = false) {
		this._moveVertical(-1, extend);
	}

	down(extend = false) {
		this._moveVertical(1, extend);
	}

	// Method: _advanceHorizontalOffset
	// Moves caret position horizontally, skipping whitespace according to configuration.
	_advanceHorizontalOffset(origin, direction) {
		const cursor = this.cursor;
		const current = cursor._canonicalOffset(origin, direction);
		let next = cursor.text.moveIndex(current, direction, {
			skipWhitespace: cursor.skipWhitespace,
		});
		next = cursor._remapFormattingWhitespace(next, direction).offset;
		let canonical = cursor._canonicalOffset(next, direction);
		const movesForward = value =>
			direction > 0 ? value > current : value < current;
		while (canonical === current) {
			const advanced = cursor.text.moveIndex(next, direction, {
				skipWhitespace: cursor.skipWhitespace,
			});
			if (advanced === next) {
				break;
			}
			const remapped = cursor._remapFormattingWhitespace(advanced, direction).offset;
			if (!movesForward(remapped)) {
				break;
			}
			next = remapped;
			canonical = cursor._canonicalOffset(next, direction);
			if (!movesForward(canonical)) {
				break;
			}
		}
		return canonical;
	}

	// Method: _verticalTarget
	// Solves target caret slot when traversing vertically.
	_verticalTarget(origin, direction) {
		const cursor = this.cursor;
		cursor.text.ensureIndex(origin);
		const visibleOrigin = cursor._visibleEquivalentOffset(origin, direction);
		const next = cursor.text.indexFromLineMove(
			visibleOrigin,
			direction,
			cursor._desiredX,
		);
		cursor._desiredX = next.desiredX;
		return cursor._resolveMoveOffset(next.index, {
			skipBoundaryCollapse: true,
			preserveVisibleEquivalent: true,
			visibleDirection: direction,
		});
	}

	// Method: _moveHorizontal
	// Internal controller for horizontal cursor movement.
	_moveHorizontal(direction, extend = false) {
		const cursor = this.cursor;
		if (extend) {
			cursor._desiredX = null;
			let anchorOffset = cursor.selection.isActive ? cursor.selection.anchorOffset : cursor.offset;
			let focusOffset = cursor.selection.isActive ? cursor.selection.focusOffset : cursor.offset;
			if (cursor.selectionKind === "node") {
				const range = cursor._nodeSelectionRange();
				if (!range) {
					return;
				}
				anchorOffset = direction < 0 ? range.end : range.start;
				focusOffset = direction < 0 ? range.start : range.end;
			}
			const target = this._advanceHorizontalOffset(focusOffset, direction);
			const move = cursor._resolveMoveOffset(target);
			if (!move) {
				return;
			}
			cursor._setRangeSelection(anchorOffset, move.clamped, move);
			return;
		}
		if (cursor.selectionKind === "range") {
			cursor._collapseRangeSelection(direction);
			return;
		}
		if (cursor.selectionKind === "node") {
			cursor._moveFromSelectedNode(direction);
			return;
		}
		cursor._desiredX = null;
		const explicitSelection = cursor._structuralSelectionAt(cursor.offset, direction);
		if (explicitSelection) {
			cursor.select(explicitSelection.node, {
				offset: explicitSelection.offset,
				direction: explicitSelection.direction,
				behavior: explicitSelection.behavior,
			});
			return;
		}
		const current = cursor._canonicalOffset(cursor.offset, direction);
		const structuralSelection = cursor._structuralSelectionAt(current, direction);
		if (structuralSelection) {
			cursor.select(structuralSelection.node, {
				offset: structuralSelection.offset,
				direction: structuralSelection.direction,
				behavior: structuralSelection.behavior,
			});
			return;
		}
		cursor.moveTo(this._advanceHorizontalOffset(current, direction));
	}

	// Method: _wordTarget
	// Finds the next word start using the structural position index.
	_wordTarget(offset, direction) {
		const cursor = this.cursor;
		let current = cursor.text.clampIndex(offset);
		const crossed = (next) => {
			const from = cursor.text.pointAt(Math.min(current, next));
			const to = cursor.text.pointAt(Math.max(current, next));
			if (!from || !to) return "";
			const range = document.createRange();
			range.setStart(from.node, from.offset);
			range.setEnd(to.node, to.offset);
			return range.toString();
		};
		const advance = () => this._advanceHorizontalOffset(current, direction);
		const isWord = (value) => /[\p{L}\p{N}_]/u.test(value);
		let next = advance();
		const skip = (matches) => {
			while (next !== current && matches(crossed(next))) {
				current = next;
				next = advance();
			}
		};
		if (direction > 0) {
			skip(isWord);
			skip((value) => !isWord(value));
		} else {
			skip((value) => !isWord(value));
			skip(isWord);
		}
		return current;
	}

	// Method: _moveWord
	// Moves by words and preserves the selection anchor when extending.
	_moveWord(direction, extend = false) {
		const cursor = this.cursor;
		cursor._desiredX = null;
		if (extend) {
			const anchor = cursor.selection.isActive ? cursor.selection.anchorOffset : cursor.offset;
			const focus = cursor.selection.isActive ? cursor.selection.focusOffset : cursor.offset;
			const move = cursor._resolveMoveOffset(this._wordTarget(focus, direction));
			if (move) cursor._setRangeSelection(anchor, move.clamped, move);
			return;
		}
		if (cursor.selectionKind === "range") {
			cursor._collapseRangeSelection(direction);
			return;
		}
		if (cursor.selectionKind === "node") {
			cursor._moveFromSelectedNode(direction);
			return;
		}
		cursor.moveTo(this._wordTarget(cursor.offset, direction));
	}

	// Method: _moveVertical
	// Internal controller for vertical cursor movement.
	_moveVertical(direction, extend = false) {
		const cursor = this.cursor;
		if (extend) {
			let anchorOffset = cursor.selection.isActive ? cursor.selection.anchorOffset : cursor.offset;
			let focusOffset = cursor.selection.isActive ? cursor.selection.focusOffset : cursor.offset;
			if (cursor.selectionKind === "node") {
				const range = cursor._nodeSelectionRange();
				if (!range) {
					return;
				}
				anchorOffset = direction < 0 ? range.end : range.start;
				focusOffset = direction < 0 ? range.start : range.end;
			}
			const move = this._verticalTarget(focusOffset, direction);
			if (!move) {
				return;
			}
			cursor._setRangeSelection(anchorOffset, move.clamped, move);
			return;
		}
		if (cursor.selectionKind === "range") {
			cursor._collapseRangeSelection(direction);
			return;
		}
		const move = this._verticalTarget(cursor.offset, direction);
		if (!move) {
			return;
		}
		cursor.moveTo(move.clamped, {
			skipBoundaryCollapse: true,
			preserveVisibleEquivalent: true,
			visibleDirection: direction,
		});
	}
}

export { CursorNavigation };
