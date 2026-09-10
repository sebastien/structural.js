import { LEGACY_STRUCTURAL_SELECTOR, firstTextNode, lastTextNode } from "../foundation/document.js";
// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

const CARET_STYLE_ID = "structural-caret-style";
const DEFAULT_CARET_STYLE = { width: "1px", background: "#000" };
const DEFAULT_SELECTION_FILL = "rgba(0, 0, 0, 0.18)";

// Snaps a CSS length onto the device pixel grid.
export function snapCssPx(value, dpr = window.devicePixelRatio || 1) {
	return Math.round(value * dpr) / dpr;
}

// Injects the default caret blink keyframes once per document.
export function ensureCaretStylesheet(doc = document) {
	const target = doc?.head ? doc : globalThis.document;
	if (!target?.getElementById || target.getElementById(CARET_STYLE_ID)) return;
	const parent = target.head || target.documentElement;
	if (!parent?.appendChild) return;
	const style = target.createElement("style");
	style.id = CARET_STYLE_ID;
	style.textContent =
		"@keyframes structural-caret-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.caret-blink{animation:structural-caret-blink 1s step-end infinite}";
	parent.appendChild(style);
}

// Prepares a virtual overlay host and optionally mounts it under `container`.
export function prepareOverlayHost(node, container = null) {
	if (!node) return null;
	node.style.position = "absolute";
	if (!node.style.left) node.style.left = "0px";
	if (!node.style.top) node.style.top = "0px";
	if (!node.style.visibility) node.style.visibility = "hidden";
	node.setAttribute("aria-hidden", "true");
	node.style.pointerEvents = "none";
		if (container && container.nodeType === Node.ELEMENT_NODE) {
		const containerPos = container.style.position || getComputedStyle(container).position;
		if (!containerPos || containerPos === "static") container.style.position = "relative";
		if (node.parentNode !== container || container.lastElementChild !== node) container.appendChild(node);
	}
	return node;
}

// Converts viewport client coordinates to coordinates relative to an overlay host.
export function clientToHostLocal(clientX, clientY, host) {
	if (!host) return { x: clientX + window.scrollX, y: clientY + window.scrollY };
	const origin = host.getBoundingClientRect();
	return { x: clientX - origin.left, y: clientY - origin.top };
}

// Converts viewport client coordinates to an absolutely positioned node's offset parent.
export function clientToOffsetParent(clientX, clientY, node) {
	const parent = node?.offsetParent;
	if (!parent) return { x: clientX + window.scrollX, y: clientY + window.scrollY };
	const origin = parent.getBoundingClientRect();
	return {
		x: clientX - origin.left - parent.clientLeft + parent.scrollLeft,
		y: clientY - origin.top - parent.clientTop + parent.scrollTop,
	};
}

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: rendering/caret
// Controls the visual representation and layout of the editor's text cursor.


class Caret {
	constructor(config = {}) {
		if (config && (config.nodeType === 1 || config instanceof HTMLElement)) config = { node: config }
		this._config = config || {}
		this.mode = this._config.mode === "native" ? "native" : "virtual"
		this.node = this.mode === "virtual" ? (this._config.node ?? null) : null
		this._container = this._config.container ?? null
		if (this.mode === "virtual" && this.node) prepareOverlayHost(this.node, this._container)
		this.focused = !!this._config.focused
		this._blink = this._config.blink !== false
		this._className = this._config.className || null
		this._classes = this._config.classes || null
		this._style = this._config.style || null
		this._styles = this._config.styles || null
		this._managedClasses = new Set()
		this._managedStyleProps = new Set()
		this._destroyed = false
		this._measureCanvas = document.createElement("canvas")
		this._onSelectionChange = this._onSelectionChange.bind(this)
		if (this.mode !== "native") document.addEventListener("selectionchange", this._onSelectionChange)
		if (this.mode === "virtual" && this.node && this._blink) ensureCaretStylesheet(this.node.ownerDocument)
		this._applyInitialVisual()
	}

