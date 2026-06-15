// The `TextAdapter` wraps a DOM tree and schema, and supports key operations.
const NodeKeys = new WeakMap();
let NextNodeKey = 1;
function nodeKey(node) {
	if (!NodeKeys.has(node)) {
		NodeKeys.set(node, NextNodeKey++);
	}
	return NodeKeys.get(node);
}

class TextAdapter {
	// ========================================================================
	// LIFECYCLE
	// ========================================================================

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
		this._onMutations = this.onMutations.bind(this);
	}

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

	detach() {
		if (this._observer) {
			this._observer.disconnect();
			this._observer = null;
		}
		return this;
	}

	onMutations(mutations) {
		if (mutations?.length) {
			this.invalidatePositions();
		}
	}

	// ========================================================================
	// NODE STATUS
	// ========================================================================

	isSkipped(node) {
		return (
			node?.classList?.contains("skipped") ||
			node?.classList?.contains("skip") ||
			node?.classList?.contains("S")
		);
	}

	isContainer(node) {
		return (
			node?.classList?.contains("container") ||
			node?.classList?.contains("C")
		);
	}

	isAtom(node) {
		return (
			node?.classList?.contains("atom") ||
			node?.classList?.contains("atomic")
		);
	}

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

	// ========================================================================
	// POSITIONS
	// ========================================================================

	rebuildPositions() {
		this._positions = this._buildPositions(this.root);
		this._positionsDirty = false;
		return this._positions;
	}

	invalidatePositions() {
		this._positionsDirty = true;
	}

	ensurePositions() {
		if (this._positionsDirty) {
			this.rebuildPositions();
		}
		return this._positions;
	}

	refresh() {
		this.invalidatePositions();
		return this.ensurePositions();
	}

	positions() {
		return this.ensurePositions();
	}

	// ========================================================================
	// POSITION ACCESS
	// ========================================================================

	pointAt(index) {
		const position = this.ensurePositions()[index];
		return position?.point ?? null;
	}

	positionSlotAt(index) {
		return this.ensurePositions()[index] ?? null;
	}

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

	acceptsText(position) {
		if (!position?.point?.node) {
			return false;
		}
		if (this._acceptsText) {
			return this._acceptsText(position, this) === true;
		}
		return this._defaultAcceptsText(position);
	}

	focusNodeAt(index) {
		const position = this.ensurePositions()[index];
		return position?.focusNode ?? null;
	}

	visualPositionAt(index) {
		const point = this.pointAt(index);
		if (!point) {
			return null;
		}
		const range = document.createRange();
		try {
			range.setStart(point.node, point.offset);
			range.collapse(true);
			return { index, rect: range.getBoundingClientRect() };
		} catch (_e) {
			return null;
		}
	}

	hasVisibleRectAt(index) {
		const visual = this.visualPositionAt(index);
		if (!visual) {
			return false;
		}
		const { width, height } = visual.rect;
		return width !== 0 || height !== 0;
	}

	isFormattingWhitespaceNode(node) {
		return (
			node?.nodeType === Node.TEXT_NODE &&
			/^\s*$/.test(node.data ?? "") &&
			!this.isWhitespacePreserved(node)
		);
	}

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

	// ========================================================================
	// NAVIGATION
	// ========================================================================

	indexFromPoint(x, y) {
		this.ensurePositions();
		let best = 0;
		let bestDistance = Infinity;
		for (let i = 0; i < this._positions.length; i += 1) {
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

	clampIndex(index) {
		this.ensurePositions();
		if (this._positions.length === 0) {
			return 0;
		}
		const value = Number.isFinite(index) ? index : 0;
		return Math.max(0, Math.min(value, this._positions.length - 1));
	}

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

		for (let i = 0; i < this._positions.length; i += 1) {
			if (i === clamped) {
				continue;
			}
			const candidate = this.visualPositionAt(i);
			if (!candidate) {
				continue;
			}
			const y = candidate.rect.top;
			if (direction < 0 && y >= currentTop) {
				continue;
			}
			if (direction > 0 && y <= currentTop) {
				continue;
			}
			const lineDistance = Math.abs(y - currentTop);
			const horizontalDistance = Math.abs(candidate.rect.left - targetX);
			if (
				lineDistance < bestLineDistance ||
				(lineDistance === bestLineDistance &&
					horizontalDistance < bestHorizontalDistance)
			) {
				best = candidate;
				bestLineDistance = lineDistance;
				bestHorizontalDistance = horizontalDistance;
			}
		}

		return { index: best?.index ?? clamped, desiredX: targetX };
	}

	// ========================================================================
	// CONTEXT & MAPPING
	// ========================================================================

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
			return range.toString().length;
		} catch (_e) {
			return 0;
		}
	}

	positionFromPoint(x, y) {
		const pos = document.caretPositionFromPoint(x, y);
		const position = this.positionFromNode(pos.offsetNode);
		position.offset += pos.offset;
		return position;
	}

	positionFromNode(node) {
		for (const p of this.iwalk(this.root, { mode: "text" })) {
			if (p.node === node) {
				return p;
			}
		}
	}

	positionAt(offset) {
		let last;
		for (const p of this.iwalk(this.root, { mode: "text" })) {
			if (p.offset > offset) {
				last.delta = offset - last.offset;
				return last;
			} else {
				last = Object.assign(last ?? {}, p);
			}
		}
		return null;
	}

	// ========================================================================
	// INDEX-BASED EDIT OPERATIONS
	// ========================================================================

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
				nextIndex >= 0 ? nextIndex : this.clampIndex(clamped + text.length),
		};
	}

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
		this.deleteAt(this.textOffsetAtIndex(clamped) - 1, 1);
		this.invalidatePositions();
		this.ensurePositions();
		return { index: this.clampIndex(clamped - 1) };
	}

	deleteForwardAtIndex(index) {
		const clamped = this.clampIndex(index);
		const context = this.contextAt(clamped);
		if (context?.deleteForward?.type === "node") {
			context.deleteForward.node.remove();
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped) };
		}
		this.deleteAt(this.textOffsetAtIndex(clamped), 1);
		this.invalidatePositions();
		this.ensurePositions();
		return { index: this.clampIndex(clamped) };
	}

	// ========================================================================
	// TEXT OPERATIONS
	// ========================================================================

	insertAt(offset, text) {
		const { node, delta } = this.positionAt(offset);
		return this.insertAtPoint({ node, offset: delta }, text);
	}

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
			const available = node.data.length - delta;
			if (available <= 0) {
				currentOffset += 1;
				continue;
			}
			const count = Math.min(available, remaining);
			const data = node.data;
			node.data = `${data.slice(0, delta)}${data.slice(delta + count)}`;
			remaining -= count;
		}
	}

	replaceAt(offset, length, text) {
		this.deleteAt(offset, length);
		if (text?.length) {
			this.insertAt(offset, text);
		}
	}

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
			const nextOffset = offset + data.length;
			if (nextOffset <= from) {
				offset = nextOffset;
				continue;
			}
			if (offset >= to) {
				break;
			}
			const sliceStart = Math.max(0, from - offset);
			const sliceEnd = Math.min(data.length, to - offset);
			if (sliceEnd > sliceStart) {
				text += data.slice(sliceStart, sliceEnd);
			}
			offset = nextOffset;
		}
		return text;
	}

	// ========================================================================
	// INTERNALS
	// ========================================================================

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

	_charAroundPoint(point, boundary) {
		const { node, offset } = point;
		if (node?.nodeType === Node.TEXT_NODE) {
			return {
				before: offset > 0 ? (node.data[offset - 1] ?? null) : null,
				after: offset < node.data.length ? (node.data[offset] ?? null) : null,
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
				leftText && leftText.length > 0 ? leftText[leftText.length - 1] : null,
			after: rightText && rightText.length > 0 ? rightText[0] : null,
		};
	}

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
					for (let i = 0; i <= current.data.length; i += 1) {
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
				const length = current.data.length;
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
