// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: cursor
// Implements the caret rendering and the logical navigation cursor.

import { TextSelection } from "./selection.js";

// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: Caret
// Controls the visual representation and layout of the editor's text cursor.
// - node: HTMLElement - visual DOM element representing the caret
class Caret {
	// Method: constructor
	// Initializes the `Caret` controller with a custom visual `node`.
	constructor(node) {
		this.node = node ?? null;
		this._measureCanvas = document.createElement("canvas");
		this._onSelectionChange = this._onSelectionChange.bind(this);
		document.addEventListener("selectionchange", this._onSelectionChange);
	}

	// Method: _onSelectionChange
	// Hides the virtual caret when a non-collapsed selection is active.
	_onSelectionChange() {
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			this._hide();
		}
	}

	// Method: _pointRect
	// Internal helper to get client rect for the given DOM node and offset.
	_pointRect(node, offset) {
		const range = document.createRange();
		try {
			range.setStart(node, offset);
			range.collapse(true);
			return { rect: range.getBoundingClientRect(), range, source: "range" };
		} catch (_e) {
			return null;
		}
	}

	// Method: _edgeRect
	// Internal helper to get bounding rect for extreme edges of a `node`.
	_edgeRect(node, edge) {
		if (!node) {
			return null;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			const offset = edge === "start" ? 0 : node.data.length;
			const result = this._pointRect(node, offset);
			if (result && (result.rect.width !== 0 || result.rect.height !== 0)) {
				return { ...result, source: `text-${edge}` };
			}
			if (node.data.length === 0) {
				return result ? { ...result, source: `text-${edge}` } : null;
			}
			const range = document.createRange();
			try {
				if (edge === "start") {
					range.setStart(node, 0);
					range.setEnd(node, 1);
				} else {
					range.setStart(node, node.data.length - 1);
					range.setEnd(node, node.data.length);
				}
				return {
					rect: range.getBoundingClientRect(),
					range,
					source: `text-${edge}-char`,
				};
			} catch (_e) {
				return result ? { ...result, source: `text-${edge}` } : null;
			}
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			const rect = node.getBoundingClientRect();
			return { rect, range: null, source: `element-${edge}` };
		}
		return null;
	}

	// Method: _deepCaretPoint
	// Internal helper to retrieve the deepest text/element point inside `node`.
	_deepCaretPoint(node, edge) {
		let current = node;
		while (current) {
			if (current.nodeType === Node.TEXT_NODE) {
				return {
					node: current,
					offset: edge === "start" ? 0 : current.data.length,
				};
			}
			if (current.nodeType !== Node.ELEMENT_NODE) {
				return null;
			}
			const children = current.childNodes;
			if (children.length === 0) {
				return { node: current, offset: edge === "start" ? 0 : children.length };
			}
			current =
				edge === "start"
					? children[0] ?? null
					: children[children.length - 1] ?? null;
		}
		return null;
	}

	// Method: _visibleEdgeRect
	// Internal helper to find a non-collapsed bounding rect around a `node` edge.
	_visibleEdgeRect(node, edge) {
		let current = node;
		while (current) {
			const result = this._edgeRect(current, edge);
			if (result && (result.rect.width !== 0 || result.rect.height !== 0)) {
				return { ...result, node: current };
			}
			current = edge === "end" ? current.previousSibling : current.nextSibling;
		}
		return null;
	}

	// Method: _boundaryRect
	// Internal helper to compute a visual bounding rect around a structural boundary position.
	_boundaryRect(position) {
		const leftNode = position?.boundary?.leftNode;
		const left = this._visibleEdgeRect(leftNode, "end");
		if (left && (left.rect.width !== 0 || left.rect.height !== 0)) {
			const point =
				left.node?.nodeType === Node.ELEMENT_NODE
					? this._edgeRect(this._deepCaretPoint(left.node, "end")?.node, "end")
					: null;
			return {
				x: left.rect.right + window.scrollX,
				y: (point?.rect.top ?? left.rect.top) + window.scrollY,
				height: left.rect.height,
				source: "left-boundary",
			};
		}
		const rightNode = position?.boundary?.rightNode;
		const right = this._visibleEdgeRect(rightNode, "start");
		if (right && (right.rect.width !== 0 || right.rect.height !== 0)) {
			const point =
				right.node?.nodeType === Node.ELEMENT_NODE
					? this._edgeRect(this._deepCaretPoint(right.node, "start")?.node, "start")
					: null;
			return {
				x: right.rect.left + window.scrollX,
				y: (point?.rect.top ?? right.rect.top) + window.scrollY,
				height: right.rect.height,
				source: "right-boundary",
			};
		}
		return null;
	}

	// Method: _hide
	// Hides the visual caret node.
	_hide() {
		if (this.node) {
			this.node.style.visibility = "hidden";
		}
	}

	// Method: _showAt
	// Displays the visual caret at specified `x` and `y` coordinates with configurable `height`.
	_showAt(x, y, height) {
		if (this.node) {
			const snap = value => Math.round(value);
			this.node.style.left = `${snap(x)}px`;
			this.node.style.top = `${snap(y)}px`;
			if (height !== undefined) {
				this.node.style.height = `${Math.max(1, snap(height))}px`;
			}
			this.node.style.visibility = "visible";
		}
	}

	// Method: _measureTextWidth
	// Internal helper to measure the width of `text` based on style of DOM `node`.
	_measureTextWidth(text, node) {
		if (!text) {
			return 0;
		}
		const element =
			node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
		if (!element) {
			return 0;
		}
		const context = this._measureCanvas.getContext("2d");
		if (!context) {
			return 0;
		}
		const style = window.getComputedStyle(element);
		context.font = style.font;
		let width = context.measureText(text).width;
		const letterSpacing = Number.parseFloat(style.letterSpacing);
		if (Number.isFinite(letterSpacing)) {
			width += Math.max(0, text.length - 1) * letterSpacing;
		}
		const wordSpacing = Number.parseFloat(style.wordSpacing);
		if (Number.isFinite(wordSpacing)) {
			const spaces = text.match(/ /g)?.length ?? 0;
			width += spaces * wordSpacing;
		}
		return width;
	}

	// Method: _collapsedTrailingSpaceWidth
	// Internal helper to calculate width of collapsed trailing space at `position`.
	_collapsedTrailingSpaceWidth(position) {
		const pointNode = position?.point?.node;
		const pointOffset = position?.point?.offset ?? 0;
		const whitespaceNodes = [];
		let trailingSpaces = "";
		if (
			pointNode?.nodeType === Node.TEXT_NODE &&
			pointOffset === pointNode.data.length &&
			pointNode.nextSibling === null
		) {
			const match = pointNode.data.slice(0, pointOffset).match(/ +$/);
			if (!match) {
				return 0;
			}
			trailingSpaces = match[0];
			whitespaceNodes.unshift(pointNode);
			let current = pointNode.previousSibling;
			while (current?.nodeType === Node.TEXT_NODE && /^[ ]+$/.test(current.data)) {
				trailingSpaces = `${current.data}${trailingSpaces}`;
				whitespaceNodes.unshift(current);
				current = current.previousSibling;
			}
		} else {
			const leftNode = position?.boundary?.leftNode;
			if (
				leftNode?.nodeType !== Node.TEXT_NODE ||
				position?.boundary?.rightNode ||
				!/^[ ]+$/.test(leftNode.data ?? "")
			) {
				return 0;
			}
			trailingSpaces = leftNode.data;
			whitespaceNodes.unshift(leftNode);
			let current = leftNode.previousSibling;
			while (current?.nodeType === Node.TEXT_NODE && /^[ ]+$/.test(current.data)) {
				trailingSpaces = `${current.data}${trailingSpaces}`;
				whitespaceNodes.unshift(current);
				current = current.previousSibling;
			}
		}
		const referenceNode = whitespaceNodes[0] ?? pointNode;
		return this._measureTextWidth(trailingSpaces, referenceNode);
	}

	// Method: setVirtual
	// Positions the virtual caret relative to standard text layout or element boundaries.
	setVirtual(position, options = {}) {
		const editable = options.editable === true;
		const point = position?.point;
		if (!point) {
			this._hide();
			return { visible: false, editable: false, source: null };
		}
		const result =
			point.node?.nodeType === Node.TEXT_NODE ||
			point.node?.nodeType === Node.ELEMENT_NODE
				? this._pointRect(point.node, point.offset)
				: null;
		const rect = result?.rect;
		if (rect && (rect.width !== 0 || rect.height !== 0)) {
			const x = rect.left + window.scrollX;
			const y = rect.top + window.scrollY;
			if (editable) {
				this._showAt(x, y, rect.height);
			} else {
				this._hide();
			}
			return { x, y, source: result.source, visible: editable, editable };
		}
		const boundary = this._boundaryRect(position);
		if (boundary) {
			const x = boundary.x + this._collapsedTrailingSpaceWidth(position);
			if (editable) {
				this._showAt(x, boundary.y, boundary.height);
			} else {
				this._hide();
			}
			return { ...boundary, x, visible: editable, editable };
		}
		this._hide();
		return { visible: false, editable, source: result?.source ?? null };
	}

	// Method: set
	// Sets native caret selection in the window on specified `node` at `offset`.
	set(node, offset, focus = true) {
		if (!node) {
			return;
		}
		const selection = window.getSelection();
		const range = document.createRange();
		try {
			range.setStart(node, offset);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			if (focus && node.parentElement) {
				node.parentElement.focus();
			}
			return range;
		} catch (_e) {
			console.error(
				`[hed] Unable to set caret: ${_e}`,
				{ node, offset },
				_e,
			);
		}
	}
}

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
		this.caret = new Caret(document.getElementById("caret"));
		this._input = input;
		this._eventFocusedNode = null;
		this._eventActivePath = [];
	}

	// Property: editor
	// Retrieves the associated Editor instance.
	get editor() {
		return this._input.editor;
	}

	// Property: text
	// Retrieves the active document TextAdapter.
	get text() {
		const text = this.editor.text;
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
		if (this.selectionKind === "range") {
			const next = this.selection.replaceWithText(text);
			if (next) {
				this._desiredX = null;
				this.moveTo(next.index, { skipBoundaryCollapse: true });
			}
			return;
		}
		if (this.selectionKind === "node") {
			this.replaceSelectedNode(text);
			return;
		}
		const position = this.text.positionSlotAt(this.offset);
		if (!this.text.acceptsText(position)) {
			return;
		}
		const next = this.text.insertAtIndex(this.offset, text);
		this._desiredX = null;
		this.moveTo(next.index, { skipBoundaryCollapse: true });
	}

	// Method: backspace
	// Deletes the character or node immediately preceding the cursor.
	backspace() {
		if (this.selectionKind === "range") {
			const next = this.selection.replaceWithText("");
			if (next) {
				this._desiredX = null;
				this.moveTo(next.index);
			}
			return;
		}
		if (this.selectionKind === "node") {
			this.removeSelectedNode();
			return;
		}
		const next = this.text.deleteBackwardAtIndex(this.offset);
		this._desiredX = null;
		this.moveTo(next.index, {
			skipBoundaryCollapse: true,
			skipFormattingWhitespace: true,
		});
	}

	// Method: delete
	// Deletes the character or node immediately following the cursor.
	delete() {
		if (this.selectionKind === "range") {
			const next = this.selection.replaceWithText("");
			if (next) {
				this._desiredX = null;
				this.moveTo(next.index);
			}
			return;
		}
		if (this.selectionKind === "node") {
			this.removeSelectedNode();
			return;
		}
		const next = this.text.deleteForwardAtIndex(this.offset);
		this._desiredX = null;
		this.moveTo(next.index, {
			skipBoundaryCollapse: true,
			skipFormattingWhitespace: true,
		});
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
	// Resolves full trackable path from the anchor node.
	_resolveActiveTrackablePath(current) {
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
		const previous = this._snapshot();
		this._clearNodeSelection();
		this.selection.set(anchorOffset, focusOffset);
		const normalized = this.selection.normalizedRange();
		this.offset = move.clamped;
		this.anchor = move.position.focusNode;
		this.delta = move.position.point.offset;
		this.direction = move.direction;
		if (normalized.collapsed) {
			this.selectionKind = "caret";
			this.selection.clear();
			const caret = this.caret.setVirtual(move.position, {
				editable: caretEditable,
			});
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
			return;
		}
		this.selectionKind = "range";
		this.caret.setVirtual(null);
		const render = this.selection.apply();
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
			caretEditable: false,
			caretVisible: false,
			caretSource: null,
			selectionVisible: render.visible,
		};
		this._emitMove(previous, current);
	}

	// Method: select
	// Applies semantic text or node selection depending on argument shape.
	select(target, focusOrOptions) {
		if (typeof target === "number") {
			const anchorOffset = target;
			const focusOffset = focusOrOptions;
			if (typeof focusOffset !== "number") {
				return false;
			}

			const previous = this._snapshot();
			this._clearNodeSelection();
			this.selection.set(anchorOffset, focusOffset);
			const normalized = this.selection.normalizedRange();
			if (normalized.collapsed) {
				this.selection.clear();
				this.moveTo(focusOffset);
				return true;
			}

			this.selectionKind = "range";
			this.offset = this.text.clampIndex(focusOffset);
			this.anchor = this.text.focusNodeAt(this.offset) || this.anchor;
			const point = this.text.pointAt(this.offset);
			this.delta = point?.offset ?? this.delta;
			this.direction =
				previous.offset === undefined
					? 0
					: this.offset > previous.offset
						? 1
						: this.offset < previous.offset
							? -1
							: 0;
			this.caret.setVirtual(null);
			const render = this.selection.apply();
			this._emitMove(previous, {
				...this._snapshot(),
				requestedOffset: focusOffset,
				kind: "range-selection",
				boundary: null,
				char: null,
				remap: {
					from: focusOffset,
					to: this.offset,
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
				(this.text.isAtom(node)
					? "atom"
					: this.text.isContainer(node)
						? "container"
						: null);
			if (!kind) {
				return false;
			}

			const side = options.side ?? "before";
			const direction = options.direction ?? (side === "after" ? -1 : 1);
			const offset = options.offset ?? this._boundaryIndexForNode(node, side);
			const behavior = options.behavior ?? (kind === "atom" ? "skip" : "enter");
			this._selectNode(node, offset, direction, behavior);
			return true;
		}

		return false;
	}

	// Method: _advanceHorizontalOffset
	// Moves caret position horizontally, skipping whitespace according to configuration.
	_advanceHorizontalOffset(origin, direction) {
		const current = this._canonicalOffset(origin, direction);
		let next = this.text.moveIndex(current, direction, {
			skipWhitespace: this.skipWhitespace,
		});
		next = this._remapFormattingWhitespace(next, direction).offset;
		let canonical = this._canonicalOffset(next, direction);
		const movesForward = value =>
			direction > 0 ? value > current : value < current;
		while (canonical === current) {
			const advanced = this.text.moveIndex(next, direction, {
				skipWhitespace: this.skipWhitespace,
			});
			if (advanced === next) {
				break;
			}
			const remapped = this._remapFormattingWhitespace(advanced, direction).offset;
			if (!movesForward(remapped)) {
				break;
			}
			next = remapped;
			canonical = this._canonicalOffset(next, direction);
			if (!movesForward(canonical)) {
				break;
			}
		}
		return canonical;
	}

	// Method: _verticalTarget
	// Solves target caret slot when traversing vertically.
	_verticalTarget(origin, direction) {
		const visibleOrigin = this._visibleEquivalentOffset(origin, direction);
		const next = this.text.indexFromLineMove(
			visibleOrigin,
			direction,
			this._desiredX,
		);
		this._desiredX = next.desiredX;
		return this._resolveMoveOffset(next.index, {
			skipBoundaryCollapse: true,
			preserveVisibleEquivalent: true,
			visibleDirection: direction,
		});
	}

	// Method: _nodeSelectionRange
	// Gets selection index boundaries for currently highlighted node.
	_nodeSelectionRange() {
		if (!this.selectedNode) {
			return null;
		}
		return {
			start: this._boundaryIndexForNode(this.selectedNode, "before"),
			end: this._boundaryIndexForNode(this.selectedNode, "after"),
		};
	}

	// Method: _collapseRangeSelection
	// Collapses range selection in designated `direction`.
	_collapseRangeSelection(direction) {
		const normalized = this.selection.normalizedRange();
		const target = direction < 0 ? normalized.start : normalized.end;
		this._desiredX = null;
		this.moveTo(target);
	}

	// Method: _selectNode
	// Selects entire container or atom element `node` at boundary index.
	_selectNode(node, offset, direction, behavior = "enter") {
		const previous = this._snapshot();
		this.selection.clear();
		this.selectionKind = "node";
		this.selectedNode = node;
		this.selectedOffset = offset;
		this.selectedDirection = direction;
		this.selectedBehavior = behavior;
		this.offset = offset;
		this.anchor = node;
		this.delta = null;
		this.direction = direction;
		this.caret.setVirtual(null);
		const current = {
			...this._snapshot(),
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
		this._emitMove(previous, current);
	}

	// Method: selectNode
	// Applies semantic node selection for container or atom `node`.
	selectNode(node, options = {}) {
		return this.select(node, options);
	}

	// Method: selectAtom
	// Directly selects atomic `node` element at designated `side`.
	selectAtom(node, side = "before") {
		if (node?.nodeType !== Node.ELEMENT_NODE || !this.text.isAtom(node)) {
			return false;
		}
		return this.select(node, { kind: "atom", side, behavior: "skip" });
	}

	// Method: selectContainer
	// Directly selects structural container `node` at designated `side`.
	selectContainer(node, side = "before") {
		if (node?.nodeType !== Node.ELEMENT_NODE || !this.text.isContainer(node)) {
			return false;
		}
		return this.select(node, { kind: "container", side, behavior: "enter" });
	}

	// Method: _moveFromSelectedNode
	// Resolves next caret position when exiting a node selection in `direction`.
	_moveFromSelectedNode(direction) {
		const originOffset = this.selectedOffset ?? this.offset;
		const selectedNode = this.selectedNode;
		const selectedDirection = this.selectedDirection;
		const selectedBehavior = this.selectedBehavior;
		if (!selectedNode) {
			this._clearNodeSelection();
			this.selectionKind = "caret";
			this.moveTo(originOffset);
			return;
		}
		if (direction === selectedDirection) {
			if (selectedBehavior === "skip") {
				const exitIndex = this._exitIndexForNode(
					selectedNode,
					direction,
					originOffset,
				);
				this._clearNodeSelection();
				this.selectionKind = "caret";
				this.moveTo(exitIndex);
				return;
			}
			const entry = this._entryIndexForNode(selectedNode, direction);
			this._clearNodeSelection();
			this.selectionKind = "caret";
			if (entry !== null) {
				this.moveTo(entry);
				return;
			}
		}
		this._clearNodeSelection();
		this.selectionKind = "caret";
		this.moveTo(originOffset);
	}

	// Method: replaceSelectedNode
	// Replaces selected element node with plain text `text`.
	replaceSelectedNode(text) {
		const node = this.selectedNode;
		const offset = this.selectedOffset ?? this.offset;
		if (!node?.parentNode) {
			this._clearNodeSelection();
			this.selectionKind = "caret";
			this.moveTo(offset);
			return;
		}
		const textNode = document.createTextNode(text);
		node.replaceWith(textNode);
		this.text.invalidatePositions();
		this.text.ensurePositions();
		const nextIndex = this.text.indexOfPoint({ node: textNode, offset: text.length });
		this._desiredX = null;
		this._clearNodeSelection();
		this.selectionKind = "caret";
		this.moveTo(nextIndex >= 0 ? nextIndex : offset);
	}

	// Method: removeSelectedNode
	// Deletes the currently selected node from DOM tree.
	removeSelectedNode() {
		const node = this.selectedNode;
		const offset = this.selectedOffset ?? this.offset;
		if (node?.parentNode) {
			node.remove();
			this.text.invalidatePositions();
			this.text.ensurePositions();
		}
		this._desiredX = null;
		this._clearNodeSelection();
		this.selectionKind = "caret";
		this.moveTo(offset);
	}

	// Method: _moveHorizontal
	// Internal controller for horizontal cursor movement.
	_moveHorizontal(direction, extend = false) {
		if (extend) {
			this._desiredX = null;
			let anchorOffset = this.selection.isActive ? this.selection.anchorOffset : this.offset;
			let focusOffset = this.selection.isActive ? this.selection.focusOffset : this.offset;
			if (this.selectionKind === "node") {
				const range = this._nodeSelectionRange();
				if (!range) {
					return;
				}
				anchorOffset = direction < 0 ? range.end : range.start;
				focusOffset = direction < 0 ? range.start : range.end;
			}
			const target = this._advanceHorizontalOffset(focusOffset, direction);
			const move = this._resolveMoveOffset(target);
			if (!move) {
				return;
			}
			this._setRangeSelection(anchorOffset, move.clamped, move);
			return;
		}
		if (this.selectionKind === "range") {
			this._collapseRangeSelection(direction);
			return;
		}
		if (this.selectionKind === "node") {
			this._moveFromSelectedNode(direction);
			return;
		}
		this._desiredX = null;
		const explicitSelection = this._structuralSelectionAt(this.offset, direction);
		if (explicitSelection) {
			this.select(explicitSelection.node, {
				offset: explicitSelection.offset,
				direction: explicitSelection.direction,
				behavior: explicitSelection.behavior,
			});
			return;
		}
		const current = this._canonicalOffset(this.offset, direction);
		const structuralSelection = this._structuralSelectionAt(current, direction);
		if (structuralSelection) {
			this.select(structuralSelection.node, {
				offset: structuralSelection.offset,
				direction: structuralSelection.direction,
				behavior: structuralSelection.behavior,
			});
			return;
		}
		this.moveTo(this._advanceHorizontalOffset(current, direction));
	}

	// Method: _moveVertical
	// Internal controller for vertical cursor movement.
	_moveVertical(direction, extend = false) {
		if (extend) {
			let anchorOffset = this.selection.isActive ? this.selection.anchorOffset : this.offset;
			let focusOffset = this.selection.isActive ? this.selection.focusOffset : this.offset;
			if (this.selectionKind === "node") {
				const range = this._nodeSelectionRange();
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
			this._setRangeSelection(anchorOffset, move.clamped, move);
			return;
		}
		if (this.selectionKind === "range") {
			this._collapseRangeSelection(direction);
			return;
		}
		const move = this._verticalTarget(this.offset, direction);
		if (!move) {
			return;
		}
		this.moveTo(move.clamped, {
			skipBoundaryCollapse: true,
			preserveVisibleEquivalent: true,
			visibleDirection: direction,
		});
	}

	// Method: moveTo
	// Sets the cursor location to specified position `offset`.
	moveTo(offset, options = {}) {
		const previous = this._snapshot();
		const move = this._resolveMoveOffset(offset, options);
		if (!move) {
			this._clearNodeSelection();
			this.selection.clear();
			this.selectionKind = "caret";
			this.offset = 0;
			this.anchor = this.editor.root;
			this.delta = 0;
			this.caret.setVirtual(null);
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
		this._moveHorizontal(-1, extend);
	}

	// Method: right
	// Moves the cursor to the right, optionally extending selection.
	right(extend = false) {
		this._moveHorizontal(1, extend);
	}

	// Method: up
	// Moves the cursor up one line, optionally extending selection.
	up(extend = false) {
		this._moveVertical(-1, extend);
	}

	// Method: down
	// Moves the cursor down one line, optionally extending selection.
	down(extend = false) {
		this._moveVertical(1, extend);
	}
}

export { Caret, Cursor };

// EOF