	setContainer(container) {
		this._container = container ?? null
		if (this.mode === "virtual" && this.node) prepareOverlayHost(this.node, this._container)
		return this
	}
	_applyInitialVisual() {
		if (this.mode === "native" || !this.node) return
		this._applyState(this.focused ? "focus" : "default")
	}
	_resolveStateConfig(state) {
		const direct = state === "focus" && this._config.focus ? this._config.focus : null
		const byKey =
			state === "focus" && this._styles?.focus
				? this._styles.focus
				: state === "default" && this._styles?.default
					? this._styles.default
					: null
		const legacyStyle = state === "focus" && this._style && typeof this._style === "object" ? this._style : null
		return { classes: this._classes || null, direct: direct || legacyStyle || null, byKey: byKey || null }
	}
	_applyClasses(stateCfg) {
		if (!this.node) return
		const toAdd = new Set()
		const add = (v) => {
			if (!v) return
			if (Array.isArray(v))
				v.forEach((x) => {
					if (x) toAdd.add(String(x))
				})
			else
				String(v)
					.split(/\s+/)
					.forEach((x) => {
						if (x) toAdd.add(x)
					})
		}
		add(this._className)
		if (this._blink) add("caret-blink")
		if (stateCfg?.classes) add(stateCfg.classes[state] || stateCfg.classes.default || null)
		for (const c of this._managedClasses) if (!toAdd.has(c)) this.node.classList.remove(c)
		for (const c of toAdd) if (!this.node.classList.contains(c)) this.node.classList.add(c)
		this._managedClasses = toAdd
	}
	_applyInlineStyles(stateCfg) {
		if (!this.node) return
		const next = { ...DEFAULT_CARET_STYLE }
		const merge = (obj) => {
			if (obj && typeof obj === "object") Object.assign(next, obj)
		}
		merge(stateCfg?.byKey || null)
		merge(stateCfg?.direct || null)
		for (const p of this._managedStyleProps)
			if (!(p in next)) this.node.style.removeProperty(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))
		const applied = new Set()
		for (const [k, v] of Object.entries(next)) {
			const css = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
			this.node.style.setProperty(css, String(v))
			applied.add(k)
		}
		this._managedStyleProps = applied
	}
	_applyState(state) {
		if (this.mode === "native" || !this.node) return
		const cfg = this._resolveStateConfig(state)
		this._applyClasses(cfg)
		this._applyInlineStyles(cfg)
	}
	setFocused(focused) {
		this.focused = !!focused
		if (this.mode !== "native" && this.node && this.node.style.visibility === "visible")
			this._applyState(this.focused ? "focus" : "default")
	}
	destroy() {
		if (this._destroyed) return
		this._destroyed = true
		document.removeEventListener("selectionchange", this._onSelectionChange)
		if (this.node) {
			for (const c of this._managedClasses) this.node.classList.remove(c)
			for (const p of this._managedStyleProps)
				this.node.style.removeProperty(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))
			this.node.style.visibility = "hidden"
		}
		this._managedClasses.clear()
		this._managedStyleProps.clear()
	}
	_onSelectionChange() {
		const sel = window.getSelection()
		if (!sel || sel.isCollapsed) return
		const host = this._container ?? this.node?.parentNode
		const anchor = sel.anchorNode
		if (host && anchor && (host === anchor || host.contains(anchor))) return
		this._hide()
	}
	_pointRect(node, offset) {
		const range = document.createRange()
		try {
			range.setStart(node, offset)
			range.collapse(true)
			return { rect: range.getBoundingClientRect(), range, source: "range" }
		} catch (_e) {
			return null
		}
	}
	_edgeRect(node, edge) {
		if (!node) return null
		if (node.nodeType === Node.TEXT_NODE) {
			const offset = edge === "start" ? 0 : node.data.length
			const result = this._pointRect(node, offset)
			if (result && (result.rect.width !== 0 || result.rect.height !== 0))
				return { ...result, source: `text-${edge}` }
			if (node.data.length === 0) return result ? { ...result, source: `text-${edge}` } : null
			const range = document.createRange()
			try {
				if (edge === "start") {
					range.setStart(node, 0)
					range.setEnd(node, 1)
				} else {
					range.setStart(node, node.data.length - 1)
					range.setEnd(node, node.data.length)
				}
				return { rect: range.getBoundingClientRect(), range, source: `text-${edge}-char` }
			} catch (_e) {
				return result ? { ...result, source: `text-${edge}` } : null
			}
		}
		if (node.nodeType === Node.ELEMENT_NODE)
			return { rect: node.getBoundingClientRect(), range: null, source: `element-${edge}` }
		return null
	}
	_deepCaretPoint(node, edge) {
		let current = node
		while (current) {
			if (current.nodeType === Node.TEXT_NODE)
				return { node: current, offset: edge === "start" ? 0 : current.data.length }
			if (current.nodeType !== Node.ELEMENT_NODE) return null
			const children = current.childNodes
			if (children.length === 0) return { node: current, offset: edge === "start" ? 0 : children.length }
			current = edge === "start" ? (children[0] ?? null) : (children[children.length - 1] ?? null)
		}
		return null
	}
	_visibleEdgeRect(node, edge) {
		let current = node
		while (current) {
			const result = this._edgeRect(current, edge)
			if (result && (result.rect.width !== 0 || result.rect.height !== 0)) return { ...result, node: current }
			current = edge === "end" ? current.previousSibling : current.nextSibling
		}
		return null
	}
	_boundaryRect(position) {
		const left = this._visibleEdgeRect(position?.boundary?.leftNode, "end")
		if (left && (left.rect.width !== 0 || left.rect.height !== 0)) {
			const point =
				left.node?.nodeType === Node.ELEMENT_NODE
					? this._edgeRect(this._deepCaretPoint(left.node, "end")?.node, "end")
					: null
			const local = clientToOffsetParent(left.rect.right, point?.rect.top ?? left.rect.top, this.node)
			return { x: local.x, y: local.y, height: left.rect.height, source: "left-boundary" }
		}
		const right = this._visibleEdgeRect(position?.boundary?.rightNode, "start")
		if (right && (right.rect.width !== 0 || right.rect.height !== 0)) {
			const point =
				right.node?.nodeType === Node.ELEMENT_NODE
					? this._edgeRect(this._deepCaretPoint(right.node, "start")?.node, "start")
					: null
			const local = clientToOffsetParent(right.rect.left, point?.rect.top ?? right.rect.top, this.node)
			return { x: local.x, y: local.y, height: right.rect.height, source: "right-boundary" }
		}
		return null
	}
	_hide() {
		if (this.node) this.node.style.visibility = "hidden"
	}
	_showAt(x, y, height) {
		if (this.node) {
			this.node.style.left = `${snapCssPx(x)}px`
			this.node.style.top = `${snapCssPx(y)}px`
			if (height !== undefined) this.node.style.height = `${Math.max(1, snapCssPx(height))}px`
			this.node.style.visibility = "visible"
			this._applyState(this.focused ? "focus" : "default")
			if (this._blink) {
				this.node.classList.remove("caret-blink")
				void this.node.offsetWidth
				this.node.classList.add("caret-blink")
			}
		}
	}
	_measureTextWidth(text, node) {
		if (!text) return 0
		const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
		if (!element) return 0
		const context = this._measureCanvas.getContext("2d")
		if (!context) return 0
		const style = window.getComputedStyle(element)
		context.font = style.font
		let width = context.measureText(text).width
		const letterSpacing = Number.parseFloat(style.letterSpacing)
		if (Number.isFinite(letterSpacing)) width += Math.max(0, text.length - 1) * letterSpacing
		const wordSpacing = Number.parseFloat(style.wordSpacing)
		if (Number.isFinite(wordSpacing)) width += (text.match(/ /g)?.length ?? 0) * wordSpacing
		return width
	}
	_collapsedTrailingSpaceWidth(position) {
		const pointNode = position?.point?.node
		const pointOffset = position?.point?.offset ?? 0
		const whitespaceNodes = []
		let trailingSpaces = ""
		if (
			pointNode?.nodeType === Node.TEXT_NODE &&
			pointOffset === pointNode.data.length &&
			pointNode.nextSibling === null
		) {
			const match = pointNode.data.slice(0, pointOffset).match(/ +$/)
			if (!match) return 0
			trailingSpaces = match[0]
			whitespaceNodes.unshift(pointNode)
			let current = pointNode.previousSibling
			while (current?.nodeType === Node.TEXT_NODE && /^[ ]+$/.test(current.data)) {
				trailingSpaces = `${current.data}${trailingSpaces}`
				whitespaceNodes.unshift(current)
				current = current.previousSibling
			}
		} else {
			const leftNode = position?.boundary?.leftNode
			if (
				leftNode?.nodeType !== Node.TEXT_NODE ||
				position?.boundary?.rightNode ||
				!/^[ ]+$/.test(leftNode.data ?? "")
			)
				return 0
			trailingSpaces = leftNode.data
			whitespaceNodes.unshift(leftNode)
			let current = leftNode.previousSibling
			while (current?.nodeType === Node.TEXT_NODE && /^[ ]+$/.test(current.data)) {
				trailingSpaces = `${current.data}${trailingSpaces}`
				whitespaceNodes.unshift(current)
				current = current.previousSibling
			}
		}
		return this._measureTextWidth(trailingSpaces, whitespaceNodes[0] ?? pointNode)
	}
	setVirtual(position, options = {}) {
		if (this.mode === "native") return { visible: false, editable: false, source: null }
		const editable = options.editable === true
		const point = position?.point
		if (!point) {
			this._hide()
			return { visible: false, editable: false, source: null }
		}
		const trailingSpaceWidth = this._collapsedTrailingSpaceWidth(position)
		const result =
			point.node?.nodeType === Node.TEXT_NODE || point.node?.nodeType === Node.ELEMENT_NODE
				? this._pointRect(point.node, point.offset)
				: null
		const rect = result?.rect
		if (rect && (rect.width !== 0 || rect.height !== 0)) {
			const local = clientToOffsetParent(
				rect.left + (rect.width === 0 ? trailingSpaceWidth : 0),
				rect.top,
				this.node,
			)
			const x = local.x
			const y = local.y
			if (editable) this._showAt(x, y, rect.height)
			else this._hide()
			return { x, y, source: result.source, visible: editable, editable }
		}
		const boundary = this._boundaryRect(position)
		if (boundary) {
			const x = boundary.x + trailingSpaceWidth
			if (editable) this._showAt(x, boundary.y, boundary.height)
			else this._hide()
			return { ...boundary, x, visible: editable, editable }
		}
		this._hide()
		return { visible: false, editable, source: result?.source ?? null }
	}
	set(node, offset, focus = true) {
		if (!node) return
		const selection = window.getSelection()
		const range = document.createRange()
		try {
			range.setStart(node, offset)
			range.collapse(true)
			selection.removeAllRanges()
			selection.addRange(range)
			if (focus && node.parentElement) node.parentElement.focus()
			return range
		} catch (_e) {
			console.error(`[hed] Unable to set caret: ${_e}`, { node, offset }, _e)
		}
	}
}

