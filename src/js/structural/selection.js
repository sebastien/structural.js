// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: selection
// Manages and overlays selection ranges in the editor.

// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: SelectionOverlay
// Renders visual overlays of selection ranges.
// - node: HTMLElement - the overlay host element
class SelectionOverlay {
	constructor(node) {
		this.node = node ?? null;
	}

	// Method: _clearVirtual
	// Removes the virtual selection blocks from the DOM.
	_clearVirtual() {
		if (!this.node) {
			return;
		}
		this.node.replaceChildren();
		this.node.style.visibility = "hidden";
	}

	// Method: _clearNative
	// Clears any active native document selection.
	_clearNative() {
		window.getSelection()?.removeAllRanges();
	}

	// Method: clear
	// Clears both native and virtual selections.
	clear() {
		this._clearNative();
		this._clearVirtual();
		return { visible: false, mode: null };
	}

	// Method: _applyNative
	// Applies native selection on the specified DOM `range`.
	_applyNative(range) {
		const selection = window.getSelection();
		if (!selection) {
			return { visible: false, mode: "native" };
		}
		this._clearVirtual();
		selection.removeAllRanges();
		selection.addRange(range);
		return { visible: true, mode: "native" };
	}

	// Method: _applyVirtual
	// Renders virtual selection highlights over client rects of the given `range`.
	_applyVirtual(range) {
		this._clearNative();
		if (!this.node) {
			return { visible: false, mode: "virtual" };
		}
		const rects = Array.from(range.getClientRects()).filter(
			rect => rect.width !== 0 || rect.height !== 0,
		);
		this.node.replaceChildren(
			...rects.map(rect => {
				const block = document.createElement("div");
				block.style.position = "absolute";
				block.style.left = `${rect.left + window.scrollX}px`;
				block.style.top = `${rect.top + window.scrollY}px`;
				block.style.width = `${rect.width}px`;
				block.style.height = `${rect.height}px`;
				block.style.backgroundColor = "rgba(0, 120, 255, 0.22)";
				block.style.pointerEvents = "none";
				return block;
			}),
		);
		this.node.style.visibility = rects.length > 0 ? "visible" : "hidden";
		return { visible: rects.length > 0, mode: "virtual" };
	}

	// Method: apply
	// Applies a selection on `range` with the given `mode` ("native" or "virtual").
	apply(range, mode) {
		if (!range || range.collapsed) {
			return this.clear();
		}
		return mode === "native"
			? this._applyNative(range)
			: this._applyVirtual(range);
	}
}

// Class: TextSelection
// Represents a range selection in the text editor.
// - cursor: Cursor - the parent cursor instance
// - anchorOffset: number - starting text index of the selection
// - focusOffset: number - ending text index of the selection
// - mode: string - selection mode ("native" or "virtual")
// - overlay: SelectionOverlay - the overlay rendering controller
class TextSelection {
	constructor(cursor, options = {}) {
		this.cursor = cursor;
		this.anchorOffset = null;
		this.focusOffset = null;
		this.mode = options.mode ?? options.selectionMode ?? "virtual";
		this.overlay = new SelectionOverlay(
			document.getElementById(options.hostId ?? "selection"),
		);
	}

	// Property: isActive
	// Indicates if the selection has both active anchor and focus offsets.
	get isActive() {
		return this.anchorOffset !== null && this.focusOffset !== null;
	}

	// Property: isCollapsed
	// Indicates if the selection is collapsed (empty).
	get isCollapsed() {
		return !this.isActive || this.anchorOffset === this.focusOffset;
	}

	// Property: start
	// Gets the minimum offset of the selection.
	get start() {
		if (!this.isActive) {
			return null;
		}
		return Math.min(this.anchorOffset, this.focusOffset);
	}

	// Property: end
	// Gets the maximum offset of the selection.
	get end() {
		if (!this.isActive) {
			return null;
		}
		return Math.max(this.anchorOffset, this.focusOffset);
	}

	// Method: clear
	// Resets the selection and clears visual overlays.
	clear() {
		this.anchorOffset = null;
		this.focusOffset = null;
		return this.overlay.clear();
	}

	// Method: collapseTo
	// Collapses the selection to a specific `offset`.
	collapseTo(offset) {
		this.anchorOffset = offset;
		this.focusOffset = offset;
		return this.overlay.clear();
	}

	// Method: set
	// Sets the selection anchor and focus to specified `anchorOffset` and `focusOffset`.
	set(anchorOffset, focusOffset) {
		this.anchorOffset = this.cursor.text.clampIndex(anchorOffset);
		this.focusOffset = this.cursor.text.clampIndex(focusOffset);
		return this;
	}

	// Method: extendTo
	// Extends the selection focus to the specified `offset`.
	extendTo(offset) {
		const anchor = this.isActive ? this.anchorOffset : this.cursor.offset ?? 0;
		return this.set(anchor, offset);
	}

