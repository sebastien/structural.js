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
	constructor(config = {}) {
		if (config && (config.nodeType === 1 || config instanceof HTMLElement)) {
			config = { node: config };
		}
		this._config = config || {};
		this.mode = (this._config.mode === "native") ? "native" : "virtual";
		this.node = (this.mode === "virtual" ? (this._config.node ?? null) : null);
		// Ensure provided selection overlay node is mounted under body.
		// Absolute selection rects are positioned using viewport + scroll coords.
		if (this.mode === "virtual" && this.node) {
			const d = this.node.ownerDocument || document;
			const b = d.body || d.documentElement;
			if (b && this.node.parentNode !== b) {
				if (getComputedStyle(this.node).position === "static") {
					this.node.style.position = "absolute";
				}
				if (!this.node.style.left) this.node.style.left = "0px";
				if (!this.node.style.top) this.node.style.top = "0px";
				if (!this.node.style.visibility) this.node.style.visibility = "hidden";
				if (this.node.parentNode) this.node.parentNode.removeChild(this.node);
				b.appendChild(this.node);
			}
		}
		this._className = this._config.className || null;
		this._classes = this._config.classes || null;
		this._style = this._config.style || null;
		this._styles = this._config.styles || null;
		this._managedClasses = new Set();
		this._managedStyleProps = new Set();
		this._destroyed = false;
		if (this.node) {
			this.node.setAttribute("aria-hidden", "true");
			this.node.style.pointerEvents = "none";
			if (getComputedStyle(this.node).position === "static") {
				this.node.style.position = "absolute";
			}
		}
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
		const state = this.focused ? "focus" : "default";
		const cfg = this._resolveStateConfig(state);
		this.node.replaceChildren(
			...rects.map(rect => {
				const block = document.createElement("div");
				block.style.position = "absolute";
				block.style.left = `${rect.left + window.scrollX}px`;
				block.style.top = `${rect.top + window.scrollY}px`;
				block.style.width = `${rect.width}px`;
				block.style.height = `${rect.height}px`;
				block.style.pointerEvents = "none";
				// default fallback only if no style provided
				if (!cfg.direct && !cfg.byKey) {
					block.style.backgroundColor = "rgba(0, 120, 255, 0.22)";
				}
				this._applyBlockVisual(block, cfg);
				return block;
			}),
		);
		this.node.style.visibility = rects.length > 0 ? "visible" : "hidden";
		return { visible: rects.length > 0, mode: "virtual" };
	}

	_resolveStateConfig(state) {
		const direct = (state === "focus" && this._config.focus) ? this._config.focus : null;
		const byKey = (state === "focus" && this._styles && this._styles.focus) ? this._styles.focus
			: (state === "default" && this._styles && this._styles.default) ? this._styles.default
			: null;
		const legacyStyle = (state === "focus" && this._style && typeof this._style === "object") ? this._style : null;
		return { classes: this._classes || null, direct: direct || legacyStyle || null, byKey: byKey || null };
	}

	_applyBlockVisual(block, stateCfg) {
		if (!block) return;
		const toAdd = new Set();
		const add = (v) => {
			if (!v) return;
			const values = Array.isArray(v) ? v : String(v).split(/\s+/);
			for (const x of values) {
				if (x) toAdd.add(String(x));
			}
		};
		add(this._className);
		if (stateCfg?.classes) {
			add(stateCfg.classes["selected"] || stateCfg.classes[state] || stateCfg.classes.default || null);
		}
		for (const c of this._managedClasses) {
			if (!toAdd.has(c)) block.classList.remove(c);
		}
		for (const c of toAdd) {
			if (!block.classList.contains(c)) block.classList.add(c);
		}
		this._managedClasses = toAdd;

		const next = {};
		const merge = (obj) => { if (obj && typeof obj === "object") Object.assign(next, obj); };
		merge(stateCfg?.byKey || null);
		merge(stateCfg?.direct || null);
		for (const p of this._managedStyleProps) {
			if (!(p in next)) block.style.removeProperty(p.replace(/[A-Z]/g, m => "-" + m.toLowerCase()));
		}
		const applied = new Set();
		for (const [k, v] of Object.entries(next)) {
			const css = k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
			block.style.setProperty(css, String(v));
			applied.add(k);
		}
		this._managedStyleProps = applied;
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

	destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		this._clearNative();
		this._clearVirtual();
		if (this.node) {
			for (const c of this._managedClasses) this.node.classList.remove(c);
			for (const p of this._managedStyleProps) {
				this.node.style.removeProperty(p.replace(/[A-Z]/g, m => "-" + m.toLowerCase()));
			}
			this.node.style.visibility = "hidden";
		}
		this._managedClasses.clear();
		this._managedStyleProps.clear();
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
		let selCfg = options;
		if (options && (options.selection || options.selectionConfig)) {
			selCfg = options.selection || options.selectionConfig || options;
		}
		if (typeof selCfg === "string") selCfg = { mode: selCfg };
		this.mode = (selCfg && selCfg.mode) || selCfg?.selectionMode || "virtual";
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
		this._anchorPoint = ap && ap.node ? { node: ap.node, offset: ap.offset } : null;
		this._focusPoint = fp && fp.node ? { node: fp.node, offset: fp.offset } : null;
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
	// Prefers exact DOM points captured at selection time (robust to windowed/stale numeric offsets).
	toDomRange(normalized = this.normalizedRange()) {
		// Prefer stored points if we have them and they are still valid/connected.
		const ap = this._anchorPoint;
		const fp = this._focusPoint;
		if (this.isActive && ap && fp && ap.node && fp.node && ap.node.isConnected && fp.node.isConnected && ap.node.ownerDocument === fp.node.ownerDocument) {
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
				const ns = window.getSelection && window.getSelection();
				if (ns && ns.rangeCount > 0) {
					const nr = ns.getRangeAt(0);
					const ed = this.cursor && this.cursor.editor;
					const root = ed && ed.root;
					if (root && ed.range && ed.range.within(root, nr) && !nr.collapsed) {
						domRange = nr.cloneRange();
					}
				}
			} catch (_) {}
		}
		if (!domRange) {
			return null;
		}
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
		this.cursor.text.invalidatePositions();
		// Ensure we can resolve the point after mutation (window may need expand)
		this.cursor.text.ensurePositions();
		const nextIndex = point ? this.cursor.text.indexOfPoint(point) : -1;
		this.clear();
		// Aggressively clear any lingering native selection so the caret doesn't appear stuck on the old range.
		try {
			const ns = (typeof window !== "undefined" && window.getSelection) ? window.getSelection() : null;
			if (ns && ns.removeAllRanges) ns.removeAllRanges();
		} catch (_) {}
		const fb = this.cursor.text.clampIndex((this.cursor && this.cursor.offset) || 0);
		return {
			index: nextIndex >= 0 ? nextIndex : fb,
		};
	}
}