export { Caret };

const PLACEHOLDER_STYLE_ID = "structural-placeholder-style";
const DEFAULT_PLACEHOLDER_STYLE = {
	position: "absolute",
	pointerEvents: "none",
	userSelect: "none",
	color: "rgba(0, 0, 0, 0.35)",
	whiteSpace: "nowrap",
};

export function ensurePlaceholderStylesheet(doc = document) {
	const target = doc?.head ? doc : globalThis.document;
	if (!target?.getElementById || target.getElementById(PLACEHOLDER_STYLE_ID)) return;
	const parent = target.head || target.documentElement;
	if (!parent?.appendChild) return;
	const style = target.createElement("style");
	style.id = PLACEHOLDER_STYLE_ID;
	style.textContent =
		"[data-structural-placeholder]::before{content:none!important;display:none!important}";
	parent.appendChild(style);
}

class PlaceholderOverlay {
	constructor(editor, config = {}) {
		if (config === false) {
			this.disabled = true;
			this.editor = editor;
			this.node = null;
			return;
		}
		if (typeof config === "string") config = { text: config };
		if (config && (config.nodeType === 1 || config instanceof HTMLElement)) config = { node: config };
		this.disabled = false;
		this.editor = editor;
		this._config = config || {};
		this._managedStyleProps = new Set();
		this._raf = 0;
		this._onMutations = () => this._schedule();
		this._onCursorMove = () => this._schedule();
		this._observer = null;
		const root = editor?.root;
		const host = this._config.node ?? document.createElement("div");
		this.node = host;
		host.setAttribute("aria-hidden", "true");
		const container = this._config.container ?? root?.parentNode;
		prepareOverlayHost(host, container?.nodeType === Node.ELEMENT_NODE ? container : null);
		const caretNode = editor?.input?.cursor?.caret?.node;
		if (host.parentNode && caretNode && caretNode.parentNode === host.parentNode) {
			host.parentNode.insertBefore(host, caretNode);
		}
		if (root) {
			root.setAttribute("data-structural-placeholder", "");
			ensurePlaceholderStylesheet(root.ownerDocument);
		}
		this._applyStyles();
		this.attach();
		this.sync();
	}

