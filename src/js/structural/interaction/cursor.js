import { Caret, TextSelection } from "./selection.js";
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

// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: cursor
// Implements the logical navigation cursor.


// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: Cursor
// Manages logical text selection, navigation, insertion, and deletion.
// - anchor: HTMLElement - DOM node containing the cursor anchor
// - offset: number - logical index of the cursor in the document
class Cursor {
	// ----------------------------------------------------------------------------
	//
	// LIFECYCLE
	//
	// ----------------------------------------------------------------------------

	// Method: constructor
	// Initializes the logical `Cursor` with parent `input` device and configuration `options`.
	constructor(input, options = {}) {
		this.direction = undefined;
		this.anchor = undefined;
		this.offset = undefined;
		this.delta = 0;
		this.selectionKind = "caret";
		this.selection = new TextSelection(this, options.selection ?? options);
		this.selectedNode = null;
		this.selectedOffset = null;
		this.selectedDirection = 0;
		this.selectedBehavior = null;
		this._desiredX = null;
		this.skipWhitespace = false;
		this.skipFormattingWhitespace = options.skipFormattingWhitespace;
		this.preserveSemanticBoundaries =
			options.preserveSemanticBoundaries !== false;
		this.collapseBoundary = options.collapseBoundary !== false;
		let caretCfg = options.caret;
		if (caretCfg === undefined) {
			if (options.caretNode) {
				caretCfg = { node: options.caretNode };
			} else {
				// legacy fallback for backward compat when not configured
				const legacy = document.getElementById("caret");
				caretCfg = legacy || null;
			}
		}
		// allow shorthand caret: "native" | "virtual"
		if (typeof caretCfg === "string") {
			caretCfg = { mode: caretCfg };
		}
		this.caret = new Caret(caretCfg);
		this._input = input;
		this.editing = new CursorEditing(this);
		this.navigation = new CursorNavigation(this);
		this.selectionController = new CursorSelection(this);
		this._eventFocusedNode = null;
		this._eventActivePath = [];
		this.bindOverlayHosts();
	}

	// Method: bindOverlayHosts
	// Mounts virtual caret/selection hosts as siblings of the editor root so they
	// share the same scroll and offset parent as the edited content.
	bindOverlayHosts() {
		const root = this.editor?.root;
		const container = root?.parentNode;
		if (!container || container.nodeType !== Node.ELEMENT_NODE) return this;
		this.selection?.overlay?.setContainer?.(container);
		this.caret?.setContainer?.(container);
		return this;
	}

	// Property: editor
	// Retrieves the associated Editor instance.
	get editor() {
		return this._input.editor;
	}

	// Property: session
	// Retrieves the session that owns this cursor.
	get session() {
		return this._input?.editor ? this._input : null;
	}

	// Property: text
	// Retrieves the active document TextAdapter.
	get text() {
		const text = this.editor.text;
		// Ensure current window (lazy); far offsets will expand via ensureIndex in move/resolve paths
		text.ensurePositions();
		return text;
	}

	// ----------------------------------------------------------------------------
	//
	// TEXT OPERATIONS
	//
	// ----------------------------------------------------------------------------

	// Method: insertText
	// Inserts the specified `text` at the current cursor position or replaces selected content.
	insertText(text) {
		return this.editing.insertText(text);
	}

	// Method: backspace
	// Deletes the character or node immediately preceding the cursor.
	backspace() {
		return this.editing.backspace();
	}

	// Method: delete
	// Deletes the character or node immediately following the cursor.
	delete() {
		return this.editing.delete();
	}

	// Method: _syncStructuralToNative
	// Pushes structural caret/range to the browser selection without re-entering
	// selectionchange → syncFromNative (guarded via input._guardNativeSync / _syncingNative).
	_syncStructuralToNative() {
		try {
			const ed = this.editor;
			const input = ed?.input;
			const sel = ed?.selection;
			const active = ed ? ed.activeSession(this.session) : null;
			if (!sel || typeof sel.syncToNative !== "function") return;
			const run = () => sel.syncToNative(active);
			if (typeof input?._guardNativeSync === "function") input._guardNativeSync(run);
			else run();
		} catch (_) {}
	}

	// ----------------------------------------------------------------------------
	//
	// POSITIONING
	//
	// ----------------------------------------------------------------------------

