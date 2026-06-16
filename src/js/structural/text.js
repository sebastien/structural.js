// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: text
// Wraps a DOM tree and schema, supporting key text and structural operations.

// ----------------------------------------------------------------------------
//
// MODULE FUNCTIONS
//
// ----------------------------------------------------------------------------

const NodeKeys = new WeakMap();
let NextNodeKey = 1;

// Function: nodeKey
// Retrieves or assigns a unique numeric key for a DOM `node`.
function nodeKey(node) {
	if (!NodeKeys.has(node)) {
		NodeKeys.set(node, NextNodeKey++);
	}
	return NodeKeys.get(node);
}

// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: TextAdapter
// Core text adapter that tracks, indexes, and queries caret positions over a DOM tree.
// - root: HTMLElement - root element of the editor
// - skipFormattingWhitespace: boolean - whether to skip formatting whitespace
class TextAdapter {
	// ----------------------------------------------------------------------------
	//
	// LIFECYCLE
	//
	// ----------------------------------------------------------------------------

	// Method: constructor
	// Initializes the `TextAdapter` with a `root` DOM element and `options`.
	constructor(root, options = {}) {
		this.root = root;
		this._acceptsText =
			typeof options.acceptsText === "function" ? options.acceptsText : null;
		this.skipFormattingWhitespaceConfigured = Object.hasOwn(
			options,
			"skipFormattingWhitespace",
		);
		this.skipFormattingWhitespace = options.skipFormattingWhitespace ?? false;
		this._positions = [];
		this._positionsDirty = true;
		this._observer = null;
		this._segmenter = typeof Intl !== "undefined" && Intl.Segmenter
			? new Intl.Segmenter(undefined, { granularity: "grapheme" })
			: null;
		this._onMutations = this.onMutations.bind(this);
	}

	_graphemeBoundaries(text = "") {
		const boundaries = [0];
		if (!text) return boundaries;
		if (this._segmenter) {
			for (const { index, segment } of this._segmenter.segment(text)) {
				const next = index + segment.length;
				if (next !== boundaries[boundaries.length - 1]) boundaries.push(next);
			}
			return boundaries;
		}
		let offset = 0;
		for (const char of Array.from(text)) {
			offset += char.length;
			boundaries.push(offset);
		}
		return boundaries;
	}

	_graphemeCount(text = "") {
		return Math.max(0, this._graphemeBoundaries(text).length - 1);
	}

	_codeUnitOffsetAtGrapheme(text = "", graphemeIndex = 0) {
		const boundaries = this._graphemeBoundaries(text);
		const index = Math.max(0, Math.min(graphemeIndex, boundaries.length - 1));
		return boundaries[index] ?? text.length;
	}

	_graphemeIndexAtCodeUnit(text = "", codeUnitOffset = 0) {
		const boundaries = this._graphemeBoundaries(text);
		for (let i = 0; i < boundaries.length; i += 1) {
			if (boundaries[i] >= codeUnitOffset) return i;
		}
		return boundaries.length - 1;
	}

