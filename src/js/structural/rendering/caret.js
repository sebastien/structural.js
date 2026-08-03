// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: rendering/caret
// Controls the visual representation and layout of the editor's text cursor.

import { prepareOverlayHost, clientToOffsetParent } from "../selection/geometry.js"

class Caret {
	constructor(config = {}) {
		if (config && (config.nodeType === 1 || config instanceof HTMLElement)) config = { node: config }
		this._config = config || {}
		this.mode = this._config.mode === "native" ? "native" : "virtual"
		this.node = this.mode === "virtual" ? (this._config.node ?? null) : null
		this._container = this._config.container ?? null
		if (this.mode === "virtual" && this.node) prepareOverlayHost(this.node, this._container)
		this.focused = !!this._config.focused
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
		if (stateCfg?.classes) add(stateCfg.classes[state] || stateCfg.classes.default || null)
		for (const c of this._managedClasses) if (!toAdd.has(c)) this.node.classList.remove(c)
		for (const c of toAdd) if (!this.node.classList.contains(c)) this.node.classList.add(c)
		this._managedClasses = toAdd
	}
	_applyInlineStyles(stateCfg) {
		if (!this.node) return
		const next = {}
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
		if (sel && !sel.isCollapsed) this._hide()
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
			this.node.style.left = `${Math.floor(x)}px`
			this.node.style.top = `${Math.round(y)}px`
			if (height !== undefined) this.node.style.height = `${Math.max(1, Math.round(height))}px`
			this.node.style.visibility = "visible"
			this._applyState(this.focused ? "focus" : "default")
			if (this.node.classList?.contains("caret-blink")) {
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

export default Caret