	text() {
		if (this._config.text != null) return String(this._config.text);
		return this.editor?.root?.getAttribute?.("data-placeholder") ?? "";
	}

	attach() {
		if (this.disabled || !this.editor?.root) return this;
		const root = this.editor.root;
		root.addEventListener("CursorMove", this._onCursorMove);
		if (typeof MutationObserver === "function") {
			this._observer = new MutationObserver(this._onMutations);
			this._observer.observe(root, { subtree: true, childList: true, characterData: true });
		}
		return this;
	}

	detach() {
		if (this.editor?.root) {
			this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
			this.editor.root.removeAttribute("data-structural-placeholder");
			this.editor.root.removeAttribute("data-empty");
		}
		this._observer?.disconnect();
		this._observer = null;
		if (this._raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._raf);
		this._raf = 0;
		return this;
	}

	destroy() {
		this.detach();
		this.hide();
		if (this.node && this.node.parentNode && !this._config.node) this.node.remove();
		this.node = null;
	}

	_schedule() {
		if (this.disabled || this._raf) return;
		const run = () => {
			this._raf = 0;
			this.sync();
		};
		this._raf =
			typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 0), 1);
	}

	_isEmptyBlock(block) {
		if (!block) return true;
		if ((block.textContent ?? "").replace(/\u200b/g, "").trim()) return false;
		for (const child of block.childNodes) {
			if (child.nodeType === Node.TEXT_NODE && !(child.data ?? "").replace(/\u200b/g, "").trim()) continue;
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") continue;
			return false;
		}
		return true;
	}

	_isEmpty() {
		const root = this.editor?.root;
		if (!root) return true;
		const blocks = [...root.children].filter((n) => n.nodeType === Node.ELEMENT_NODE);
		if (blocks.length === 0) return !(root.textContent ?? "").replace(/\u200b/g, "").trim();
		if (blocks.length !== 1) return false;
		return this._isEmptyBlock(blocks[0]);
	}

	_emptyBlock() {
		const root = this.editor?.root;
		if (!root) return null;
		const blocks = [...root.children].filter((n) => n.nodeType === Node.ELEMENT_NODE);
		return blocks.length === 1 && this._isEmptyBlock(blocks[0]) ? blocks[0] : null;
	}

	hide() {
		if (this.node) this.node.style.visibility = "hidden";
	}

	_applyStyles() {
		if (!this.node) return;
		const next = { ...DEFAULT_PLACEHOLDER_STYLE };
		const merge = (obj) => {
			if (obj && typeof obj === "object") Object.assign(next, obj);
		};
		merge(this._config.styles?.default);
		merge(this._config.style);
		for (const p of this._managedStyleProps) {
			if (!(p in next)) this.node.style.removeProperty(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
		}
		const applied = new Set();
		for (const [k, v] of Object.entries(next)) {
			const css = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
			this.node.style.setProperty(css, String(v));
			applied.add(k);
		}
		this._managedStyleProps = applied;
		if (this._config.className) this.node.className = this._config.className;
	}

	sync() {
		if (this.disabled || !this.node || !this.editor?.root) return;
		const root = this.editor.root;
		const empty = this._isEmpty();
		root.toggleAttribute("data-empty", empty);
		const label = this.text();
		if (!empty || !label) {
			this.hide();
			return;
		}
		this.node.textContent = label;
		this._applyStyles();
		const target = this._emptyBlock() || root;
		const cs = getComputedStyle(target);
		const rect = target.getBoundingClientRect();
		const x = rect.left + (Number.parseFloat(cs.paddingLeft) || 0);
		const y = rect.top + (Number.parseFloat(cs.paddingTop) || 0);
		const local = clientToOffsetParent(x, y, this.node);
		this.node.style.left = `${snapCssPx(local.x)}px`;
		this.node.style.top = `${snapCssPx(local.y)}px`;
		this.node.style.visibility = "visible";
		if (!this._config.style?.font && !this._config.styles?.default?.font && cs.font) {
			this.node.style.font = cs.font;
		}
		if (!this._config.style?.lineHeight && !this._config.styles?.default?.lineHeight && cs.lineHeight) {
			this.node.style.lineHeight = cs.lineHeight;
		}
	}
}