// Class: EditorSelectionController
// Synchronizes native browser selection and the editor's structural cursor state.
class EditorSelectionController {
	constructor(editor) {
		this.editor = editor;
	}

	// Method: _syncSessionBlock
	// Updates session block bookkeeping from the active cursor anchor.
	_syncSessionBlock(active) {
		active.currentBlock = this.editor.blockFor?.(active.cursor.anchor) ?? active.currentBlock;
		if (active === this.editor.localSession) this.editor._currentBlock = active.currentBlock;
	}

	// Method: _pointWithin
	// Checks if `node` lies within subtree `root`.
	_pointWithin(root, node) {
		if (!root || !node) return false;
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		return !!element && (element === root || root.contains(element));
	}

	// Method: _nativeCaretPointFromClientPoint
	// Resolves a native DOM point from viewport coordinates when available.
	_nativeCaretPointFromClientPoint(x, y) {
		const position = document.caretPositionFromPoint?.(x, y);
		if (position?.offsetNode) {
			return { node: position.offsetNode, offset: position.offset };
		}
		const range = document.caretRangeFromPoint?.(x, y);
		if (range?.startContainer) {
			return { node: range.startContainer, offset: range.startOffset };
		}
		return null;
	}

	// Method: _edgePlacement
	// Resolves whether a point should snap to the subtree start or end.
	_edgePlacement(root, x) {
		const rect = root.getBoundingClientRect();
		return x > rect.left + rect.width / 2 ? "end" : "start";
	}

	// Method: _firstTextNode
	// Resolves the first descendant text node within `root`.
	_firstTextNode(root) {
		if (!root) return null;
		if (root.nodeType === Node.TEXT_NODE) return root;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		return walker.nextNode();
	}

	// Method: _lastTextNode
	// Resolves the last descendant text node within `root`.
	_lastTextNode(root) {
		if (!root) return null;
		if (root.nodeType === Node.TEXT_NODE) return root;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let text = null;
		while (walker.nextNode()) text = walker.currentNode;
		return text;
	}

	// Method: _setEdgeCaret
	// Places the caret at the subtree start or end when block helpers are unavailable.
	_setEdgeCaret(root, placement, session = null) {
		const textNode = placement === "end" ? this._lastTextNode(root) : this._firstTextNode(root);
		if (textNode) {
			return this.setCaret(textNode, placement === "end" ? textNode.data.length : 0, session);
		}
		if (root.nodeType !== Node.ELEMENT_NODE) return false;
		return this.setCaret(root, placement === "end" ? root.childNodes.length : 0, session);
	}

