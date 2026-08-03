// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: text-selection
// Represents and renders a range selection in the text editor.

import { LEGACY_STRUCTURAL_SELECTOR } from "../compat.js";
import SelectionOverlay from "../rendering/selection-overlay.js";

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
		let selCfg = options;
		if (options && (options.selection || options.selectionConfig)) {
			selCfg = options.selection || options.selectionConfig || options;
		}
		if (typeof selCfg === "string") selCfg = { mode: selCfg };
		this.mode = (selCfg?.mode) || selCfg?.selectionMode || "virtual";
		// normalize shorthand
		const overlayCfg = (typeof selCfg === "object" && selCfg) ? { ...selCfg, mode: this.mode } : { mode: this.mode };
		// legacy hostId support
		if (!overlayCfg.node && selCfg?.hostId) {
			overlayCfg.node = document.getElementById(selCfg.hostId);
		}
		if (!overlayCfg.node && !selCfg?.node) {
			// legacy default id only if not explicitly given a node
			const legacy = document.getElementById("selection");
			if (legacy) overlayCfg.node = legacy;
		}
		this.overlay = new SelectionOverlay(overlayCfg);
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
		this._anchorPoint = null;
		this._focusPoint = null;
		return this.overlay.clear();
	}

	// Method: collapseTo
	// Collapses the selection to a specific `offset`.
	collapseTo(offset) {
		const c = this.cursor.text.clampIndex(offset);
		this.anchorOffset = c;
		this.focusOffset = c;
		this._anchorPoint = this.cursor.text.pointAt(c);
		this._focusPoint = this._anchorPoint;
		return this.overlay.clear();
	}

	// Method: set
	// Sets the selection anchor and focus to specified `anchorOffset` and `focusOffset`.
	set(anchorOffset, focusOffset) {
		const ca = this.cursor.text.clampIndex(anchorOffset);
		const cf = this.cursor.text.clampIndex(focusOffset);
		this.anchorOffset = ca;
		this.focusOffset = cf;
		const ap = this.cursor.text.pointAt(ca);
		const fp = this.cursor.text.pointAt(cf);
		this._anchorPoint = ap?.node ? { node: ap.node, offset: ap.offset } : null;
		this._focusPoint = fp?.node ? { node: fp.node, offset: fp.offset } : null;
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
			this.cursor.editor.root.querySelectorAll(LEGACY_STRUCTURAL_SELECTOR),
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
	// Prefers exact DOM points when they still represent the normalized bounds.
	toDomRange(normalized = this.normalizedRange()) {
		// Prefer stored points if we have them and they are still valid/connected.
		const ap = this._anchorPoint;
		const fp = this._focusPoint;
		const matchesNormalized =
			this.isActive &&
			normalized.start === this.start &&
			normalized.end === this.end;
		if (matchesNormalized && ap && fp && ap.node && fp.node && ap.node.isConnected && fp.node.isConnected && ap.node.ownerDocument === fp.node.ownerDocument) {
			try {
				const r = document.createRange();
				// Order by document position
				const cmp = ap.node.compareDocumentPosition(fp.node);
				const apFirst = (cmp & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ||
					(cmp === 0 && ap.offset <= fp.offset);
				if (apFirst) {
					r.setStart(ap.node, ap.offset);
					r.setEnd(fp.node, fp.offset);
				} else {
					r.setStart(fp.node, fp.offset);
					r.setEnd(ap.node, ap.offset);
				}
				return r;
			} catch (_) {
				// fall through to numeric
			}
		}
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
	// This is the key path for "type/delete over selection" to override/replace.
	replaceWithText(text = "") {
		let domRange = this.toDomRange();
		if (!domRange) {
			// Robust fallback: if browser still has a live non-collapsed selection
			// inside the editor, use it directly so replace always overrides.
			try {
			const ns = window.getSelection?.();
				if (ns && ns.rangeCount > 0) {
					const nr = ns.getRangeAt(0);
					const ed = this.cursor?.editor;
					const root = ed?.root;
					if (root && ed.range?.within(root, nr) && !nr.collapsed) {
						domRange = nr.cloneRange();
					}
				}
			} catch (_) {}
		}
		if (!domRange) {
			return null;
		}
		const adapter = this.cursor.text;
		adapter._beginEdit();
		try {
			let point = null;
			domRange.deleteContents();
			if (text.length > 0) {
				const node = document.createTextNode(text);
				domRange.insertNode(node);
				point = { node, offset: text.length };
			} else {
				point = {
					node: domRange.startContainer,
					offset: domRange.startOffset,
				};
			}
			adapter.invalidatePositions();
			// Ensure we can resolve the point after mutation (window may need expand)
			adapter.ensurePositions();
			const nextIndex = point ? adapter.indexOfPoint(point) : -1;
			this.clear();
			// Aggressively clear any lingering native selection so the caret doesn't appear stuck on the old range.
			try {
				const ns = (typeof window !== "undefined" && window.getSelection) ? window.getSelection() : null;
			if (ns?.removeAllRanges) ns.removeAllRanges();
			} catch (_) {}
		const fb = adapter.clampIndex((this.cursor?.offset) || 0);
			return {
				index: nextIndex >= 0 ? nextIndex : fb,
			};
		} finally {
			adapter._endEdit();
		}
	}
}

export { TextSelection };
export default TextSelection;

// EOF
