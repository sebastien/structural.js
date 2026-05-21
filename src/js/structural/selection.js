class SelectionOverlay {
	constructor(node) {
		this.node = node ?? null;
	}

	_clearVirtual() {
		if (!this.node) {
			return;
		}
		this.node.replaceChildren();
		this.node.style.visibility = "hidden";
	}

	_clearNative() {
		window.getSelection()?.removeAllRanges();
	}

	clear() {
		this._clearNative();
		this._clearVirtual();
		return { visible: false, mode: null };
	}

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

	apply(range, mode) {
		if (!range || range.collapsed) {
			return this.clear();
		}
		return mode === "native"
			? this._applyNative(range)
			: this._applyVirtual(range);
	}
}

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

	get isActive() {
		return this.anchorOffset !== null && this.focusOffset !== null;
	}

	get isCollapsed() {
		return !this.isActive || this.anchorOffset === this.focusOffset;
	}

	get start() {
		if (!this.isActive) {
			return null;
		}
		return Math.min(this.anchorOffset, this.focusOffset);
	}

	get end() {
		if (!this.isActive) {
			return null;
		}
		return Math.max(this.anchorOffset, this.focusOffset);
	}

	clear() {
		this.anchorOffset = null;
		this.focusOffset = null;
		return this.overlay.clear();
	}

	collapseTo(offset) {
		this.anchorOffset = offset;
		this.focusOffset = offset;
		return this.overlay.clear();
	}

	set(anchorOffset, focusOffset) {
		this.anchorOffset = this.cursor.text.clampIndex(anchorOffset);
		this.focusOffset = this.cursor.text.clampIndex(focusOffset);
		return this;
	}

	extendTo(offset) {
		const anchor = this.isActive ? this.anchorOffset : this.cursor.offset ?? 0;
		return this.set(anchor, offset);
	}

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

	_allowsInnerSelection(node) {
		if (!this.isActive) {
			return false;
		}
		return (
			this._isInsideContainer(this.anchorOffset, node) &&
			this._isInsideContainer(this.focusOffset, node)
		);
	}

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

	normalizedRange() {
		return this._normalizedBounds();
	}

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
		} catch (e) {
			return null;
		}
	}

	apply() {
		const normalized = this.normalizedRange();
		const range = this.toDomRange(normalized);
		const render = this.overlay.apply(range, this.mode);
		return { ...normalized, ...render };
	}

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