	// Method: setCaret
	// Moves the active caret to the specified DOM `node` and `offset`.
	setCaret(node, offset, session = null) {
		const active = this.editor.activeSession(session);
		this.editor.text.refresh();
		// Ensure index resolution can expand window for the provided node/offset
		const index = this.editor.text.indexOfPoint({ node, offset });
		if (index < 0) {
			return false;
		}
		active.cursor.moveTo(index);
		this._syncSessionBlock(active);
		return this.syncToNative(active);
	}

	// Method: previewCaretAtIndex
	// Moves only the virtual caret for hover/drag previews without syncing native selection.
	previewCaretAtIndex(index, session = null, options = {}) {
		const active = this.editor.activeSession(session);
		this.editor.text.ensureIndex(index);
		const move = active.cursor._resolveMoveOffset(index, options);
		if (!move) return false;
		active.cursor._clearNodeSelection();
		active.cursor.selection.clear();
		active.cursor.selectionKind = "caret";
		active.cursor.offset = move.clamped;
		active.cursor.anchor = move.position.focusNode;
		active.cursor.delta = move.position.point.offset;
		active.cursor.direction = move.direction;
		active.cursor.caret.setVirtual(move.position, { editable: options.editable !== false });
		this._syncSessionBlock(active);
		return move.clamped;
	}

	// Method: previewCaretFromPoint
	// Places only the virtual caret from viewport coordinates using cached text positions.
	previewCaretFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return false;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			this.editor.text.ensurePositions();
			const index = this.editor.text.indexOfPoint(nativePoint);
			return index >= 0 ? this.previewCaretAtIndex(index, session, options) : false;
		}
		const active = this.editor.activeSession(session);
		const offset = active.cursor.offsetFromPointIn(root, x, y);
		return offset !== null ? this.previewCaretAtIndex(offset, active, options) : false;
	}

	// Method: select
	// Applies a structural text selection from `start` to `end`.
	select(start, end, session = null) {
		const active = this.editor.activeSession(session);
		active.cursor.select(start, end);
		this._syncSessionBlock(active);
		return true;
	}

	// Method: placeCaretFromPoint
	// Places the caret within subtree `root` using viewport coordinates `x` and `y`.
	placeCaretFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return false;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			return this.setCaret(nativePoint.node, nativePoint.offset, session);
		}

		const active = this.editor.activeSession(session);
		const offset = active.cursor.offsetFromPointIn(root, x, y);
		if (offset !== null) {
			active.cursor._desiredX = null;
			active.cursor.moveTo(offset);
			this._syncSessionBlock(active);
			return this.syncToNative(active);
		}

		if (options.fallback === "none") {
			return false;
		}

		const placement = this._edgePlacement(root, x);
		return placement === "end"
			? (this.editor.moveCursorToBlockEnd?.(root, active) ?? this._setEdgeCaret(root, "end", active))
			: (this.editor.moveCursorToBlockStart?.(root, active) ?? this._setEdgeCaret(root, "start", active));
	}

	// Method: syncToNative
	// Syncs the active structural caret or range to the browser selection.
	syncToNative(session = null) {
		const active = this.editor.activeSession(session);
		if (active.nativeSelection === "none") return true;
		try {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			if (active.cursor.selectionKind === "range") {
				const range = active.cursor.selection.toDomRange();
				if (!range) return false;
				selection?.addRange(range);
				return true;
			}
			const point = this.editor.text.pointAt(active.cursor.offset ?? 0);
			if (!point?.node?.isConnected) return false;
			const range = document.createRange();
			range.setStart(point.node, point.offset);
			range.collapse(true);
			selection?.addRange(range);
			return true;
		} catch (_e) {
			return false;
		}
	}

	// Method: syncFromNative
	// Maps the browser selection back into the active structural cursor state.
	syncFromNative(root = this.editor.root, session = null) {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return false;
		const range = selection.getRangeAt(0);
		if (!this.editor.range.within(root, range)) return false;
		const start = this.editor.text.indexOfPoint({
			node: range.startContainer,
			offset: range.startOffset,
		});
		const end = this.editor.text.indexOfPoint({
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0 || end < 0) return false;

		const active = this.editor.activeSession(session);
		if (range.collapsed || start === end) {
			active.cursor.moveTo(end);
		} else {
			active.cursor.select(start, end);
		}
		this._syncSessionBlock(active);
		active.classes?.update();
		return true;
	}
}

export { EditorSelectionController, SelectionOverlay, TextSelection };

// EOF
