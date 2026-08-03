// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: selection-overlay
// Renders visual overlays of selection ranges.

import { prepareOverlayHost, clientToHostLocal } from "../selection/geometry.js";

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
				block.style.left = `${local.x}px`;
				block.style.top = `${local.y}px`;
				block.style.width = `${rect.width}px`;
				block.style.height = `${rect.height}px`;
				block.style.boxSizing = "border-box";
				block.style.pointerEvents = "none";
				// default fallback only if no style provided
				if (!cfg.direct && !cfg.byKey) {
					block.style.backgroundColor = "rgba(0, 120, 255, 0.22)";
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
export default SelectionOverlay;

// EOF