export { PlaceholderOverlay };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: selection-overlay
// Renders visual overlays of selection ranges.


// Class: SelectionOverlay
// Renders visual overlays of selection ranges.
// - node: HTMLElement - the overlay host element
class SelectionOverlay {
	constructor(config = {}) {
		if (config && (config.nodeType === 1 || config instanceof HTMLElement)) {
			config = { node: config };
		}
		this._config = config || {};
		// Virtual mode needs an overlay host. Without one, fall back to native so
		// browser selection remains usable (range replace, clipboard, tests).
		const wantVirtual = this._config.mode !== "native";
		this.node = wantVirtual ? (this._config.node ?? null) : null;
		this.mode = wantVirtual && this.node ? "virtual" : "native";
		this._container = this._config.container ?? null;
		// Mount alongside the editor (shared offset/scroll parent), not under body.
		// Highlight rects are positioned relative to this host.
		if (this.mode === "virtual" && this.node) {
			prepareOverlayHost(this.node, this._container);
		}
		this._className = this._config.className || null;
		this._classes = this._config.classes || null;
		this._style = this._config.style || null;
		this._styles = this._config.styles || null;
		this._managedClasses = new Set();
		this._managedStyleProps = new Set();
		this._destroyed = false;
	}

	// Method: setContainer
	// Mounts the overlay host under `container` (typically the editor root's parent).
	setContainer(container) {
		this._container = container ?? null;
		if (this.mode === "virtual" && this.node) {
			prepareOverlayHost(this.node, this._container);
		}
		return this;
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
	// Clears the virtual selection overlay. Native selection is left alone so
	// caret moves (moveTo → clear → setVirtual) do not wipe a just-synced
	// browser caret; callers that must drop native ranges call _clearNative().
	clear() {
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
	// Does not clear the native selection: callers (syncToNative / structural select)
	// keep a native range for clipboard, getSelection(), and caret import.
	_applyVirtual(range) {
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
				const local = clientToHostLocal(rect.left, rect.top, this.node);
				const block = document.createElement("div");
				block.style.position = "absolute";
				block.style.left = `${snapCssPx(local.x)}px`;
				block.style.top = `${snapCssPx(local.y)}px`;
				block.style.width = `${snapCssPx(rect.width)}px`;
				block.style.height = `${snapCssPx(rect.height)}px`;
				block.style.boxSizing = "border-box";
				block.style.pointerEvents = "none";
				if (!cfg.direct && !cfg.byKey) {
					block.style.backgroundColor = DEFAULT_SELECTION_FILL;
				}
				this._applyBlockVisual(block, cfg, state);
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

	_applyBlockVisual(block, stateCfg, state = "default") {
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
			add(stateCfg.classes.selected || stateCfg.classes[state] || stateCfg.classes.default || null);
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
			if (!(p in next)) block.style.removeProperty(p.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
		}
		const applied = new Set();
		for (const [k, v] of Object.entries(next)) {
			const css = k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
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
				this.node.style.removeProperty(p.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
			}
			this.node.style.visibility = "hidden";
		}
		this._managedClasses.clear();
		this._managedStyleProps.clear();
	}
}

export { SelectionOverlay };

// EOF

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: text-selection
// Represents and renders a range selection in the text editor.


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
				const build = (from, to) => {
					const r = document.createRange();
					r.setStart(from.node, from.offset);
					r.setEnd(to.node, to.offset);
					return r;
				};
				let r = build(ap, fp);
				// Ancestor/descendant boundary points (an element at offset === childCount
				// versus a point inside that same child) can collapse a non-collapsed
				// selection when ordered by compareDocumentPosition alone. Retry swapped.
				if (r.collapsed && !normalized.collapsed) {
					const swapped = build(fp, ap);
					r = swapped.collapsed ? null : swapped;
				}
				if (r) return r;
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
		const editor = this.cursor?.editor;
		const startBlock = editor?.blockFor?.(domRange.startContainer);
		const endBlock = editor?.blockFor?.(domRange.endContainer);
		const crosses = !!(startBlock && endBlock && startBlock !== endBlock);
		let spanned = 1;
		if (crosses && editor?.root) {
			const selector = editor.blockSelector?.() ?? "p, h1, h2, h3, li, pre, blockquote";
			const blocks = [...editor.root.querySelectorAll(selector)].filter((block) => {
				try {
					return domRange.intersectsNode(block);
				} catch (_) {
					return false;
				}
			});
			spanned = blocks.filter(
				(block) => !blocks.some((other) => other !== block && other.contains(block)),
			).length;
		}
		adapter._beginEdit();
		try {
			let point = null;
			domRange.deleteContents();
			if (crosses && startBlock?.isConnected) {
				if (text.length > 0) {
					const node = document.createTextNode(text);
					startBlock.appendChild(node);
					point = { node, offset: text.length };
				} else {
					const last = lastTextNode(startBlock);
					point = last
						? { node: last, offset: last.data.length }
						: { node: startBlock, offset: startBlock.childNodes.length };
				}
				for (let i = 1; i < spanned; i += 1) {
					const following = startBlock.nextElementSibling;
					if (!following) break;
					while (following.firstChild) startBlock.appendChild(following.firstChild);
					following.remove();
				}
			} else if (text.length > 0) {
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

// EOF

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
	_nativeCaretPointFromClientPoint(x, y, affinity = "after") {
		let node = null;
		let offset = 0;
		const position = document.caretPositionFromPoint?.(x, y);
		if (position?.offsetNode) {
			node = position.offsetNode;
			offset = position.offset;
		} else {
			const range = document.caretRangeFromPoint?.(x, y);
			if (range?.startContainer) {
				node = range.startContainer;
				offset = range.startOffset;
			}
		}
		if (!node) return null;
		if (node.nodeType === Node.TEXT_NODE && node.data.length > 0) {
			if (affinity === "before" && offset > 0) {
				const probe = document.createRange();
				probe.setStart(node, offset - 1);
				probe.setEnd(node, offset);
				const rect = probe.getBoundingClientRect();
				if (rect.width > 0 && x < rect.left + rect.width / 2) offset -= 1;
			} else if (affinity === "after" && offset < node.data.length) {
				const probe = document.createRange();
				probe.setStart(node, offset);
				probe.setEnd(node, offset + 1);
				const rect = probe.getBoundingClientRect();
				if (rect.width > 0 && x > rect.left + rect.width / 2) offset += 1;
			}
		}
		return { node, offset };
	}

	// Method: _edgePlacement
	// Resolves whether a point should snap to the subtree start or end.
	_edgePlacement(root, x) {
		const rect = root.getBoundingClientRect();
		return x > rect.left + rect.width / 2 ? "end" : "start";
	}

	// Method: _setEdgeCaret
	// Places the caret at the subtree start or end when block helpers are unavailable.
	_setEdgeCaret(root, placement, session = null) {
		const textNode = placement === "end" ? lastTextNode(root) : firstTextNode(root);
		if (textNode) {
			return this.setCaret(textNode, placement === "end" ? textNode.data.length : 0, session);
		}
		if (root?.nodeType === Node.ELEMENT_NODE) {
			const offset = placement === "end" ? root.childNodes.length : 0;
			if (this.setCaret(root, offset, session)) return true;
			const child = placement === "end" ? root.lastElementChild : root.firstElementChild;
			if (child) {
				const childOffset = placement === "end" ? child.childNodes.length : 0;
				if (this.setCaret(child, childOffset, session)) return true;
			}
		}
		const active = this.editor.activeSession(session);
		const index = placement === "end" ? this.editor.text.clampIndex(0x7fffffff) : 0;
		active.cursor.moveTo(index, { skipBoundaryCollapse: true });
		this._syncSessionBlock(active);
		return this.syncToNative(active);
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

	// Method: resolveOffsetFromPoint
	// Resolves a structural text offset from viewport coordinates without moving the cursor or syncing native selection.
	resolveOffsetFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return null;
		const affinity = options.affinity === "before" ? "before" : "after";
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y, affinity);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			this.editor.text.ensurePositions();
			const index = this.editor.text.indexOfPoint(nativePoint);
			return index >= 0 ? index : null;
		}
		const active = this.editor.activeSession(session);
		const offset = active.cursor.offsetFromPointIn(root, x, y);
		return offset;
	}

	// Method: placeCaretFromPoint
	// Places the caret within subtree `root` using viewport coordinates `x` and `y`.
	placeCaretFromPoint(root, x, y, session = null, options = {}) {
		if (!root?.isConnected) return false;
		const nativePoint = this._nativeCaretPointFromClientPoint(x, y);
		if (nativePoint && this._pointWithin(root, nativePoint.node)) {
			return this.setCaret(nativePoint.node, nativePoint.offset, session);
		}

		const offset = this.resolveOffsetFromPoint(root, x, y, session);
		if (offset !== null) {
			const active = this.editor.activeSession(session);
			active.cursor._desiredX = null;
			active.cursor.moveTo(offset);
			this._syncSessionBlock(active);
			return this.syncToNative(active);
		}

		const active = this.editor.activeSession(session);
		if (options.fallback === "none") {
			return false;
		}

		const placement = this._edgePlacement(root, x);
		const rt = this.editor.capability?.("richtext") ?? this.editor.richText;
		return placement === "end"
			? (rt?.moveCursorToBlockEnd?.(root, active) ?? this._setEdgeCaret(root, "end", active))
			: (rt?.moveCursorToBlockStart?.(root, active) ?? this._setEdgeCaret(root, "start", active));
	}

	// Method: syncToNative
	// Syncs the active structural caret or range to the browser selection.
	// Always writes a native range so clipboard, getSelection(), and tests stay
	// consistent even when a virtual caret/selection overlay is also active.
	syncToNative(session = null) {
		const active = this.editor.activeSession(session);
		try {
			const selection = window.getSelection();
			if (!selection) return false;
			if (active.cursor.selectionKind === "range") {
				const range = active.cursor.selection.toDomRange();
				if (!range) return false;
				if (
					selection.rangeCount === 1 &&
					!selection.isCollapsed &&
					selection.anchorNode === range.startContainer &&
					selection.anchorOffset === range.startOffset &&
					selection.focusNode === range.endContainer &&
					selection.focusOffset === range.endOffset
				) {
					return true;
				}
				if (typeof selection.setBaseAndExtent === "function") {
					selection.setBaseAndExtent(
						range.startContainer,
						range.startOffset,
						range.endContainer,
						range.endOffset,
					);
				} else {
					selection.removeAllRanges();
					selection.addRange(range);
				}
				return true;
			}
			const point = this.editor.text.pointAt(active.cursor.offset ?? 0);
			if (!point?.node?.isConnected) return false;
			if (
				selection.rangeCount === 1 &&
				selection.isCollapsed &&
				selection.anchorNode === point.node &&
				selection.anchorOffset === point.offset
			) {
				return true;
			}
			if (typeof selection.setBaseAndExtent === "function") {
				selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
			} else {
				const range = document.createRange();
				range.setStart(point.node, point.offset);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
			return true;
		} catch (_e) {
			return false;
		}
	}

	// Method: _indexFromRangeBoundary
	// Resolves a structural index for a DOM Range boundary, including element
	// offsets used by Range.selectNode() (parent + child index).
	_indexFromRangeBoundary(container, offset, edge = "start") {
		if (!container) return -1;
		if (container.nodeType === Node.TEXT_NODE) {
			return this.editor.text.indexOfPoint({ node: container, offset });
		}
		if (container.nodeType !== Node.ELEMENT_NODE) return -1;
		const child =
			edge === "end"
				? container.childNodes[Math.max(0, offset - 1)]
				: container.childNodes[offset];
		if (child?.nodeType === Node.TEXT_NODE) {
			return this.editor.text.indexOfPoint({
				node: child,
				offset: edge === "end" ? child.data.length : 0,
			});
		}
		if (child?.nodeType === Node.ELEMENT_NODE) {
			const range = this.editor.structuralRangeFor?.(child);
			if (range) return edge === "end" ? range.end : range.start;
			const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
			let text = null;
			let first = null;
			while (walker.nextNode()) {
				if (!first) first = walker.currentNode;
				text = walker.currentNode;
			}
			const node = edge === "end" ? text : first;
			if (node) {
				return this.editor.text.indexOfPoint({
					node,
					offset: edge === "end" ? node.data.length : 0,
				});
			}
		}
		return this.editor.text.indexOfPoint({ node: container, offset });
	}

	// Method: syncFromNative
	// Maps the browser selection back into the active structural cursor state.
	syncFromNative(root = this.editor.root, session = null) {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return false;
		const range = selection.getRangeAt(0);
		if (!this.editor.range.within(root, range)) return false;
		let start = this.editor.text.indexOfPoint({
			node: range.startContainer,
			offset: range.startOffset,
		});
		let end = this.editor.text.indexOfPoint({
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0) {
			start = this._indexFromRangeBoundary(range.startContainer, range.startOffset, "start");
		}
		if (end < 0) {
			end = this._indexFromRangeBoundary(range.endContainer, range.endOffset, "end");
		}
		if (start < 0 || end < 0) return false;

		const active = this.editor.activeSession(session);
		if (range.collapsed || start === end) {
			// Preserve the exact text index from the native caret. Boundary collapse can
			// push a text-end index onto the following element-boundary and break typing.
			if (
				active.cursor.selectionKind === "caret" &&
				active.cursor.offset === end &&
				!active.cursor.selection?.isActive
			) {
				this._syncSessionBlock(active);
				return true;
			}
			active.cursor.moveTo(end, { skipBoundaryCollapse: true });
		} else {
			const lo = Math.min(start, end);
			const hi = Math.max(start, end);
			const cur = active.cursor.selection?.isActive
				? active.cursor.selection.normalizedRange()
				: null;
			if (
				active.cursor.selectionKind === "range" &&
				cur &&
				cur.start === lo &&
				cur.end === hi
			) {
				this._syncSessionBlock(active);
				return true;
			}
			active.cursor.select(start, end);
		}
		this._syncSessionBlock(active);
		active.classes?.update();
		return true;
	}
}

export {
	EditorSelectionController,
};

// EOF