	// Method: offsetFromPoint
	// Finds the nearest logical caret position slot index matching coordinates `x` and `y`.
	offsetFromPoint(x, y) {
		return this.text.indexFromPoint(x, y);
	}

	// Method: offsetFromPointIn
	// Finds the nearest logical caret position within subtree `node` for coordinates `x` and `y`.
	offsetFromPointIn(node, x, y) {
		const offset = this.offsetFromPoint(x, y);
		const position = this.text.positionSlotAt(offset);
		if (
			!this.text.acceptsText(position) ||
			!this._isWithinNode(node, position?.point?.node)
		) {
			return null;
		}
		return offset;
	}

	// Method: _shouldSkipFormattingWhitespace
	// Determines if formatting whitespace should be ignored.
	_shouldSkipFormattingWhitespace() {
		if (this.skipFormattingWhitespace !== undefined) {
			return this.skipFormattingWhitespace;
		}
		if (this.text.skipFormattingWhitespaceConfigured) {
			return this.text.skipFormattingWhitespace;
		}
		return true;
	}

	// Method: _isSemanticBoundarySlot
	// Checks if the position slot at `index` falls on a major semantic tag boundary.
	_isSemanticBoundarySlot(index) {
		const slot = this.text.positionSlotAt(index);
		if (slot?.kind !== "element-boundary" || slot.point.node?.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		const node = slot.point.node;
		const childCount = node.childNodes.length;
		return (
			node !== this.editor.root &&
			(slot.point.offset === 0 || slot.point.offset === childCount)
		);
	}

	// Method: _isSkippableFormattingWhitespaceSlot
	// Verifies if the position slot at `index` is a skippable formatting whitespace slot.
	_isSkippableFormattingWhitespaceSlot(index) {
		if (!this.text.isFormattingWhitespaceSlot(index)) {
			return false;
		}
		if (
			this.preserveSemanticBoundaries &&
			this._isSemanticBoundarySlot(index)
		) {
			return false;
		}
		return true;
	}

	// Method: _remapFormattingWhitespace
	// Automatically adjusts target `offset` in `direction` to avoid stopping in formatting whitespace.
	_remapFormattingWhitespace(offset, direction) {
		const clamped = this.text.clampIndex(offset);
		if (!this._shouldSkipFormattingWhitespace()) {
			return { offset: clamped, reason: null };
		}
		if (!this._isSkippableFormattingWhitespaceSlot(clamped)) {
			return { offset: clamped, reason: null };
		}
		const scan = step => {
			let current = clamped;
			while (this._isSkippableFormattingWhitespaceSlot(current)) {
				const next = this.text.clampIndex(current + step);
				if (next === current) {
					return current;
				}
				current = next;
			}
			return current;
		};
		if (direction !== 0) {
			const primary = scan(direction);
			if (!this._isSkippableFormattingWhitespaceSlot(primary)) {
				return { offset: primary, reason: "formatting-whitespace-skip" };
			}
		}
		const fallbackDirection = direction === 0 ? 1 : -direction;
		const fallback = scan(fallbackDirection);
		return this._isSkippableFormattingWhitespaceSlot(fallback)
			? { offset: clamped, reason: null }
			: { offset: fallback, reason: "formatting-whitespace-skip" };
	}

	// Method: _isEquivalentBoundary
	// Determines if two position slots refer to structurally equivalent visual boundaries.
	_isEquivalentBoundary(a, b) {
		return (
			a?.boundary?.leftNode === b?.boundary?.leftNode &&
			b?.boundary?.rightNode === a?.boundary?.rightNode &&
			a?.char?.before === b?.char?.before &&
			a?.char?.after === b?.char?.after
		);
	}

	// Method: _equivalentOffsetRange
	// Computes the range of structurally equivalent positions surrounding the given `offset`.
	_equivalentOffsetRange(offset) {
		this.text.ensureIndex(offset);
		const positions = this.text.positions();
		const clamped = this.text.clampIndex(offset);
		const origin = positions[clamped];
		let start = clamped;
		let end = clamped;
		while (start > 0 && this._isEquivalentBoundary(origin, positions[start - 1])) {
			start -= 1;
		}
		while (
			end + 1 < positions.length &&
			this._isEquivalentBoundary(origin, positions[end + 1])
		) {
			end += 1;
		}
		return { start, end };
	}

	// Method: _visibleEquivalentOffset
	// Returns a visually apparent caret position from equivalent offset range.
	_visibleEquivalentOffset(offset, direction = 0) {
		this.text.ensureIndex(offset);
		const clamped = this.text.clampIndex(offset);
		if (this.text.hasVisibleRectAt(clamped)) {
			return clamped;
		}
		const { start, end } = this._equivalentOffsetRange(clamped);
		if (direction < 0) {
			for (let i = end; i >= start; i -= 1) {
				if (this.text.hasVisibleRectAt(i)) {
					return i;
				}
			}
		} else {
			for (let i = start; i <= end; i += 1) {
				if (this.text.hasVisibleRectAt(i)) {
					return i;
				}
			}
		}
		return clamped;
	}

	// Method: _canonicalOffset
	// Determines the single canonical/collapsed caret offset for equivalent boundaries.
	_canonicalOffset(offset, direction = 0) {
		this.text.ensureIndex(offset);
		const clamped = this.text.clampIndex(offset);
		if (!this.collapseBoundary) {
			return clamped;
		}
		const origin = this.text.positionSlotAt(clamped);
		let current = clamped;
		if (direction > 0) {
			const positions = this.text.positions();
			while (current + 1 < positions.length) {
				const next = this.text.positionSlotAt(current + 1);
				if (!next || !this._isEquivalentBoundary(origin, next)) {
					break;
				}
				current += 1;
			}
			return current;
		}
		while (current > 0) {
			const previous = this.text.positionSlotAt(current - 1);
			if (!previous || !this._isEquivalentBoundary(origin, previous)) {
				break;
			}
			current -= 1;
		}
		return current;
	}

	// Method: _isWithinNode
	// Checks if the DOM node `target` lies inside or equals `node`.
	_isWithinNode(node, target) {
		if (!node || !target) {
			return false;
		}
		if (target === node) {
			return true;
		}
		const element =
			target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
		return element ? node.contains(element) : false;
	}

	// Method: _isTrackableNode
	// Determines if cursor entry/leave events should be dispatched for `node`.
	_isTrackableNode(node) {
		return (
			node?.nodeType === Node.ELEMENT_NODE &&
			(this.text.isAtom(node) || this.text.isContainer(node))
		);
	}

	// Method: _trackableNodeType
	// Returns tracking category ("atom" or "container") for `node`.
	_trackableNodeType(node) {
		if (!this._isTrackableNode(node)) {
			return null;
		}
		return this.text.isAtom(node) ? "atom" : "container";
	}

	// Method: _trackableAncestorsFrom
	// Collects all trackable elements up to the editor root from `node`.
	_trackableAncestorsFrom(node) {
		const path = [];
		let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		while (current) {
			if (this._isTrackableNode(current)) {
				path.push(current);
			}
			if (current === this.editor.root) {
				break;
			}
			current = current.parentElement;
		}
		return path.reverse();
	}

	// Method: _ensureSelectionFromNativeIfPresent
	// If the browser currently has a selection inside the editor root, sync it into
	// structural state so range replace/delete/typing works. Skipped when we already
	// hold a structural range (e.g. after toggleInline) so a stale native range cannot
	// overwrite a remapped selection. Collapsed carets respect the input suppress flag.
	_ensureSelectionFromNativeIfPresent() {
		try {
			if (this.selectionKind === "range" || this.selectionKind === "node") return;
			const ed = this.editor;
			if (!ed?.root || !ed.range || !ed.selection) return;
			const input = ed.input;
			if (typeof input?._syncNativeSelection === "function") {
				input._syncNativeSelection({ allowCollapsed: true });
				return;
			}
			const ns = (typeof window !== "undefined" && window.getSelection) ? window.getSelection() : null;
			if (!ns?.rangeCount) return;
			const nr = ns.getRangeAt(0);
			if (!nr) return;
			if (!ed.range.within(ed.root, nr)) return;
			ed.selection.syncFromNative(ed.root);
		} catch (_) {}
	}

	// Method: _resolveFocusedTrackableNode
	// Determines the currently focused trackable element based on current state.
	_resolveFocusedTrackableNode(current) {
		if (
			current?.selectionKind === "node" &&
			this._isTrackableNode(current.selectedNode)
		) {
			return current.selectedNode;
		}
		const path = this._trackableAncestorsFrom(current?.anchor);
		return path[path.length - 1] ?? null;
	}

	// Method: _resolveActiveTrackablePath
	// Determines the current path of trackable nodes for cursor events.
	_resolveActiveTrackablePath(current) {
		this.text.ensurePositions();
		if (
			current?.selectionKind === "node" &&
			this._isTrackableNode(current.selectedNode)
		) {
			return this._trackableAncestorsFrom(current.selectedNode);
		}
		return this._trackableAncestorsFrom(current?.anchor);
	}

	// Method: _dispatchCursorNodeEvent
	// Dispatches custom cursor events on trackable DOM elements.
	_dispatchCursorNodeEvent(type, node, detail) {
		if (!this._isTrackableNode(node)) {
			return;
		}
		node.dispatchEvent(
			new CustomEvent(type, {
				bubbles: true,
				detail: {
					...detail,
					node,
					nodeType: this._trackableNodeType(node),
				},
			}),
		);
	}

	// Method: _syncCursorNodeEvents
	// Emits CursorEnter, CursorLeave, and CursorFocus events as the cursor transitions.
	_syncCursorNodeEvents(previous, current) {
		const previousPath = this._eventActivePath;
		const currentPath = this._resolveActiveTrackablePath(current);
		const previousFocusedNode = this._eventFocusedNode;
		const currentFocusedNode = this._resolveFocusedTrackableNode(current);
		let shared = 0;
		while (
			shared < previousPath.length &&
			shared < currentPath.length &&
			previousPath[shared] === currentPath[shared]
		) {
			shared += 1;
		}
		for (let i = previousPath.length - 1; i >= shared; i -= 1) {
			this._dispatchCursorNodeEvent("CursorLeave", previousPath[i], {
				previous,
				current,
				reason: current.selectionKind === "node" ? "node-selection" : "caret-move",
			});
		}
		for (let i = shared; i < currentPath.length; i += 1) {
			this._dispatchCursorNodeEvent("CursorEnter", currentPath[i], {
				previous,
				current,
				reason: current.selectionKind === "node" ? "node-selection" : "caret-move",
			});
		}
		if (previousFocusedNode !== currentFocusedNode && currentFocusedNode) {
			this._dispatchCursorNodeEvent("CursorFocus", currentFocusedNode, {
				previous,
				current,
				previousNode: previousFocusedNode,
				currentNode: currentFocusedNode,
				reason: current.selectionKind === "node" ? "node-selection" : "caret-move",
			});
		}
		this._eventActivePath = currentPath;
		this._eventFocusedNode = currentFocusedNode;
	}

	// Method: _structuralSelectionAt
	// Checks if target position `index` in `direction` should trigger a block selection.
	_structuralSelectionAt(index, direction) {
		if (direction === 0) {
			return null;
		}
		const slot = this.text.positionSlotAt(index);
		if (slot?.kind !== "element-boundary") {
			return null;
		}
		const candidate =
			direction > 0 ? slot.boundary?.rightNode : slot.boundary?.leftNode;
		if (candidate?.nodeType === Node.ELEMENT_NODE && this.text.isAtom(candidate)) {
			return {
				node: candidate,
				offset: index,
				direction,
				behavior: "skip",
			};
		}
		const pointNode = slot.point?.node;
		if (
			pointNode?.nodeType === Node.ELEMENT_NODE &&
			this.text.isContainer(pointNode)
		) {
			const isLeadingEdge = slot.point.offset === 0;
			const isTrailingEdge = slot.point.offset === pointNode.childNodes.length;
			if ((direction > 0 && isLeadingEdge) || (direction < 0 && isTrailingEdge)) {
				return {
					node: pointNode,
					offset: index,
					direction,
					behavior: "enter",
				};
			}
		}
		if (
			candidate?.nodeType !== Node.ELEMENT_NODE ||
			!this.text.isContainer(candidate)
		) {
			return null;
		}
		return {
			node: candidate,
			offset: index,
			direction,
			behavior: "enter",
		};
	}

	// Method: _entryIndexForNode
	// Computes correct entry caret position when moving cursor into container `node`.
	_entryIndexForNode(node, direction) {
		this.text.ensurePositions();
		const positions = this.text.positions();
		const matches = [];
		for (let i = 0; i < positions.length; i += 1) {
			const slot = positions[i];
			if (!this.text.acceptsText(slot)) {
				continue;
			}
			if (!this._isWithinNode(node, slot.point?.node)) {
				continue;
			}
			matches.push(i);
		}
		if (matches.length === 0) {
			return null;
		}
		return direction > 0 ? matches[0] : matches[matches.length - 1];
	}

	// Method: _exitIndexForNode
	// Computes correct exit caret position when moving cursor out of container `node`.
	_exitIndexForNode(node, direction, fallback = this.offset ?? 0) {
		this.text.ensurePositions();
		const positions = this.text.positions();
		for (let i = 0; i < positions.length; i += 1) {
			const boundary = positions[i]?.boundary;
			if (direction > 0 && boundary?.leftNode === node) {
				return i;
			}
			if (direction < 0 && boundary?.rightNode === node) {
				return i;
			}
		}
		return fallback;
	}

	// Method: _boundaryIndexForNode
	// Returns the caret position index immediately before or after container `node`.
	_boundaryIndexForNode(node, side, fallback = this.offset ?? 0) {
		this.text.ensurePositions();
		const positions = this.text.positions();
		for (let i = 0; i < positions.length; i += 1) {
			const boundary = positions[i]?.boundary;
			if (side === "before" && boundary?.rightNode === node) {
				return i;
			}
			if (side === "after" && boundary?.leftNode === node) {
				return i;
			}
		}
		return fallback;
	}

	// Method: _snapshot
	// Captures a detailed snapshot of current selection and navigation states.
	_snapshot() {
		const selection = this.selection.normalizedRange();
		return {
			offset: this.offset,
			anchor: this.anchor,
			delta: this.delta,
			selectionKind: this.selectionKind,
			selectedNode: this.selectedNode,
			selectedOffset: this.selectedOffset,
			selectedDirection: this.selectedDirection,
			selectedBehavior: this.selectedBehavior,
			selectionAnchorOffset: this.selection.anchorOffset,
			selectionFocusOffset: this.selection.focusOffset,
			selectionStart: selection.start,
			selectionEnd: selection.end,
			selectionCollapsed: selection.collapsed,
			selectionMode: this.selection.mode,
		};
	}

	// Method: _emitMove
	// Fires global CursorMove and local element node events to track transitions.
	_emitMove(previous, current) {
		this._syncCursorNodeEvents(previous, current);
		this.editor.root.dispatchEvent(
			new CustomEvent("CursorMove", {
				detail: { previous, current },
			}),
		);
	}

	// Method: _resolveMoveOffset
	// Evaluates and adjusts target `offset` for whitespace, canonicalization, and visibility.
	_resolveMoveOffset(offset, options = {}) {
		// Expand window to cover requested target (window length is acceptable per spec)
		this.text.ensureIndex(offset);
		const positions = this.text.positions();
		if (positions.length === 0) {
			return null;
		}
		const requested = this.text.clampIndex(offset);
		const requestedDirection =
			this.offset === undefined
				? 0
				: requested > this.offset
					? 1
					: requested < this.offset
						? -1
						: 0;
		const whitespaceRemap = options.skipFormattingWhitespace
			? { offset: requested, reason: null }
			: this._remapFormattingWhitespace(
				requested,
				requestedDirection,
			);
		const remapped = whitespaceRemap.offset;
		const canonical = options.skipBoundaryCollapse
			? remapped
			: this._canonicalOffset(remapped, requestedDirection);
		const clamped = options.preserveVisibleEquivalent
			? this._visibleEquivalentOffset(canonical, options.visibleDirection)
			: canonical;
		const reasons = [];
		if (whitespaceRemap.reason) {
			reasons.push(whitespaceRemap.reason);
		}
		if (canonical !== remapped) {
			reasons.push("boundary-collapse");
		}
		if (clamped !== canonical) {
			reasons.push("visible-equivalent");
		}
		const direction =
			this.offset === undefined
				? 0
				: clamped === this.offset
					? 0
					: clamped > this.offset
						? 1
						: -1;
		return {
			requested,
			clamped,
			position: positions[clamped],
			reasons,
			direction,
		};
	}

	// Method: _clearNodeSelection
	// Resets any block-level node selection state.
	_clearNodeSelection() {
		this.selectedNode = null;
		this.selectedOffset = null;
		this.selectedDirection = 0;
		this.selectedBehavior = null;
	}

	// Method: _setRangeSelection
	// Applies a text range selection and renders visual updates.
	_setRangeSelection(anchorOffset, focusOffset, move, caretEditable = true) {
		return this.selectionController._setRangeSelection(
			anchorOffset,
			focusOffset,
			move,
			caretEditable,
		);
	}

	// Method: select
	// Applies semantic text or node selection depending on argument shape.
	select(target, focusOrOptions) {
		return this.selectionController.select(target, focusOrOptions);
	}

	// Method: _nodeSelectionRange
	// Gets selection index boundaries for currently highlighted node.
	_nodeSelectionRange() {
		return this.selectionController._nodeSelectionRange();
	}

	// Method: _collapseRangeSelection
	// Collapses range selection in designated `direction`.
	_collapseRangeSelection(direction) {
		return this.selectionController._collapseRangeSelection(direction);
	}

	// Method: _selectNode
	// Selects entire container or atom element `node` at boundary index.
	_selectNode(node, offset, direction, behavior = "enter") {
		return this.selectionController._selectNode(node, offset, direction, behavior);
	}

	// Method: selectNode
	// Applies semantic node selection for container or atom `node`.
	selectNode(node, options = {}) {
		return this.selectionController.selectNode(node, options);
	}

	// Method: selectAtom
	// Directly selects atomic `node` element at designated `side`.
	selectAtom(node, side = "before") {
		return this.selectionController.selectAtom(node, side);
	}

	// Method: selectContainer
	// Directly selects structural container `node` at designated `side`.
	selectContainer(node, side = "before") {
		return this.selectionController.selectContainer(node, side);
	}

	// Method: _moveFromSelectedNode
	// Resolves next caret position when exiting a node selection in `direction`.
	_moveFromSelectedNode(direction) {
		return this.selectionController._moveFromSelectedNode(direction);
	}

	// Method: replaceSelectedNode
	// Replaces selected element node with plain text `text`.
	replaceSelectedNode(text) {
		return this.editing.replaceSelectedNode(text);
	}

	// Method: removeSelectedNode
	// Deletes the currently selected node from DOM tree.
	removeSelectedNode() {
		return this.editing.removeSelectedNode();
	}

	// Method: moveTo
	// Sets the cursor location to specified position `offset`.
	moveTo(offset, options = {}) {
		this.text.ensureIndex(offset);
		const previous = this._snapshot();
		// Any explicit caret movement begins a new structural-scope selection
		// sequence; Ctrl+A expansion state is only valid while its range remains.
		this._structuralScopeNode = null;
		this._structuralScopePath = null;
		const move = this._resolveMoveOffset(offset, options);
		if (!move) {
			this._clearNodeSelection();
			this.selection.clear();
			this.selectionKind = "caret";
			this.offset = 0;
			this.anchor = this.editor.root;
			this.delta = 0;
			this.caret.setVirtual(null);
			this._syncStructuralToNative();
			this._emitMove(previous, {
				...this._snapshot(),
				requestedOffset: this.offset,
			});
			return;
		}
		this.direction = move.direction;
		this._clearNodeSelection();
		this.selection.clear();
		this.selectionKind = "caret";
		this.offset = move.clamped;
		this.anchor = move.position.focusNode;
		this.delta = move.position.point.offset;
		const caret = this.caret.setVirtual(move.position, {
			editable: this.text.acceptsText(move.position),
		});
		this._syncStructuralToNative();
		const current = {
			...this._snapshot(),
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
		this._emitMove(previous, current);
	}

	// Method: getContext
	// Returns contextual info surrounding the current cursor position.
	getContext() {
		return this.text.contextAt(this.offset);
	}

	// ----------------------------------------------------------------------------
	//
	// NAVIGATION
	//
	// ----------------------------------------------------------------------------

	// Method: left
	// Moves the cursor to the left, optionally extending selection.
	left(extend = false) {
		this.navigation.left(extend);
	}

	// Method: wordLeft
	// Moves to the start of the current or previous word.
	wordLeft(extend = false) {
		this.navigation.wordLeft(extend);
	}

	// Method: right
	// Moves the cursor to the right, optionally extending selection.
	right(extend = false) {
		this.navigation.right(extend);
	}

	// Method: wordRight
	// Moves to the start of the next word.
	wordRight(extend = false) {
		this.navigation.wordRight(extend);
	}

	// Method: up
	// Moves the cursor up one line, optionally extending selection.
	up(extend = false) {
		this.navigation.up(extend);
	}

	// Method: down
	// Moves the cursor down one line, optionally extending selection.
	down(extend = false) {
		this.navigation.down(extend);
	}
}

export { Caret, Cursor };

// EOF