	// Method: attach
	// Attaches a MutationObserver to monitor changes to the `root` element.
	attach() {
		if (this._observer || !this.root) {
			return this;
		}
		this._observer = new MutationObserver(this._onMutations);
		this._observer.observe(this.root, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		this.invalidatePositions();
		return this;
	}

	// Method: detach
	// Detaches the MutationObserver from the `root` element.
	detach() {
		if (this._observer) {
			this._observer.disconnect();
			this._observer = null;
		}
		return this;
	}

	// Method: onMutations
	// Handles DOM mutation events to invalidate positions.
	onMutations(mutations) {
		if (mutations?.length) {
			this.invalidatePositions();
		}
	}

	// ----------------------------------------------------------------------------
	//
	// NODE STATUS
	//
	// ----------------------------------------------------------------------------

	// Method: isSkipped
	// Checks if the given `node` is marked to be skipped during traversal.
	isSkipped(node) {
		return (
			node?.classList?.contains("skipped") ||
			node?.classList?.contains("skip") ||
			node?.classList?.contains("S")
		);
	}

	// Method: isContainer
	// Checks if the given `node` is marked as a structural container.
	isContainer(node) {
		return (
			node?.classList?.contains("container") ||
			node?.classList?.contains("C")
		);
	}

	// Method: isAtom
	// Checks if the given `node` is marked as an atomic/atom element.
	isAtom(node) {
		return (
			node?.classList?.contains("atom") ||
			node?.classList?.contains("atomic")
		);
	}

	// Method: isWhitespacePreserved
	// Checks if the given `node` or its parent preserves whitespace (e.g. pre or code).
	isWhitespacePreserved(node) {
		const element =
			node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
		if (!element) {
			return false;
		}
		if (element.closest("pre, code")) {
			return true;
		}
		const whiteSpace = window.getComputedStyle(element).whiteSpace;
		return (
			whiteSpace === "pre" ||
			whiteSpace === "pre-wrap" ||
			whiteSpace === "break-spaces"
		);
	}

	// ----------------------------------------------------------------------------
	//
	// POSITIONS
	//
	// ----------------------------------------------------------------------------

	// Method: rebuildPositions
	// Rebuilds the flat list of caret position slots starting from `root`.
	rebuildPositions() {
		this._positions = this._buildPositions(this.root);
		this._positionsDirty = false;
		return this._positions;
	}

	// Method: invalidatePositions
	// Marks the current cached position slots as dirty/invalid.
	invalidatePositions() {
		this._positionsDirty = true;
	}

	// Method: ensurePositions
	// Ensures that the positions array is built and up-to-date.
	ensurePositions() {
		if (this._positionsDirty) {
			this.rebuildPositions();
		}
		return this._positions;
	}

	// Method: refresh
	// Forcefully invalidates and rebuilds cached position slots.
	refresh() {
		this.invalidatePositions();
		return this.ensurePositions();
	}

	// Method: positions
	// Returns the current cached position slots.
	positions() {
		return this.ensurePositions();
	}

	// ----------------------------------------------------------------------------
	//
	// POSITION ACCESS
	//
	// ----------------------------------------------------------------------------

	// Method: pointAt
	// Gets the text point at the specified position `index`.
	pointAt(index) {
		const position = this.ensurePositions()[index];
		return position?.point ?? null;
	}

	// Method: positionSlotAt
	// Gets the complete position slot info at the specified `index`.
	positionSlotAt(index) {
		return this.ensurePositions()[index] ?? null;
	}

	// Method: indexOfPoint
	// Finds the slot index matching the specified `point`.
	indexOfPoint(point) {
		if (!point?.node) {
			return -1;
		}
		const positions = this.ensurePositions();
		for (let i = 0; i < positions.length; i += 1) {
			const candidate = positions[i]?.point;
			if (
				candidate?.node === point.node &&
				candidate.offset === point.offset
			) {
				return i;
			}
		}
		return -1;
	}

	// Method: offsetWithin
	// Converts a DOM `point` into a subtree-local grapheme offset within `root`.
	offsetWithin(root, point) {
		if (!root?.isConnected || !point?.node) {
			return -1;
		}
		const element = point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentElement;
		if (!element || (element !== root && !root.contains(element))) {
			return -1;
		}
		const range = document.createRange();
		try {
			range.selectNodeContents(root);
			range.setEnd(point.node, point.offset);
			return this._graphemeCount(range.toString());
		} catch (_e) {
			return -1;
		}
	}

	// Method: pointAtOffsetWithin
	// Resolves a DOM point at subtree-local grapheme `offset` within `root`.
	pointAtOffsetWithin(root, offset, bias = "forward") {
		if (!root?.isConnected) {
			return null;
		}
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let remaining = Math.max(0, offset);
		let last = null;
		while (walker.nextNode()) {
			const node = walker.currentNode;
			last = node;
			const length = this._graphemeCount(node.data);
			if (remaining < length || (bias === "backward" && remaining === length)) {
				return {
					node,
					offset: this._codeUnitOffsetAtGrapheme(node.data, remaining),
				};
			}
			remaining -= length;
		}
		return last
			? { node: last, offset: last.data.length }
			: { node: root, offset: root.childNodes.length };
	}

	// Method: acceptsText
	// Checks if the specified `position` accepts text insertion.
	acceptsText(position) {
		if (!position?.point?.node) {
			return false;
		}
		if (this._acceptsText) {
			return this._acceptsText(position, this) === true;
		}
		return this._defaultAcceptsText(position);
	}

	// Method: focusNodeAt
	// Gets the focus node at the specified position `index`.
	focusNodeAt(index) {
		const position = this.ensurePositions()[index];
		return position?.focusNode ?? null;
	}

	// Method: _caretRectFromRect
	// Internal helper to construct a virtual zero-width caret rect from a bounding `rect`.
	_caretRectFromRect(rect, edge = "start") {
		const x = edge === "end" ? rect.right : rect.left;
		return {
			x,
			y: rect.top,
			left: x,
			right: x,
			top: rect.top,
			bottom: rect.bottom,
			width: 0,
			height: rect.height,
		};
	}

	// Method: visualPositionAt
	// Gets the visual bounding client rect for the position at `index`.
	visualPositionAt(index) {
		const point = this.pointAt(index);
		if (!point) {
			return null;
		}
		const range = document.createRange();
		try {
			range.setStart(point.node, point.offset);
			range.collapse(true);
			const rect = range.getBoundingClientRect();
			if (rect.width !== 0 || rect.height !== 0) {
				return { index, rect };
			}
			if (point.node?.nodeType === Node.ELEMENT_NODE) {
				const nextSibling = point.node.childNodes[point.offset] ?? null;
				const previousSibling = point.node.childNodes[point.offset - 1] ?? null;
				const sibling = nextSibling ?? previousSibling;
				const siblingRect = sibling?.getBoundingClientRect?.();
				if (siblingRect && (siblingRect.width !== 0 || siblingRect.height !== 0)) {
					return {
						index,
						rect: this._caretRectFromRect(
							siblingRect,
							nextSibling ? "start" : "end",
						),
					};
				}
				const nodeRect = point.node.getBoundingClientRect();
				if (nodeRect.width !== 0 || nodeRect.height !== 0) {
					return { index, rect: this._caretRectFromRect(nodeRect) };
				}
			}
			return { index, rect };
		} catch (_e) {
			return null;
		}
	}

	// Method: hasVisibleRectAt
	// Checks if the position slot at `index` has a visible visual layout rect.
	hasVisibleRectAt(index) {
		const visual = this.visualPositionAt(index);
		if (!visual) {
			return false;
		}
		const { width, height } = visual.rect;
		return width !== 0 || height !== 0;
	}

	// Method: isFormattingWhitespaceNode
	// Checks if the given `node` consists of formatting whitespace that should be ignored.
	isFormattingWhitespaceNode(node) {
		return (
			node?.nodeType === Node.TEXT_NODE &&
			/^\s*$/.test(node.data ?? "") &&
			!this.isWhitespacePreserved(node)
		);
	}

	// Method: isFormattingWhitespaceSlot
	// Checks if the position slot at `index` belongs to formatting whitespace.
	isFormattingWhitespaceSlot(index) {
		const slot = this.positionSlotAt(index);
		if (!slot || this.hasVisibleRectAt(index)) {
			return false;
		}
		if (this.isFormattingWhitespaceNode(slot.point.node)) {
			return true;
		}
		if (this.isFormattingWhitespaceNode(slot.boundary?.leftNode)) {
			return true;
		}
		if (this.isFormattingWhitespaceNode(slot.boundary?.rightNode)) {
			return true;
		}
		if (slot.point.node?.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		const childCount = slot.point.node.childNodes.length;
		if (
			slot.point.offset === 0 &&
			this.isFormattingWhitespaceNode(slot.point.node.previousSibling)
		) {
			return true;
		}
		if (
			slot.point.offset === childCount &&
			this.isFormattingWhitespaceNode(slot.point.node.nextSibling)
		) {
			return true;
		}
		return false;
	}

	// ----------------------------------------------------------------------------
	//
	// NAVIGATION
	//
	// ----------------------------------------------------------------------------

	// Method: indexFromPoint
	// Finds the nearest position slot index to visual coordinates `x` and `y`.
	indexFromPoint(x, y) {
		this.ensurePositions();
		let best = 0;
		let bestDistance = Infinity;
		for (let i = 0; i < this._positions.length; i += 1) {
			if (!this.acceptsText(this._positions[i]) || this.isFormattingWhitespaceSlot(i)) {
				continue;
			}
			const candidate = this.visualPositionAt(i);
			if (!candidate) {
				continue;
			}
			const dx = candidate.rect.left - x;
			const dy = candidate.rect.top - y;
			const distance = Math.abs(dx) + Math.abs(dy) * 2;
			if (distance < bestDistance) {
				best = i;
				bestDistance = distance;
			}
		}
		return best;
	}

	// Method: clampIndex
	// Clamps the given `index` to a valid range within positions list.
	clampIndex(index) {
		this.ensurePositions();
		if (this._positions.length === 0) {
			return 0;
		}
		const value = Number.isFinite(index) ? index : 0;
		return Math.max(0, Math.min(value, this._positions.length - 1));
	}

	// Method: moveIndex
	// Moves the current `index` by `delta` positions, optionally applying `options`.
	moveIndex(index, delta, options = {}) {
		const direction = delta < 0 ? -1 : 1;
		const steps = Math.abs(delta);
		const skipWhitespace = options.skipWhitespace === true;
		let current = this.clampIndex(index);
		for (let i = 0; i < steps; i += 1) {
			current = this.clampIndex(current + direction);
			if (!skipWhitespace) {
				continue;
			}
			current = this._indexAfterWhitespace(current, direction);
		}
		return current;
	}

	// Method: _indexAfterWhitespace
	// Returns the index after skipping consecutive whitespace in the given `direction`.
	_indexAfterWhitespace(index, direction) {
		let current = this.clampIndex(index);
		while (true) {
			const next = this.clampIndex(current + direction);
			if (next === current) {
				return current;
			}
			const crossed = this._getCrossedChar(current, next);
			if (!crossed) {
				return current;
			}
			if (this.isWhitespacePreserved(crossed.node)) {
				return current;
			}
			if (!/\s/.test(crossed.char)) {
				return current;
			}
			current = next;
		}
	}

	// Method: _getCrossedChar
	// Internal helper to get character data crossed between two position slots.
	_getCrossedChar(fromIndex, toIndex) {
		const from = this._positions[fromIndex]?.point;
		const to = this._positions[toIndex]?.point;
		if (
			!from ||
			!to ||
			from.node !== to.node ||
			from.node?.nodeType !== Node.TEXT_NODE
		) {
			return null;
		} else if (to.offset === from.offset + 1) {
			return { node: from.node, char: from.node.data[from.offset] ?? "" };
		} else if (from.offset === to.offset + 1) {
			return { node: to.node, char: to.node.data[to.offset] ?? "" };
		} else {
			return null;
		}
	}

	// Method: indexFromLineMove
	// Computes the best target index when moving cursor up or down from `index`.
	indexFromLineMove(index, direction, desiredX) {
		this.ensurePositions();
		const clamped = this.clampIndex(index);
		const current = this.visualPositionAt(clamped);
		if (!current) {
			return { index: clamped, desiredX };
		}
		const currentTop = current.rect.top;
		const targetX = desiredX ?? current.rect.left;
		let best = null;
		let bestLineDistance = Infinity;
		let bestHorizontalDistance = Infinity;
		const lineEpsilon = 4;

		for (let i = 0; i < this._positions.length; i += 1) {
			if (i === clamped) {
				continue;
			}
			if (!this.acceptsText(this._positions[i]) || this.isFormattingWhitespaceSlot(i)) {
				continue;
			}
			const candidate = this.visualPositionAt(i);
			if (!candidate) {
				continue;
			}
			const y = candidate.rect.top;
			if (direction < 0 && y >= currentTop - lineEpsilon) {
				continue;
			}
			if (direction > 0 && y <= currentTop + lineEpsilon) {
				continue;
			}
			const lineDistance = Math.abs(y - currentTop);
			const horizontalDistance = Math.abs(candidate.rect.left - targetX);
			if (
				lineDistance < bestLineDistance - lineEpsilon ||
				(Math.abs(lineDistance - bestLineDistance) <= lineEpsilon &&
					horizontalDistance < bestHorizontalDistance)
			) {
				best = candidate;
				bestLineDistance = lineDistance;
				bestHorizontalDistance = horizontalDistance;
			}
		}

		return { index: best?.index ?? clamped, desiredX: targetX };
	}

	// ----------------------------------------------------------------------------
	//
	// CONTEXT & MAPPING
	//
	// ----------------------------------------------------------------------------

	// Method: contextAt
	// Retrieves the contextual structural details around the specified `index`.
	contextAt(index) {
		const current = this.ensurePositions()[index];
		if (!current) {
			return null;
		}
		const point = current.point;
		const focusNode = current.focusNode;
		const parent =
			point.node.nodeType === Node.ELEMENT_NODE
				? point.node
				: point.node.parentNode;
		const prevChild =
			parent?.childNodes && point.node.nodeType === Node.ELEMENT_NODE
				? parent.childNodes[point.offset - 1]
				: null;
		const nextChild =
			parent?.childNodes && point.node.nodeType === Node.ELEMENT_NODE
				? parent.childNodes[point.offset]
				: null;
		const deleteBackward =
			prevChild?.nodeType === Node.ELEMENT_NODE &&
			(this.isAtom(prevChild) || this.isContainer(parent))
				? { type: "node", node: prevChild }
				: { type: "char" };
		const deleteForward =
			nextChild?.nodeType === Node.ELEMENT_NODE &&
			(this.isAtom(nextChild) || this.isContainer(parent))
				? { type: "node", node: nextChild }
				: { type: "char" };
		return {
			index,
			focusNode,
			kind: current.kind,
			point,
			boundary: current.boundary,
			char: current.char,
			deleteBackward,
			deleteForward,
		};
	}

	// Method: textOffsetAtIndex
	// Computes the linear text offset inside the document corresponding to `index`.
	textOffsetAtIndex(index) {
		this.ensurePositions();
		const clamped = this.clampIndex(index);
		const target = this._positions[clamped]?.point;
		if (!target) {
			return 0;
		}
		const range = document.createRange();
		try {
			range.setStart(this.root, 0);
			range.setEnd(target.node, target.offset);
			return this._graphemeCount(range.toString());
		} catch (_e) {
			return 0;
		}
	}

	// Method: positionFromPoint
	// Finds the text caret position corresponding to client coordinates `x` and `y`.
	positionFromPoint(x, y) {
		const pos = document.caretPositionFromPoint(x, y);
		const position = this.positionFromNode(pos.offsetNode);
		position.offset += pos.offsetNode?.nodeType === Node.TEXT_NODE
			? this._graphemeIndexAtCodeUnit(pos.offsetNode.data, pos.offset)
			: pos.offset;
		return position;
	}

	// Method: positionFromNode
	// Finds the caret position matching the specified DOM `node`.
	positionFromNode(node) {
		for (const p of this.iwalk(this.root, { mode: "text" })) {
			if (p.node === node) {
				return p;
			}
		}
	}

	// Method: positionAt
	// Finds the caret position at the specified linear text `offset`.
	positionAt(offset) {
		let last;
		for (const p of this.iwalk(this.root, { mode: "text" })) {
			if (p.offset > offset) {
				last.delta = offset - last.offset;
				last.codeUnitOffset = this._codeUnitOffsetAtGrapheme(last.node?.data ?? "", last.delta);
				return last;
			} else {
				last = Object.assign(last ?? {}, p);
			}
		}
		if (!last) return null;
		last.delta = Math.max(0, Math.min(last.length, offset - last.offset));
		last.codeUnitOffset = this._codeUnitOffsetAtGrapheme(last.node?.data ?? "", last.delta);
		return last;
	}

	// ----------------------------------------------------------------------------
	//
	// INDEX-BASED EDIT OPERATIONS
	//
	// ----------------------------------------------------------------------------

	// Method: insertAtIndex
	// Inserts `text` at the specified position `index`.
	insertAtIndex(index, text) {
		const clamped = this.clampIndex(index);
		const position = this.positionSlotAt(clamped);
		if (!this.acceptsText(position)) {
			return { index: clamped };
		}
		const point = this.pointAt(clamped);
		const insertedPoint = point ? this.insertAtPoint(point, text) : null;
		this.invalidatePositions();
		this.ensurePositions();
		const nextIndex = this.indexOfPoint(insertedPoint);
		return {
			index:
				nextIndex >= 0 ? nextIndex : this.clampIndex(clamped + this._graphemeCount(text)),
		};
	}

	// Method: deleteBackwardAtIndex
	// Performs a backspace delete action at the specified position `index`.
	deleteBackwardAtIndex(index) {
		const clamped = this.clampIndex(index);
		if (clamped <= 0) {
			return { index: clamped };
		}
		const context = this.contextAt(clamped);
		if (context?.deleteBackward?.type === "node") {
			context.deleteBackward.node.remove();
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped - 1) };
		}
		if (context?.point?.node?.nodeType === Node.ELEMENT_NODE && context.boundary?.leftNode?.nodeType === Node.TEXT_NODE) {
			const node = context.boundary.leftNode;
			const boundaries = this._graphemeBoundaries(node.data);
			if (boundaries.length > 1) {
				const startOffset = boundaries[boundaries.length - 2];
				const endOffset = boundaries[boundaries.length - 1];
				node.data = `${node.data.slice(0, startOffset)}${node.data.slice(endOffset)}`;
				this.invalidatePositions();
				this.ensurePositions();
				return { index: this.clampIndex(clamped - 1) };
			}
		}
		const point = this.pointAt(clamped);
		if (point?.node?.nodeType === Node.TEXT_NODE && point.offset > 0) {
			const boundaries = this._graphemeBoundaries(point.node.data);
			const current = boundaries.indexOf(point.offset);
			const index = current >= 0 ? current : this._graphemeIndexAtCodeUnit(point.node.data, point.offset);
			const startOffset = boundaries[Math.max(0, index - 1)] ?? 0;
			const endOffset = boundaries[index] ?? point.offset;
			point.node.data = `${point.node.data.slice(0, startOffset)}${point.node.data.slice(endOffset)}`;
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped - 1) };
		}
		this.deleteAt(this.textOffsetAtIndex(clamped) - 1, 1);
		this.invalidatePositions();
		this.ensurePositions();
		return { index: this.clampIndex(clamped - 1) };
	}

	// Method: deleteForwardAtIndex
	// Performs a forward delete action at the specified position `index`.
	deleteForwardAtIndex(index) {
		const clamped = this.clampIndex(index);
		const context = this.contextAt(clamped);
		if (context?.deleteForward?.type === "node") {
			context.deleteForward.node.remove();
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped) };
		}
		if (context?.point?.node?.nodeType === Node.ELEMENT_NODE && context.boundary?.rightNode?.nodeType === Node.TEXT_NODE) {
			const node = context.boundary.rightNode;
			const boundaries = this._graphemeBoundaries(node.data);
			if (boundaries.length > 1) {
				const startOffset = boundaries[0];
				const endOffset = boundaries[1];
				node.data = `${node.data.slice(0, startOffset)}${node.data.slice(endOffset)}`;
				this.invalidatePositions();
				this.ensurePositions();
				return { index: this.clampIndex(clamped) };
			}
		}
		const point = this.pointAt(clamped);
		if (point?.node?.nodeType === Node.TEXT_NODE && point.offset < point.node.data.length) {
			const boundaries = this._graphemeBoundaries(point.node.data);
			const current = boundaries.indexOf(point.offset);
			const index = current >= 0 ? current : this._graphemeIndexAtCodeUnit(point.node.data, point.offset);
			const startOffset = boundaries[index] ?? point.offset;
			const endOffset = boundaries[Math.min(boundaries.length - 1, index + 1)] ?? point.offset;
			point.node.data = `${point.node.data.slice(0, startOffset)}${point.node.data.slice(endOffset)}`;
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped) };
		}
		this.deleteAt(this.textOffsetAtIndex(clamped), 1);
		this.invalidatePositions();
		this.ensurePositions();
		return { index: this.clampIndex(clamped) };
	}

	// ----------------------------------------------------------------------------
	//
	// TEXT OPERATIONS
	//
	// ----------------------------------------------------------------------------

	// Method: insertAt
	// Inserts `text` at the specified linear text `offset`.
	insertAt(offset, text) {
		const { node, codeUnitOffset } = this.positionAt(offset);
		return this.insertAtPoint({ node, offset: codeUnitOffset }, text);
	}

	// Method: insertAtPoint
	// Inserts `text` at the given DOM text `point`.
	insertAtPoint(point, text) {
		const { node, offset } = point;
		switch (node?.nodeType) {
			case Node.TEXT_NODE:
				{
					const data = node.data;
					node.data = `${data.slice(0, offset)}${text}${data.slice(offset)}`;
					return { node, offset: offset + text.length };
				}
			case Node.ELEMENT_NODE:
				{
					const textNode = document.createTextNode(text);
					const beforeNode = node.childNodes[offset] ?? null;
					node.insertBefore(textNode, beforeNode);
					return { node: textNode, offset: text.length };
				}
		}
		return null;
	}

	// Method: deleteAt
	// Deletes text of given `length` starting from linear `offset`.
	deleteAt(offset, length = 1) {
		if (length <= 0) {
			return;
		}
		let remaining = length;
		let currentOffset = offset;
		while (remaining > 0) {
			const position = this.positionAt(currentOffset);
			if (!position) {
				break;
			}
			const { node, delta } = position;
			if (node?.nodeType !== Node.TEXT_NODE) {
				break;
			}
			const available = this._graphemeCount(node.data) - delta;
			if (available <= 0) {
				currentOffset += 1;
				continue;
			}
			const count = Math.min(available, remaining);
			const data = node.data;
			const startOffset = this._codeUnitOffsetAtGrapheme(data, delta);
			const endOffset = this._codeUnitOffsetAtGrapheme(data, delta + count);
			node.data = `${data.slice(0, startOffset)}${data.slice(endOffset)}`;
			remaining -= count;
		}
	}

	// Method: replaceAt
	// Replaces text of given `length` at `offset` with `text`.
	replaceAt(offset, length, text) {
		this.deleteAt(offset, length);
		if (text?.length) {
			this.insertAt(offset, text);
		}
	}

	// Method: textBetween
	// Extracts the raw text string between linear offsets `start` and `end`.
	textBetween(start, end) {
		const from = Math.max(0, Math.min(start, end));
		const to = Math.max(0, Math.max(start, end));
		let text = "";
		let offset = 0;
		for (const p of this.iwalk(this.root, { mode: "text" })) {
			if (p.node?.nodeType !== Node.TEXT_NODE) {
				continue;
			}
			const data = p.node.data;
			const nextOffset = offset + this._graphemeCount(data);
			if (nextOffset <= from) {
				offset = nextOffset;
				continue;
			}
			if (offset >= to) {
				break;
			}
			const sliceStart = Math.max(0, from - offset);
			const sliceEnd = Math.min(this._graphemeCount(data), to - offset);
			if (sliceEnd > sliceStart) {
				text += data.slice(
					this._codeUnitOffsetAtGrapheme(data, sliceStart),
					this._codeUnitOffsetAtGrapheme(data, sliceEnd),
				);
			}
			offset = nextOffset;
		}
		return text;
	}

	// ----------------------------------------------------------------------------
	//
	// INTERNALS
	//
	// ----------------------------------------------------------------------------

	// Method: _shouldEmitBoundary
	// Internal helper to determine if caret boundaries should be emitted for `parent` child.
	_shouldEmitBoundary(parent, childIndex) {
		// Emits caret boundaries for structural navigation. For skipped children
		// inside containers, boundaries at the container edges are suppressed so
		// the cursor does not stop on non-meaningful outer edges.
		const child = parent.childNodes[childIndex];
		if (!this.isContainer(parent) || !child || !this.isSkipped(child)) {
			return true;
		}
		if (childIndex === 0 || childIndex === parent.childNodes.length - 1) {
			return false;
		}
		return true;
	}

	// Method: _defaultAcceptsText
	// Default check to see if a `position` should accept text input.
	_defaultAcceptsText(position) {
		const point = position?.point;
		if (!point?.node) {
			return false;
		}
		if (point.node.nodeType === Node.TEXT_NODE) {
			return true;
		}
		if (point.node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		return (
			point.node !== this.root &&
			!this.isSkipped(point.node) &&
			!this.isAtom(point.node) &&
			!this.isContainer(point.node)
		);
	}

	// Method: _buildPositions
	// Traverses the DOM tree starting from `root` to build position slot objects.
	_buildPositions(root) {
		const slots = [];
		const seen = new Set();
		const push = (point, focusNode) => {
			if (!point?.node) {
				return;
			}
			const key = `${nodeKey(point.node)}:${point.offset}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			const resolvedFocusNode = focusNode ?? point.node;
			const kind =
				point.node?.nodeType === Node.TEXT_NODE
					? "text-point"
					: "element-boundary";
			const boundary = this._boundaryAtPoint(point);
			const char = this._charAroundPoint(point, boundary);
			slots.push({
				point,
				focusNode: resolvedFocusNode,
				kind,
				boundary,
				char,
			});
		};
		for (const p of this.iwalk(root, { mode: "positions" })) {
			push(p.point, p.focusNode);
		}
		return slots.map((slot, index) => ({ ...slot, index }));
	}

	// Method: _boundaryAtPoint
	// Determines the surrounding DOM node boundaries for the specified text `point`.
	_boundaryAtPoint(point) {
		const { node, offset } = point;
		if (node?.nodeType === Node.TEXT_NODE) {
			if (offset > 0 && offset < node.data.length) {
				return { leftNode: node, rightNode: node };
			}
			if (offset <= 0) {
				return {
					leftNode: node.previousSibling ?? null,
					rightNode: node,
				};
			}
			return {
				leftNode: node,
				rightNode: node.nextSibling ?? null,
			};
		}
		if (node?.nodeType === Node.ELEMENT_NODE) {
			const children = node.childNodes;
			return {
				leftNode: children[offset - 1] ?? null,
				rightNode: children[offset] ?? null,
			};
		}
		return { leftNode: null, rightNode: null };
	}

	// Method: _charAroundPoint
	// Extracts characters immediately preceding and succeeding the given text `point`.
	_charAroundPoint(point, boundary) {
		const { node, offset } = point;
		if (node?.nodeType === Node.TEXT_NODE) {
			const boundaries = this._graphemeBoundaries(node.data);
			const index = boundaries.indexOf(offset);
			return {
				before:
					index > 0
						? node.data.slice(boundaries[index - 1], boundaries[index])
						: null,
				after:
					index >= 0 && index < boundaries.length - 1
						? node.data.slice(boundaries[index], boundaries[index + 1])
						: null,
			};
		}
		const leftText =
			boundary.leftNode?.nodeType === Node.TEXT_NODE
				? boundary.leftNode.data
				: null;
		const rightText =
			boundary.rightNode?.nodeType === Node.TEXT_NODE
				? boundary.rightNode.data
				: null;
		return {
			before:
				leftText && leftText.length > 0
					? leftText.slice(this._codeUnitOffsetAtGrapheme(leftText, this._graphemeCount(leftText) - 1))
					: null,
			after:
				rightText && rightText.length > 0
					? rightText.slice(0, this._codeUnitOffsetAtGrapheme(rightText, 1))
					: null,
		};
	}

	// Method: iwalk
	// Iterator/Generator that walks the DOM tree, yielding positions or text slots.
	*iwalk(node = this.root, options = {}) {
		// Walks the DOM in adapter order and yields either:
		// - `mode: "text"`: linear text stream entries `{ node, offset, length }`
		// - `mode: "positions"`: caret slot entries `{ point, focusNode }`
		//
		// Text mode is used by text operations (offset mapping, extraction).
		// Positions mode is used by structural cursor navigation and boundaries.
		const mode = options.mode ?? "text";
		const state = { offset: 0 };
		const walk = function* (current, parent, childIndex) {
			if (mode === "positions") {
				if (current.nodeType === Node.TEXT_NODE) {
					for (const i of this._graphemeBoundaries(current.data)) {
						yield {
							point: { node: current, offset: i },
							focusNode: current.parentNode ?? parent,
						};
					}
					return;
				}
				if (current.nodeType !== Node.ELEMENT_NODE) {
					return;
				}
				if (this.isSkipped(current)) {
					return;
				}
				if (this.isAtom(current)) {
					return;
				}
				if (parent && this._shouldEmitBoundary(parent, childIndex)) {
					yield {
						point: { node: parent, offset: childIndex },
						focusNode: parent,
					};
				}
				const children = Array.from(current.childNodes);
				if (children.length === 0) {
					yield {
						point: { node: current, offset: 0 },
						focusNode: current,
					};
				}
				for (let i = 0; i < children.length; i += 1) {
					yield* walk.call(this, children[i], current, i);
					if (this._shouldEmitBoundary(current, i)) {
						yield {
							point: { node: current, offset: i + 1 },
							focusNode: current,
						};
					}
				}
				return;
			}

			if (current.nodeType === Node.TEXT_NODE) {
				const length = this._graphemeCount(current.data);
				yield { node: current, offset: state.offset, length };
				state.offset += length;
				return;
			}
			if (current.nodeType !== Node.ELEMENT_NODE) {
				return;
			}
			if (this.isSkipped(current)) {
				return;
			}
			yield { node: current, offset: state.offset, length: 0 };
			for (let i = 0; i < current.childNodes.length; i += 1) {
				yield* walk.call(this, current.childNodes[i], current, i);
			}
		};

		yield* walk.call(this, node, null, 0);
	}
}

export { TextAdapter };

// EOF
