// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: text
// Wraps a DOM tree and schema, supporting key text and structural operations.

import { blockSelectorFromSchema } from "./dom.js";
import { isLegacyAtom, isLegacyContainer, isLegacySkipped } from "./compat.js";

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
		this._acceptsText = typeof options.acceptsText === "function" ? options.acceptsText : null;
		this.skipFormattingWhitespaceConfigured = Object.hasOwn(options, "skipFormattingWhitespace");
		this.skipFormattingWhitespace = options.skipFormattingWhitespace ?? false;
		this._positions = [];
		this._positionsDirty = true;
		this._observer = null;
		this._segmenter =
			typeof Intl !== "undefined" && Intl.Segmenter
				? new Intl.Segmenter(undefined, { granularity: "grapheme" })
				: null;
		this._onMutations = this.onMutations.bind(this);
		// Instrumentation
		this._rebuildCount = 0;
		this._ensureCount = 0;
		this._bcrCount = 0;
		this._lastBuildMs = 0;
		// Window / cache configuration (decisions: window length OK, eager N blocks, 100MB cap, faster linear)
		this.eagerBlockCount = options.eagerBlockCount ?? 8;
		this.maxCacheBytes = options.maxCacheBytes ?? 100 * 1024 * 1024;
		this._windowGen = 0;
		// Block window state (hierarchical)
		this._blockIndex = new Map(); // blockEl -> {start, end, length}
		this._blockOrder = []; // top-to-bottom block elements in current window
		this._prefixLengths = []; // parallel to _positions, prefix grapheme length up to slot i (for fast textOffsetAtIndex)
		// Scheduling
		this._rebuildScheduled = false;
		this._rebuildRafId = 0;
		this._idleScheduled = false;
		// Programmatic edits rebuild explicitly; skip MutationObserver double-work.
		this._editDepth = 0;
		// Caches for hot paths
		this._graphemeCache = new WeakMap();
		this._visualCache = new Map(); // index -> rect (cleared on dirty)
	}

	_graphemeBoundaries(text = "", node = null) {
		// Cache is keyed by text node identity. splitText/extractContents keep the
		// same node object while changing node.data — reject stale entries whose
		// last boundary no longer matches the current text length.
		if (node && this._graphemeCache?.has(node)) {
			const cached = this._graphemeCache.get(node);
			if (cached[cached.length - 1] === text.length) {
				return cached;
			}
			this._graphemeCache.delete(node);
		}
		const boundaries = [0];
		if (!text) {
			if (node) this._graphemeCache?.set(node, boundaries);
			return boundaries;
		}
		if (this._segmenter) {
			for (const { index, segment } of this._segmenter.segment(text)) {
				const next = index + segment.length;
				if (next !== boundaries[boundaries.length - 1]) boundaries.push(next);
			}
			if (node) this._graphemeCache?.set(node, boundaries);
			return boundaries;
		}
		let offset = 0;
		for (const char of Array.from(text)) {
			offset += char.length;
			boundaries.push(offset);
		}
		if (node) this._graphemeCache?.set(node, boundaries);
		return boundaries;
	}

	_graphemeCount(text = "", node = null) {
		return Math.max(0, this._graphemeBoundaries(text, node).length - 1);
	}

	_codeUnitOffsetAtGrapheme(text = "", graphemeIndex = 0, node = null) {
		const boundaries = this._graphemeBoundaries(text, node);
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

	_graphemeBoundaryIndex(node, offset) {
		if (!node || node.nodeType !== Node.TEXT_NODE) return -1;
		const boundaries = this._graphemeBoundaries(node.data, node);
		let low = 0;
		let high = boundaries.length - 1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const value = boundaries[middle];
			if (value === offset) return middle;
			if (value < offset) low = middle + 1;
			else high = middle - 1;
		}
		return -1;
	}

	_graphemeDistance(node, fromOffset, toOffset) {
		if (!node || node.nodeType !== Node.TEXT_NODE || fromOffset === toOffset) {
			return 0;
		}
		const from = this._graphemeBoundaryIndex(node, fromOffset);
		const to = this._graphemeBoundaryIndex(node, toOffset);
		return from >= 0 && to >= 0 ? Math.abs(to - from) : 0;
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
			for (const m of mutations) {
				if (m.type === "characterData" && m.target?.nodeType === Node.TEXT_NODE) {
					this._graphemeCache?.delete(m.target);
				}
			}
		}
		// insertAtIndex/delete* already refresh; ignore nested observer noise.
		if (this._editDepth > 0) return;
		if (mutations?.length) {
			this.invalidatePositions();
			this._scheduleRebuild();
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
		return isLegacySkipped(node);
	}

	// Method: isContainer
	// Checks if the given `node` is marked as a structural container.
	isContainer(node) {
		return isLegacyContainer(node);
	}

	/* Method: isAtom
	 * Returns true if node is marked atom via class or schema. */
	isAtom(node) {
		if (!node) return false;
		if (isLegacyAtom(node)) return true;
		const schema = this._schema || this.root?._editorSchema || null;
		if (schema && typeof schema.isAtom === "function") {
			return schema.isAtom(node);
		}
		return false;
	}

	// Method: isWhitespacePreserved
	// Checks if the given `node` or its parent preserves whitespace (e.g. pre or code).
	isWhitespacePreserved(node) {
		const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
		if (!element) {
			return false;
		}
		if (element.closest("pre, code")) {
			return true;
		}
		const whiteSpace = window.getComputedStyle(element).whiteSpace;
		return whiteSpace === "pre" || whiteSpace === "pre-wrap" || whiteSpace === "break-spaces";
	}

	// ----------------------------------------------------------------------------
	//
	// WINDOWING HELPERS (lazy hierarchical block window)
	//
	// ----------------------------------------------------------------------------

	_getBlockSelector() {
		return blockSelectorFromSchema(this._schema);
	}

	_getTopLevelBlocks() {
		const selector = this._getBlockSelector();
		const all = Array.from(this.root.querySelectorAll(selector));
		const candidates = all.filter((b) => b?.isConnected && this.root.contains(b));
		// Return only root-most blocks (not contained inside another selected block)
		// This prevents duplicate slots when walking overlapping nested blocks (ul/li/p etc.)
		const set = new Set(candidates);
		return candidates.filter((b) => {
			let p = b.parentElement;
			while (p && p !== this.root) {
				if (set.has(p)) return false;
				p = p.parentElement;
			}
			return true;
		});
	}

	_collectPositionSlotsFor(blockRoot, baseIndex = 0) {
		const slots = [];
		const seen = new Set();
		const push = (point, focusNode, graphemeIndex = null) => {
			if (!point?.node) return;
			const key = `${nodeKey(point.node)}:${point.offset}`;
			if (seen.has(key)) return;
			seen.add(key);
			const resolvedFocusNode = focusNode ?? point.node;
			const kind = point.node.nodeType === Node.TEXT_NODE ? "text-point" : "element-boundary";
			const boundary = this._boundaryAtPoint(point);
			const char = this._charAroundPoint(point, boundary, graphemeIndex);
			slots.push({ point, focusNode: resolvedFocusNode, kind, boundary, char, graphemeIndex });
		};
		for (const p of this.iwalk(blockRoot, { mode: "positions" })) {
			push(p.point, p.focusNode, p.graphemeIndex);
		}
		return slots.map((slot, i) => ({ ...slot, index: baseIndex + i }));
	}

	// Collect position slots only for one text node (used for incremental refresh).
	_collectSlotsForTextNode(textNode, baseIndex = 0) {
		const slots = [];
		if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return slots;
		const seen = new Set();
		for (const p of this.iwalk(textNode, { mode: "positions" })) {
			const pt = p?.point;
			if (!pt?.node) continue;
			const key = `${nodeKey(pt.node)}:${pt.offset}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const boundary = this._boundaryAtPoint(pt);
			const char = this._charAroundPoint(pt, boundary, p.graphemeIndex);
			slots.push({
				point: pt,
				focusNode: p.focusNode || textNode.parentNode || textNode,
				kind: "text-point",
				boundary,
				char,
				graphemeIndex: p.graphemeIndex,
				index: baseIndex + slots.length,
			});
		}
		return slots;
	}

	_textLengthBefore(node) {
		if (!node || node === this.root) return 0;
		try {
			const r = document.createRange();
			r.setStart(this.root, 0);
			r.setEnd(node, 0);
			return this._graphemeCount(r.toString());
		} catch {
			return 0;
		}
	}

	_rebuildPrefixTextOffsets() {
		const n = this._positions.length;
		this._prefixTextOffsets = new Array(n);
		if (n === 0) return;
		let running = this._textLengthBefore(this._blockOrder[0] || this.root);
		this._prefixTextOffsets[0] = running;
		for (let i = 1; i < n; i++) {
			const previous = this._positions[i - 1];
			const current = this._positions[i];
			const p0 = previous.point;
			const p1 = current.point;
			let delta = 0;
			if (p0 && p1 && p0.node === p1.node && p0.node && p0.node.nodeType === Node.TEXT_NODE) {
				delta =
					Number.isInteger(previous.graphemeIndex) && Number.isInteger(current.graphemeIndex)
						? Math.abs(current.graphemeIndex - previous.graphemeIndex)
						: this._graphemeDistance(p0.node, p0.offset, p1.offset);
			}
			running += delta;
			this._prefixTextOffsets[i] = running;
		}
	}

	_rebuildPrefixTextOffsetsForAppended(startIndex) {
		if (!this._prefixTextOffsets) this._prefixTextOffsets = [];
		const n = this._positions.length;
		if (startIndex >= n) return;
		let running =
			startIndex > 0
				? this._prefixTextOffsets[startIndex - 1] || 0
				: this._textLengthBefore(this._blockOrder[0] || this.root);
		for (let i = startIndex; i < n; i++) {
			if (i > startIndex) {
				const previous = this._positions[i - 1];
				const current = this._positions[i];
				const p0 = previous.point;
				const p1 = current.point;
				let delta = 0;
				if (p0 && p1 && p0.node === p1.node && p0.node?.nodeType === Node.TEXT_NODE) {
					delta =
						Number.isInteger(previous.graphemeIndex) && Number.isInteger(current.graphemeIndex)
							? Math.abs(current.graphemeIndex - previous.graphemeIndex)
							: this._graphemeDistance(p0.node, p0.offset, p1.offset);
				}
				running += delta;
			}
			this._prefixTextOffsets[i] = running;
		}
	}

	_ensureBlockForPoint(point) {
		if (!point?.node) return false;
		const block = this._blockForPoint(point);
		if (!block || this._blockIndex.has(block)) return false;
		const blocks = this._getTopLevelBlocks();
		const blockIndex = blocks.indexOf(block);
		const insertionIndex = this._blockOrder.findIndex((current) =>
			blocks.indexOf(current) > blockIndex,
		);
		// Appending is safe only when this block follows every loaded block. Rebuild
		// the full window otherwise, preserving document-order position indexes.
		if (insertionIndex >= 0) {
			const eagerBlockCount = this.eagerBlockCount;
			this.eagerBlockCount = blocks.length;
			try {
				this.rebuildPositions();
			} finally {
				this.eagerBlockCount = eagerBlockCount;
			}
			return this._blockIndex.has(block);
		}
		const start = this._positions.length;
		const news = this._collectPositionSlotsFor(block, start);
		this._positions.push(...news);
		this._blockIndex.set(block, { start, end: this._positions.length, length: news.length });
		this._blockOrder.push(block);
		this._rebuildPrefixTextOffsetsForAppended(start);
		this._windowGen += 1;
		this._enforceMemoryCap();
		return true;
	}

	_blockForPoint(point) {
		if (!point?.node) return null;
		const selector = this._getBlockSelector();
		const el = point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentElement;
		let block = el ? el.closest(selector) : null;
		if (!block || !this.root.contains(block)) {
			block = el;
			while (block?.parentElement && block.parentElement !== this.root) {
				block = block.parentElement;
			}
		}
		return block && this.root.contains(block) ? block : null;
	}

	_beginEdit() {
		this._editDepth = (this._editDepth | 0) + 1;
	}

	_endEdit() {
		// MutationObserver delivery occurs at the microtask checkpoint after a
		// synchronous DOM edit. Keep the transaction active through that delivery
		// so the observer does not invalidate the incremental refresh we just did.
		const release = () => {
			this._editDepth = Math.max(0, (this._editDepth | 0) - 1);
		};
		if (typeof queueMicrotask === "function") {
			queueMicrotask(release);
		} else {
			Promise.resolve().then(release);
		}
	}

	// Rebuilds slots for a single known block and renumbers the rest of the window.
	_refreshBlock(block) {
		const info = block ? this._blockIndex.get(block) : null;
		if (!info) {
			this.invalidatePositions();
			return this.ensurePositions();
		}
		const news = this._collectPositionSlotsFor(block, info.start);
		const oldLen = info.length;
		const newLen = news.length;
		this._positions.splice(info.start, oldLen, ...news);
		info.end = info.start + newLen;
		info.length = newLen;
		const delta = newLen - oldLen;
		if (delta !== 0) {
			let seen = false;
			for (const b of this._blockOrder) {
				if (b === block) {
					seen = true;
					continue;
				}
				if (!seen) continue;
				const bi = this._blockIndex.get(b);
				if (!bi) continue;
				bi.start += delta;
				bi.end += delta;
			}
		}
		for (let i = info.start; i < this._positions.length; i++) {
			this._positions[i].index = i;
		}
		this._rebuildPrefixTextOffsets();
		this._positionsDirty = false;
		this._windowGen += 1;
		this._enforceMemoryCap();
		return this._positions;
	}

	// After a local text edit, refresh only the affected block when possible.
	_refreshAfterPointEdit(point) {
		if (point?.node?.nodeType === Node.TEXT_NODE) {
			return this._refreshTextNode(point.node);
		}
		const block = this._blockForPoint(point);
		if (block && this._blockIndex.has(block)) {
			return this._refreshBlock(block);
		}
		this.invalidatePositions();
		return this.ensurePositions();
	}

	// Refresh slots for a single text node by splicing only its range (big win for long paras).
	_refreshTextNode(textNode) {
		if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
			this.invalidatePositions();
			return this.ensurePositions();
		}
		// locate current slot range for this exact node (contiguous)
		let start = -1,
			end = -1;
		for (let k = 0; k < this._positions.length; k++) {
			if (this._positions[k]?.point?.node === textNode) {
				if (start < 0) start = k;
				end = k;
			} else if (start >= 0) {
				break;
			}
		}
		if (start < 0) {
			this.invalidatePositions();
			return this.ensurePositions();
		}
		const oldLen = end - start + 1;
		const news = this._collectSlotsForTextNode(textNode, start);
		const newLen = news.length;
		this._positions.splice(start, oldLen, ...news);
		for (let k = start; k < this._positions.length; k++) {
			this._positions[k].index = k;
		}
		const delta = newLen - oldLen;
		// adjust later blocks
		if (delta !== 0) {
			const _seen = false;
			for (const b of this._blockOrder) {
				const info = this._blockIndex.get(b);
				if (!info) continue;
				if (info.start > end) {
					info.start += delta;
					info.end += delta;
				}
			}
		}
		this._rebuildPrefixTextOffsets();
		this._positionsDirty = false;
		this._windowGen += 1;
		this._enforceMemoryCap();
		return this._positions;
	}

	_expandWindowToCoverIndex(targetIndex) {
		const blocks = this._getTopLevelBlocks();
		const have = new Set(this._blockOrder);
		for (const b of blocks) {
			if (have.has(b)) continue;
			const start = this._positions.length;
			const news = this._collectPositionSlotsFor(b, start);
			this._positions.push(...news);
			this._blockIndex.set(b, { start, end: this._positions.length, length: news.length });
			this._blockOrder.push(b);
			this._rebuildPrefixTextOffsetsForAppended(start);
			if (this._positions.length > targetIndex) break;
		}
		this._windowGen += 1;
		this._enforceMemoryCap();
		return this._positions;
	}

	_enforceMemoryCap() {
		if (!this.maxCacheBytes || this.maxCacheBytes <= 0) return;
		// Very rough estimate; tune perSlot based on observed
		const perSlot = 256;
		let safety = 0;
		while (
			this._positions.length > 0 &&
			this._positions.length * perSlot > this.maxCacheBytes &&
			safety < 10000
		) {
			if (!this._blockOrder.length) break;
			// drop tail block only
			const last = this._blockOrder[this._blockOrder.length - 1];
			const info = this._blockIndex.get(last);
			if (!info) {
				this._blockOrder.pop();
				continue;
			}
			const keep = info.start;
			this._positions.length = keep;
			if (this._prefixTextOffsets) this._prefixTextOffsets.length = keep;
			this._blockIndex.delete(last);
			this._blockOrder.pop();
			safety++;
		}
		if (safety > 0) this._windowGen += 1;
	}

	// ----------------------------------------------------------------------------
	//
	// POSITIONS
	//
	// ----------------------------------------------------------------------------

	// Method: rebuildPositions
	// Rebuilds the flat list of caret position slots using windowed eager strategy.
	rebuildPositions() {
		const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
		// Build initial window: eagerly load up to eagerBlockCount blocks from top
		this._positions = [];
		this._blockIndex = new Map();
		this._blockOrder = [];
		this._prefixTextOffsets = [];
		const blocks = this._getTopLevelBlocks();
		const limit = Math.max(1, this.eagerBlockCount | 0);
		let base = 0;
		for (let i = 0; i < blocks.length && i < limit; i++) {
			const b = blocks[i];
			const news = this._collectPositionSlotsFor(b, base);
			this._positions.push(...news);
			this._blockIndex.set(b, { start: base, end: base + news.length, length: news.length });
			this._blockOrder.push(b);
			base += news.length;
		}
		// If no blocks matched (edge), fall back to full root walk for current window
		if (this._positions.length === 0) {
			this._positions = this._buildPositions(this.root);
		}
		this._rebuildPrefixTextOffsets();
		this._positionsDirty = false;
		this._rebuildCount += 1;
		if (t0) this._lastBuildMs = performance.now() - t0;
		this._windowGen += 1;
		this._enforceMemoryCap();
		return this._positions;
	}

	// Method: invalidatePositions
	// Marks the current cached position slots as dirty/invalid.
	invalidatePositions() {
		this._positionsDirty = true;
		if (this._visualCache) this._visualCache.clear();
	}

	// Method: ensurePositions
	// Ensures that the positions array is built and up-to-date.
	ensurePositions() {
		this._ensureCount += 1;
		if (this._positionsDirty) {
			this.rebuildPositions();
		}
		return this._positions;
	}

	// Method: ensureIndex
	// Ensures the window covers at least up to `index` (expands eagerly if needed).
	ensureIndex(index) {
		this.ensurePositions();
		const want = Math.max(0, Number.isFinite(index) ? index | 0 : 0);
		if (want < this._positions.length) return this._positions;
		this._expandWindowToCoverIndex(want);
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

	// Method: _scheduleRebuild
	// Coalesces invalidations and rebuilds on next rAF.
	_scheduleRebuild() {
		if (this._rebuildScheduled) return;
		this._rebuildScheduled = true;
		const rebuild = () => {
			this._rebuildScheduled = false;
			this._rebuildRafId = 0;
			if (this._positionsDirty) this.rebuildPositions();
		};
		this._rebuildRafId =
			typeof requestAnimationFrame === "function"
				? requestAnimationFrame(rebuild)
				: setTimeout(rebuild, 0);
	}

	// Method: _rebuildWindowStats
	// Updates lightweight stats after a rebuild.
	_rebuildWindowStats() {
		// positionsLength and window info are derived on demand via getters below
	}

	// Method: _scheduleIdleExpand
	// Schedules a best-effort expansion of the window using idle time (rIC or timeout).
	_scheduleIdleExpand() {
		if (this._idleScheduled) return;
		this._idleScheduled = true;
		const doExpand = () => {
			this._idleScheduled = false;
			try {
				const blocks = this._getTopLevelBlocks();
				const have = new Set(this._blockOrder);
				let added = 0;
				const budget = Math.max(1, this.eagerBlockCount | 0);
				for (const b of blocks) {
					if (have.has(b)) continue;
					const start = this._positions.length;
					const news = this._collectPositionSlotsFor(b, start);
					this._positions.push(...news);
					this._blockIndex.set(b, { start, end: this._positions.length, length: news.length });
					this._blockOrder.push(b);
					this._rebuildPrefixTextOffsetsForAppended(start);
					have.add(b);
					added++;
					if (added >= budget) break;
				}
				if (added > 0) {
					this._windowGen += 1;
					this._enforceMemoryCap();
				}
			} catch {}
		};
		if (typeof requestIdleCallback === "function") {
			requestIdleCallback(() => doExpand(), { timeout: 1200 });
		} else {
			setTimeout(doExpand, 0);
		}
	}

	// Debug/stats accessors (instrumentation)
	get stats() {
		return {
			rebuildCount: this._rebuildCount,
			ensureCount: this._ensureCount,
			bcrCount: this._bcrCount,
			lastBuildMs: this._lastBuildMs,
			positionsLength: this._positions.length,
			windowGen: this._windowGen,
			blockCount: this._blockOrder.length,
			eagerBlockCount: this.eagerBlockCount,
			maxCacheBytes: this.maxCacheBytes,
		};
	}

	// ----------------------------------------------------------------------------
	//
	// POSITION ACCESS
	//
	// ----------------------------------------------------------------------------

	// Method: pointAt
	// Gets the text point at the specified position `index`.
	pointAt(index) {
		const want = Math.max(0, Number.isFinite(index) ? index | 0 : 0);
		this.ensureIndex(want);
		const position = this._positions[want];
		return position?.point ?? null;
	}

	// Method: positionSlotAt
	// Gets the complete position slot info at the specified `index`.
	positionSlotAt(index) {
		const want = Math.max(0, Number.isFinite(index) ? index | 0 : 0);
		this.ensureIndex(want);
		return this._positions[want] ?? null;
	}

	// Method: indexOfPoint
	// Finds the slot index matching the specified `point`.
	// Expands window best-effort when not found in current window.
	indexOfPoint(point) {
		if (!point?.node) {
			return -1;
		}
		let positions = this.ensurePositions();
		const block = this._blockForPoint(point);
		const range = block ? this._blockIndex.get(block) : null;
		const start = range?.start ?? 0;
		const end = range?.end ?? positions.length;
		for (let i = start; i < end; i += 1) {
			const candidate = positions[i]?.point;
			if (candidate?.node === point.node && candidate.offset === point.offset) {
				return i;
			}
		}
		// Try to expand to cover this point's block and search again
		const expanded = this._ensureBlockForPoint(point);
		if (expanded) {
			positions = this._positions;
			const expandedRange = block ? this._blockIndex.get(block) : null;
			const expandedStart = expandedRange?.start ?? 0;
			const expandedEnd = expandedRange?.end ?? positions.length;
			for (let i = expandedStart; i < expandedEnd; i += 1) {
				const candidate = positions[i]?.point;
				if (candidate?.node === point.node && candidate.offset === point.offset) {
					return i;
				}
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
		const element =
			point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentElement;
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
		const cached = this._visualCache?.get(index);
		if (cached !== undefined) return cached ? { index, rect: cached } : null;
		const point = this.pointAt(index);
		if (!point) {
			this._visualCache?.set(index, null);
			return null;
		}
		const range = document.createRange();
		try {
			range.setStart(point.node, point.offset);
			range.collapse(true);
			const rect = range.getBoundingClientRect();
			this._bcrCount += 1;
			if (rect.width !== 0 || rect.height !== 0) {
				this._visualCache?.set(index, rect);
				return { index, rect };
			}
			if (point.node?.nodeType === Node.ELEMENT_NODE) {
				const nextSibling = point.node.childNodes[point.offset] ?? null;
				const previousSibling = point.node.childNodes[point.offset - 1] ?? null;
				const sibling = nextSibling ?? previousSibling;
				const siblingRect = sibling?.getBoundingClientRect?.();
				if (siblingRect) this._bcrCount += 1;
				if (siblingRect && (siblingRect.width !== 0 || siblingRect.height !== 0)) {
					const outRect = this._caretRectFromRect(siblingRect, nextSibling ? "start" : "end");
					this._visualCache?.set(index, outRect);
					return { index, rect: outRect };
				}
				const nodeRect = point.node.getBoundingClientRect();
				this._bcrCount += 1;
				if (nodeRect.width !== 0 || nodeRect.height !== 0) {
					const outRect = this._caretRectFromRect(nodeRect);
					this._visualCache?.set(index, outRect);
					return { index, rect: outRect };
				}
			}
			this._visualCache?.set(index, rect);
			return { index, rect };
		} catch (_e) {
			this._visualCache?.set(index, null);
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
	// Clamps the given `index` to a valid range within positions list (window length acceptable).
	// Expands window to cover requested index so that "end" and far numeric offsets work.
	clampIndex(index) {
		const value = Number.isFinite(index) ? index | 0 : 0;
		this.ensureIndex(value);
		if (this._positions.length === 0) {
			return 0;
		}
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
		if (!from || !to || from.node !== to.node || from.node?.nodeType !== Node.TEXT_NODE) {
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
	// Walks directionally from current to avoid O(N) full scan + BCRs.
	indexFromLineMove(index, direction, desiredX) {
		this.ensureIndex(index);
		const clamped = this.clampIndex(index);
		const current = this.visualPositionAt(clamped);
		if (!current) {
			return { index: clamped, desiredX };
		}
		const currentTop = current.rect.top;
		const targetX = desiredX ?? current.rect.left;
		const lineEpsilon = 4;
		const dir = direction < 0 ? -1 : 1;
		let best = null;
		let bestLineDistance = Infinity;
		let bestHorizontalDistance = Infinity;

		// Walk from current in the movement direction, collect the first different line
		let i = clamped + dir;
		const targetLine = [];
		while (i >= 0 && i < this._positions.length) {
			const pos = this._positions[i];
			if (!this.acceptsText(pos) || this.isFormattingWhitespaceSlot(i)) {
				i += dir;
				continue;
			}
			const cand = this.visualPositionAt(i);
			if (!cand) {
				i += dir;
				continue;
			}
			const y = cand.rect.top;
			const ld = Math.abs(y - currentTop);
			if (ld <= lineEpsilon) {
				i += dir;
				continue;
			}
			// different line: collect the whole line group
			targetLine.push({ index: i, rect: cand.rect });
			let j = i + dir;
			while (j >= 0 && j < this._positions.length) {
				const p2 = this._positions[j];
				if (!this.acceptsText(p2) || this.isFormattingWhitespaceSlot(j)) {
					j += dir;
					continue;
				}
				const c2 = this.visualPositionAt(j);
				if (!c2) break;
				if (Math.abs(c2.rect.top - y) <= lineEpsilon) {
					targetLine.push({ index: j, rect: c2.rect });
					j += dir;
				} else {
					break;
				}
			}
			break;
		}

		for (const t of targetLine) {
			const hd = Math.abs(t.rect.left - targetX);
			const ld = Math.abs(t.rect.top - currentTop);
			if (
				ld < bestLineDistance - lineEpsilon ||
				(Math.abs(ld - bestLineDistance) <= lineEpsilon && hd < bestHorizontalDistance)
			) {
				best = { index: t.index, rect: t.rect };
				bestLineDistance = ld;
				bestHorizontalDistance = hd;
			}
		}

		if (!best) {
			// fallback: try opposite direction or return current
			return { index: clamped, desiredX: targetX };
		}
		return { index: best.index, desiredX: targetX };
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
		const parent = point.node.nodeType === Node.ELEMENT_NODE ? point.node : point.node.parentNode;
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
	// Uses block prefix cache (cumulative grapheme counts at each slot) for speed.
	textOffsetAtIndex(index) {
		this.ensureIndex(index);
		const clamped = this.clampIndex(index);
		if (this._prefixTextOffsets && this._prefixTextOffsets.length > clamped) {
			return this._prefixTextOffsets[clamped] || 0;
		}
		// Fallback precise path (full walk)
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
		const pos =
			document.caretPositionFromPoint?.(x, y) ??
			document.caretRangeFromPoint?.(x, y);
		const node = pos?.offsetNode ?? pos?.startContainer;
		const offset = pos?.offset ?? pos?.startOffset;
		if (!node || offset == null) return null;
		const position = this.positionFromNode(node);
		if (!position) return null;
		position.offset +=
			node.nodeType === Node.TEXT_NODE
				? this._graphemeIndexAtCodeUnit(node.data, offset)
				: offset;
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
		this._beginEdit();
		try {
			const insertedPoint = point ? this.insertAtPoint(point, text) : null;
			this._refreshAfterPointEdit(point ?? insertedPoint);
			const nextIndex = this.indexOfPoint(insertedPoint);
			return {
				index: nextIndex >= 0 ? nextIndex : this.clampIndex(clamped + this._graphemeCount(text)),
			};
		} finally {
			this._endEdit();
		}
	}

	// Method: deleteBackwardAtIndex
	// Performs a backspace delete action at the specified position `index`.
	deleteBackwardAtIndex(index) {
		const clamped = this.clampIndex(index);
		if (clamped <= 0) {
			return { index: clamped };
		}
		const context = this.contextAt(clamped);
		this._beginEdit();
		try {
			if (context?.deleteBackward?.type === "node") {
				context.deleteBackward.node.remove();
				this.invalidatePositions();
				this.ensurePositions();
				// Prefer re-resolving a safe nearby position; fall back to arithmetic.
				try {
					const positions = this.positions();
					if (positions.length > 0) {
						const probe = Math.max(0, Math.min(clamped - 1, positions.length - 1));
						return { index: probe };
					}
				} catch (_) {}
				return { index: this.clampIndex(clamped - 1) };
			}
			if (
				context?.point?.node?.nodeType === Node.ELEMENT_NODE &&
				context.boundary?.leftNode?.nodeType === Node.TEXT_NODE
			) {
				const node = context.boundary.leftNode;
				const boundaries = this._graphemeBoundaries(node.data);
				if (boundaries.length > 1) {
					const startOffset = boundaries[boundaries.length - 2];
					const endOffset = boundaries[boundaries.length - 1];
					node.data = `${node.data.slice(0, startOffset)}${node.data.slice(endOffset)}`;
					this._refreshAfterPointEdit({ node, offset: startOffset });
					// Re-resolve the caret to the removal site in the (now shorter) text.
					const afterPoint = { node, offset: startOffset };
					const resolved = this.indexOfPoint(afterPoint);
					if (resolved >= 0) return { index: resolved };
					return { index: this.clampIndex(clamped - 1) };
				}
			}
			const point = this.pointAt(clamped);
			if (point?.node?.nodeType === Node.TEXT_NODE && point.offset > 0) {
				const boundaries = this._graphemeBoundaries(point.node.data);
				const current = boundaries.indexOf(point.offset);
				const gIndex =
					current >= 0 ? current : this._graphemeIndexAtCodeUnit(point.node.data, point.offset);
				const startOffset = boundaries[Math.max(0, gIndex - 1)] ?? 0;
				const endOffset = boundaries[gIndex] ?? point.offset;
				point.node.data = `${point.node.data.slice(0, startOffset)}${point.node.data.slice(endOffset)}`;
				this._refreshAfterPointEdit(point);
				// Re-resolve via the post-edit DOM point for robustness across windowed rebuilds.
				const afterPoint = { node: point.node, offset: startOffset };
				const resolved = this.indexOfPoint(afterPoint);
				if (resolved >= 0) return { index: resolved };
				return { index: this.clampIndex(clamped - 1) };
			}
			this.deleteAt(this.textOffsetAtIndex(clamped) - 1, 1);
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped - 1) };
		} finally {
			this._endEdit();
		}
	}

	// Method: deleteForwardAtIndex
	// Performs a forward delete action at the specified position `index`.
	deleteForwardAtIndex(index) {
		const clamped = this.clampIndex(index);
		const context = this.contextAt(clamped);
		this._beginEdit();
		try {
			if (context?.deleteForward?.type === "node") {
				context.deleteForward.node.remove();
				this.invalidatePositions();
				this.ensurePositions();
				try {
					const positions = this.positions();
					if (positions.length > 0) {
						const probe = Math.max(0, Math.min(clamped, positions.length - 1));
						return { index: probe };
					}
				} catch (_) {}
				return { index: this.clampIndex(clamped) };
			}
			if (
				context?.point?.node?.nodeType === Node.ELEMENT_NODE &&
				context.boundary?.rightNode?.nodeType === Node.TEXT_NODE
			) {
				const node = context.boundary.rightNode;
				const boundaries = this._graphemeBoundaries(node.data);
				if (boundaries.length > 1) {
					const startOffset = boundaries[0];
					const endOffset = boundaries[1];
					node.data = `${node.data.slice(0, startOffset)}${node.data.slice(endOffset)}`;
					this._refreshAfterPointEdit({ node, offset: startOffset });
					const afterPoint = { node, offset: startOffset };
					const resolved = this.indexOfPoint(afterPoint);
					if (resolved >= 0) return { index: resolved };
					return { index: this.clampIndex(clamped) };
				}
			}
			const point = this.pointAt(clamped);
			if (point?.node?.nodeType === Node.TEXT_NODE && point.offset < point.node.data.length) {
				const boundaries = this._graphemeBoundaries(point.node.data);
				const current = boundaries.indexOf(point.offset);
				const gIndex =
					current >= 0 ? current : this._graphemeIndexAtCodeUnit(point.node.data, point.offset);
				const startOffset = boundaries[gIndex] ?? point.offset;
				const endOffset = boundaries[Math.min(boundaries.length - 1, gIndex + 1)] ?? point.offset;
				point.node.data = `${point.node.data.slice(0, startOffset)}${point.node.data.slice(endOffset)}`;
				this._refreshAfterPointEdit(point);
				const afterPoint = { node: point.node, offset: startOffset };
				const resolved = this.indexOfPoint(afterPoint);
				if (resolved >= 0) return { index: resolved };
				return { index: this.clampIndex(clamped) };
			}
			this.deleteAt(this.textOffsetAtIndex(clamped), 1);
			this.invalidatePositions();
			this.ensurePositions();
			return { index: this.clampIndex(clamped) };
		} finally {
			this._endEdit();
		}
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
			case Node.TEXT_NODE: {
				const data = node.data;
				node.data = `${data.slice(0, offset)}${text}${data.slice(offset)}`;
				return { node, offset: offset + text.length };
			}
			case Node.ELEMENT_NODE: {
				const beforeNode = node.childNodes[offset] ?? null;
				if (beforeNode && beforeNode.nodeType === Node.TEXT_NODE) {
					const o = Math.min(beforeNode.data.length, 0);
					beforeNode.data = `${beforeNode.data.slice(0, o)}${text}${beforeNode.data.slice(o)}`;
					return { node: beforeNode, offset: o + text.length };
				}
				const textNode = document.createTextNode(text);
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
				const nextOffset = currentOffset + 1;
				const next = this.positionAt(nextOffset);
				if (
					!next ||
					(next.node === node && next.delta === delta) ||
					nextOffset === currentOffset
				) {
					break;
				}
				currentOffset = nextOffset;
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
		const push = (point, focusNode, graphemeIndex = null) => {
			if (!point?.node) {
				return;
			}
			const key = `${nodeKey(point.node)}:${point.offset}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			const resolvedFocusNode = focusNode ?? point.node;
			const kind = point.node?.nodeType === Node.TEXT_NODE ? "text-point" : "element-boundary";
			const boundary = this._boundaryAtPoint(point);
			const char = this._charAroundPoint(point, boundary, graphemeIndex);
			slots.push({
				point,
				focusNode: resolvedFocusNode,
				kind,
				boundary,
				char,
				graphemeIndex,
			});
		};
		for (const p of this.iwalk(root, { mode: "positions" })) {
			push(p.point, p.focusNode, p.graphemeIndex);
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
	_charAroundPoint(point, boundary, graphemeIndex = null) {
		const { node, offset } = point;
		if (node?.nodeType === Node.TEXT_NODE) {
			const boundaries = this._graphemeBoundaries(node.data, node);
			const index = Number.isInteger(graphemeIndex)
				? graphemeIndex
				: this._graphemeBoundaryIndex(node, offset);
			return {
				before: index > 0 ? node.data.slice(boundaries[index - 1], boundaries[index]) : null,
				after:
					index >= 0 && index < boundaries.length - 1
						? node.data.slice(boundaries[index], boundaries[index + 1])
						: null,
			};
		}
		const leftText = boundary.leftNode?.nodeType === Node.TEXT_NODE ? boundary.leftNode.data : null;
		const rightText =
			boundary.rightNode?.nodeType === Node.TEXT_NODE ? boundary.rightNode.data : null;
		return {
			before:
				leftText && leftText.length > 0
					? leftText.slice(
							this._codeUnitOffsetAtGrapheme(leftText, this._graphemeCount(leftText) - 1),
						)
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
					const boundaries = this._graphemeBoundaries(current.data, current);
					for (let graphemeIndex = 0; graphemeIndex < boundaries.length; graphemeIndex += 1) {
						yield {
							point: { node: current, offset: boundaries[graphemeIndex] },
							focusNode: current.parentNode ?? parent,
							graphemeIndex,
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
				const length = this._graphemeCount(current.data, current);
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
			if (this.isAtom(current)) {
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