	// Method: _describeNodeCoverage
	// Evaluates how the specified `node` overlaps with `start` and `end` indices.
	_describeNodeCoverage(node, start, end) {
		const before = this.cursor._boundaryIndexForNode(node, "before");
		const after = this.cursor._boundaryIndexForNode(node, "after");
		return {
			before,
			after,
			intersects: end > before && start < after,
			containsStart: start > before && start < after,
			containsEnd: end > before && end < after,
		};
	}

	// Method: _isInsideContainer
	// Checks if the text position at `index` lies within `node`.
	_isInsideContainer(index, node) {
		const slot = this.cursor.text.positionSlotAt(index);
		const point = slot?.point;
		if (!point?.node || !this.cursor._isWithinNode(node, point.node)) {
			return false;
		}
		if (point.node !== node) {
			return true;
		}
		return point.offset > 0 && point.offset < node.childNodes.length;
	}

	// Method: _allowsInnerSelection
	// Determines if inner selection within container `node` is allowed.
	_allowsInnerSelection(node) {
		if (!this.isActive) {
			return false;
		}
		return (
			this._isInsideContainer(this.anchorOffset, node) &&
			this._isInsideContainer(this.focusOffset, node)
		);
	}

	// Method: _normalizedBounds
	// Computes normalized bounds adjusting for structural elements.
	_normalizedBounds() {
		if (!this.isActive) {
			return { anchor: null, focus: null, start: null, end: null, collapsed: true };
		}
		let start = this.start;
		let end = this.end;
		if (start === end) {
			return {
				anchor: this.anchorOffset,
				focus: this.focusOffset,
				start,
				end,
				collapsed: true,
			};
		}
		const nodes = Array.from(
			this.cursor.editor.root.querySelectorAll(
				".atom, .atomic, .container, .C",
			),
		);
		let changed = true;
		while (changed) {
			changed = false;
			for (const node of nodes) {
				if (this.cursor.text.isAtom(node)) {
					const coverage = this._describeNodeCoverage(node, start, end);
					if (!coverage.intersects) {
						continue;
					}
					const nextStart = Math.min(start, coverage.before);
					const nextEnd = Math.max(end, coverage.after);
					if (nextStart !== start || nextEnd !== end) {
						start = nextStart;
						end = nextEnd;
						changed = true;
					}
					continue;
				}
				if (!this.cursor.text.isContainer(node) || this._allowsInnerSelection(node)) {
					continue;
				}
				const coverage = this._describeNodeCoverage(node, start, end);
				if (!coverage.intersects) {
					continue;
				}
				if (!coverage.containsStart && !coverage.containsEnd) {
					continue;
				}
				const nextStart = Math.min(start, coverage.before);
				const nextEnd = Math.max(end, coverage.after);
				if (nextStart !== start || nextEnd !== end) {
					start = nextStart;
					end = nextEnd;
					changed = true;
				}
			}
		}
		return {
			anchor: this.anchorOffset,
			focus: this.focusOffset,
			start,
			end,
			collapsed: start === end,
		};
	}

	// Method: normalizedRange
	// Retrieves normalized bounds for selection.
	normalizedRange() {
		return this._normalizedBounds();
	}

	// Method: toDomRange
	// Converts a `normalized` range to a native DOM Range.
	toDomRange(normalized = this.normalizedRange()) {
		if (normalized.collapsed || normalized.start === null || normalized.end === null) {
			return null;
		}
		const startPoint = this.cursor.text.pointAt(normalized.start);
		const endPoint = this.cursor.text.pointAt(normalized.end);
		if (!startPoint?.node || !endPoint?.node) {
			return null;
		}
		const range = document.createRange();
		try {
			range.setStart(startPoint.node, startPoint.offset);
			range.setEnd(endPoint.node, endPoint.offset);
			return range;
		} catch (_e) {
			return null;
		}
	}

	// Method: apply
	// Renders the selection range to the DOM.
	apply() {
		const normalized = this.normalizedRange();
		const range = this.toDomRange(normalized);
		const render = this.overlay.apply(range, this.mode);
		return { ...normalized, ...render };
	}

	// Method: replaceWithText
	// Replaces the selection contents with the specified `text`.
	replaceWithText(text = "") {
		const normalized = this.normalizedRange();
		const range = this.toDomRange(normalized);
		if (!range) {
			return null;
		}
		let point = null;
		range.deleteContents();
		if (text.length > 0) {
			const node = document.createTextNode(text);
			range.insertNode(node);
			point = { node, offset: text.length };
		} else {
			point = {
				node: range.startContainer,
				offset: range.startOffset,
			};
		}
		this.cursor.text.invalidatePositions();
		this.cursor.text.ensurePositions();
		const nextIndex = this.cursor.text.indexOfPoint(point);
		this.clear();
		return {
			index:
				nextIndex >= 0
					? nextIndex
					: this.cursor.text.clampIndex(normalized.start ?? this.cursor.offset ?? 0),
		};
	}
}

export { SelectionOverlay, TextSelection };

// EOF