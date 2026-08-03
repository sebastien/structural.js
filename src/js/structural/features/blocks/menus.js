// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

function el(tag, className, attrs = {}) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null) continue;
		if (k === "text") node.textContent = v;
		else node.setAttribute(k, v);
	}
	return node;
}

function positionMenu(menu, anchor) {
	if (!menu || !anchor) return;
	const rect = anchor.getBoundingClientRect();
	const pad = 6;
	menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
	menu.style.top = `${rect.bottom + pad}px`;
	menu.classList.add("open");
	const mrect = menu.getBoundingClientRect();
	if (mrect.bottom > window.innerHeight - 8) {
		menu.style.top = `${Math.max(8, rect.top - mrect.height - pad)}px`;
	}
}

// Function: listMenuKeyRules
// Arrow/confirm/escape/(optional catch-all) rules for an open ListMenu.
function listMenuKeyRules(isOpen, menu, options = {}) {
	const confirmKeys = options.confirmKeys ?? ["Enter"];
	const rules = [
		{
			when: isOpen,
			key: "ArrowDown",
			do: () => {
				menu.move(1);
				return true;
			},
		},
		{
			when: isOpen,
			key: "ArrowUp",
			do: () => {
				menu.move(-1);
				return true;
			},
		},
		{
			when: isOpen,
			key: confirmKeys,
			do: () => menu.confirm() !== false,
		},
		{
			when: isOpen,
			key: "Escape",
			do: () => {
				if (typeof options.onEscape === "function") options.onEscape();
				else menu.hide();
				return true;
			},
		},
	];
	if (options.catchAll) {
		rules.push({
			when: isOpen,
			match: /.*/,
			do: (args) => menu.shortcut(args.key) === true,
		});
	}
	return rules;
}

// Class: ListMenu
// Shared floating list chrome (index, render, move, confirm, shortcut).
class ListMenu {
	constructor(options = {}) {
		this.el = options.el ?? null;
		this.getItems = typeof options.getItems === "function" ? options.getItems : () => [];
		this.renderItem =
			typeof options.renderItem === "function"
				? options.renderItem
				: (item) => {
						const btn = el("button", "", { type: "button" });
						btn.append(el("span", "", { text: item.label ?? item.id ?? item }));
						if (item.kbd != null) btn.append(el("span", "kbd", { text: item.kbd }));
						return btn;
					};
		this.onPick = typeof options.onPick === "function" ? options.onPick : null;
		this.onShortcut = typeof options.onShortcut === "function" ? options.onShortcut : null;
		this.index = 0;
		this._items = [];
	}

	get isOpen() {
		return !!this.el?.classList.contains("open");
	}

	show(anchor, options = {}) {
		if (!this.el || !anchor?.isConnected) return false;
		this._items = this.getItems() ?? [];
		const max = Math.max(0, this._items.length - 1);
		this.index = Math.max(0, Math.min(options.index ?? 0, max));
		this.redraw();
		positionMenu(this.el, anchor);
		return true;
	}

	hide() {
		this.el?.classList.remove("open");
		this._items = [];
		return this;
	}

	move(delta) {
		if (!this._items.length) return this;
		this.index = (this.index + delta + this._items.length) % this._items.length;
		this.redraw();
		this.el?.querySelector("button.active")?.scrollIntoView({ block: "nearest" });
		return this;
	}

	confirm() {
		const item = this._items[this.index];
		if (item == null) return false;
		return this.onPick?.(item, this.index) !== false;
	}

	shortcut(key) {
		return this.onShortcut?.(key, this._items) === true;
	}

	redraw() {
		const menu = this.el;
		if (!menu) return;
		menu.innerHTML = "";
		let lastSection = null;
		this._items.forEach((item, i) => {
			if (item?.section && item.section !== lastSection) {
				lastSection = item.section;
				menu.append(el("div", "section", { text: item.section }));
			}
			const node = this.renderItem(item, i, i === this.index);
			if (i === this.index) node.classList.add("active");
			else node.classList.remove("active");
			node.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.index = i;
				this.onPick?.(item, i);
			});
			menu.append(node);
		});
	}
}

export { el, positionMenu, listMenuKeyRules, ListMenu };
