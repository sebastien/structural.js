// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: blocks
// Declarative structural-block editing: role schema, transforms, input rules, menus.

import { el, ListMenu, listMenuKeyRules, positionMenu } from "./menus.js";

// ----------------------------------------------------------------------------
// BlockMenus plugin
// ----------------------------------------------------------------------------

// Class: BlockMenus
// Chooser / operator / autocomplete chrome driven by schema + context.
// Public option bags (chooser/operator/complete) are unchanged; list chrome
// is shared via ListMenu.
export class BlockMenus {
	static pluginName = "block-menus";

	constructor(options = {}) {
		this.options = options;
		this.chooser = options.chooser ?? null;
		this.operator = options.operator ?? null;
		this.complete = options.complete ?? null;
		this.editor = null;
		this.blocks = null;
		this.activeEmptySlot = null;
		this.activeOpEl = null;
		this.activeVarLeaf = null;
		this.autoItems = [];
		this.chooserSuppressedFor = null;
		this._chooserMenu = null;
		this._opMenu = null;
		this._autoMenu = null;
		this._onCursorMove = this.onCursorMove.bind(this);
		this._onClick = this.onClick.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		this._mo = null;
	}

	get schema() {
		return this.blocks?.schema ?? null;
	}

	attach(editor) {
		this.editor = editor;
		this.blocks = editor.capability?.("blocks") ?? editor.blocks ?? editor.plugin("blocks");
		editor.root.addEventListener("CursorMove", this._onCursorMove);
		editor.root.addEventListener("click", this._onClick);
		document.addEventListener("mousedown", this._onMouseDown);

		this._chooserMenu = new ListMenu({
			el: this.chooser?.el,
			getItems: () => this.chooserItems(),
			renderItem: (item) => this._rowButton(item),
			onPick: (item) => {
				if (!this.activeEmptySlot) return false;
				this.blocks?.fill({ slot: this.activeEmptySlot, as: item.id });
				this.hideChooser();
				return true;
			},
			onShortcut: (key, items) => this.chooserShortcut(key, items),
		});
		this._opMenu = new ListMenu({
			el: this.operator?.el,
			getItems: () => {
				const items = this.opItems(this.blocks?.closestBlock(this.activeOpEl));
				if (!items.length) return items;
				return items.map((it, i) =>
					i === 0 && !it.section ? { ...it, section: "Operator" } : it,
				);
			},
			renderItem: (item) => {
				const block = this.blocks?.closestBlock(this.activeOpEl);
				const mark = block?.dataset.op === item.id ? " ✓" : "";
				return this._rowButton({ ...item, label: `${item.label ?? item.id}${mark}` });
			},
			onPick: (item) => {
				if (!this.activeOpEl) return false;
				this.blocks?.changeOp({
					block: this.blocks.closestBlock(this.activeOpEl),
					op: item.id,
				});
				this.hideOpMenu();
				return true;
			},
			onShortcut: (key) => this.opMenuShortcut(key),
		});
		this._autoMenu = new ListMenu({
			el: this.complete?.el,
			getItems: () => this.autoItems,
			renderItem: (name) => {
				const format =
					this.complete?.formatItem ??
					((n) => ({
						label: n,
						kbd: this.complete?.detail?.(n),
					}));
				const meta = format(name) ?? { label: name };
				const btn = this._rowButton({ label: meta.label ?? name, kbd: meta.kbd });
				btn.dataset.name = name;
				return btn;
			},
			onPick: (name) => this.applyVarName(name),
		});

		editor.addInputRules(
			[
				...listMenuKeyRules(() => this.isChooserOpen(), this._chooserMenu, {
					catchAll: true,
					onEscape: () => {
						const keep = this.activeEmptySlot;
						this.hideChooser({ suppress: true });
						const hole = keep?.querySelector?.(this.schema?.selector("hole") ?? ".hole");
						if (hole) this.blocks?.selectUnit(hole);
					},
				}),
				...listMenuKeyRules(() => this.isCompleteOpen(), this._autoMenu, {
					confirmKeys: ["Enter", "Tab"],
					onEscape: () => this.hideComplete(),
				}),
				...listMenuKeyRules(() => this.isOpMenuOpen(), this._opMenu, {
					catchAll: true,
					onEscape: () => {
						const keep = this.activeOpEl;
						this.hideOpMenu();
						if (keep) this.blocks?.selectUnit(keep);
					},
				}),
				{
					when: { slot: "empty" },
					key: ["Enter", "Space"],
					do: (args) => {
						const slot = args.context?.emptySlot ?? args.context?.slot;
						if (!slot) return false;
						const hole = slot.querySelector(this.schema?.selector("hole") ?? ".hole");
						if (hole) this.blocks?.selectUnit(hole);
						this.showChooser(slot, { force: true });
						return true;
					},
				},
				{
					when: { selected: "op" },
					key: ["Enter", "Space"],
					do: (args) => {
						const op = args.context?.selected;
						if (!op) return false;
						this.showOpMenu(op);
						return true;
					},
				},
			],
			{ prepend: true },
		);

		this._mo = new MutationObserver(() => {
			const cursor = editor.input.cursor;
			const leaf = this.blocks?.closestLeaf(cursor.anchor);
			if (leaf?.classList.contains("var")) {
				if (
					document.activeElement === editor.root ||
					editor.root.contains(document.activeElement)
				) {
					this.showComplete(leaf);
				}
			}
			this.blocks?.notifyChange?.();
		});
		this._mo.observe(editor.root, { characterData: true, childList: true, subtree: true });

		return this;
	}

	detach() {
		if (!this.editor) return this;
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		this.editor.root.removeEventListener("click", this._onClick);
		document.removeEventListener("mousedown", this._onMouseDown);
		this._mo?.disconnect();
		this._mo = null;
		this.hideAll();
		this.editor = null;
		this.blocks = null;
		this._chooserMenu = null;
		this._opMenu = null;
		this._autoMenu = null;
		return this;
	}

	_rowButton(item) {
		const btn = el("button", "", { type: "button" });
		if (item?.id != null) btn.dataset.id = item.id;
		btn.append(el("span", "", { text: item?.label ?? item?.id ?? item ?? "" }));
		if (item?.kbd != null) btn.append(el("span", "kbd", { text: item.kbd }));
		return btn;
	}

	// ------------------------------------------------------------------
	// Open state
	// ------------------------------------------------------------------

	isChooserOpen() {
		return !!this._chooserMenu?.isOpen;
	}

	isOpMenuOpen() {
		return !!this._opMenu?.isOpen;
	}

	isCompleteOpen() {
		return !!this._autoMenu?.isOpen;
	}

	hasOpen() {
		return this.isChooserOpen() || this.isOpMenuOpen() || this.isCompleteOpen();
	}

	hideAll(options = {}) {
		if (!options.keepChooser) this.hideChooser(options);
		this.hideOpMenu();
		this.hideComplete();
	}

	suppressChooserFor(slot) {
		this.chooserSuppressedFor = slot ?? null;
	}

	// ------------------------------------------------------------------
	// Items
	// ------------------------------------------------------------------

	chooserItems() {
		if (typeof this.chooser?.items === "function") return this.chooser.items();
		if (Array.isArray(this.chooser?.items)) return this.chooser.items;
		const schema = this.schema;
		if (Array.isArray(schema?.choices)) return schema.choices;
		return [];
	}

	opItems(block) {
		if (typeof this.operator?.items === "function") return this.operator.items(block);
		if (Array.isArray(this.operator?.items)) return this.operator.items;
		const shapes = this.schema?.shapes ?? {};
		return Object.entries(shapes).map(([id, shape]) => ({
			id,
			label: shape.menuLabel ?? shape.label ?? id,
			kbd: shape.kbd ?? shape.key ?? id,
		}));
	}

	// ------------------------------------------------------------------
	// Chooser
	// ------------------------------------------------------------------

	showChooser(slot, options = {}) {
		if (!this._chooserMenu || !slot?.isConnected) return;
		if (!options.force && this.chooserSuppressedFor === slot) return;
		this.chooserSuppressedFor = null;
		this.hideComplete();
		this.hideOpMenu();
		this.activeEmptySlot = slot;
		this._chooserMenu.show(slot, { index: 0 });
	}

	hideChooser(options = {}) {
		if (options.suppress && this.activeEmptySlot) {
			this.chooserSuppressedFor = this.activeEmptySlot;
		}
		this._chooserMenu?.hide();
		this.activeEmptySlot = null;
	}

	moveChooser(delta) {
		this._chooserMenu?.move(delta);
	}

	confirmChooser() {
		return this._chooserMenu?.confirm() === true;
	}

	chooserShortcut(key, items = this.chooserItems()) {
		const op = this.blocks?.schema?.opFromKey(key);
		if (op && this.activeEmptySlot) {
			const hit = items.find((it) => it.id === op);
			if (hit) {
				this.blocks.fill({ slot: this.activeEmptySlot, as: hit.id });
				this.hideChooser();
				return true;
			}
		}
		const byId = items.find((it) => it.id === key || it.shortcut === key || it.kbd === key);
		if (byId && this.activeEmptySlot) {
			if (byId.shortcut === key || (key.length === 1 && byId.id === key)) {
				this.blocks.fill({ slot: this.activeEmptySlot, as: byId.id });
				this.hideChooser();
				return true;
			}
		}
		return false;
	}

	// ------------------------------------------------------------------
	// Operator menu
	// ------------------------------------------------------------------

	showOpMenu(opEl) {
		if (!this._opMenu || !opEl?.isConnected) return;
		this.hideChooser();
		this.hideComplete();
		this.activeOpEl = opEl;
		const block = this.blocks?.closestBlock(opEl);
		const items = this.opItems(block);
		const cur = items.findIndex((it) => it.id === block?.dataset.op);
		this._opMenu.show(opEl, { index: cur >= 0 ? cur : 0 });
	}

	hideOpMenu() {
		this._opMenu?.hide();
		this.activeOpEl = null;
	}

	moveOpMenu(delta) {
		this._opMenu?.move(delta);
	}

	confirmOpMenu() {
		return this._opMenu?.confirm() === true;
	}

	opMenuShortcut(key) {
		const op = this.blocks?.schema?.opFromKey(key);
		if (!op || !this.activeOpEl) return false;
		this.blocks.changeOp({ block: this.blocks.closestBlock(this.activeOpEl), op });
		this.hideOpMenu();
		return true;
	}

	// ------------------------------------------------------------------
	// Autocomplete
	// ------------------------------------------------------------------

	completeSource(prefix) {
		const src = this.complete?.source;
		if (typeof src === "function") return src(prefix) ?? [];
		if (Array.isArray(src)) {
			const p = (prefix ?? "").toLowerCase();
			if (!p) return src;
			return src.filter((n) => String(n).toLowerCase().startsWith(p));
		}
		return [];
	}

	showComplete(leaf) {
		if (!this._autoMenu || !leaf?.isConnected) return;
		this.hideChooser();
		this.hideOpMenu();
		this.activeVarLeaf = leaf;
		const prefix = leaf.textContent ?? "";
		this.autoItems = this.completeSource(prefix);
		if (!this.autoItems.length) {
			// Keep empty-state messaging consistent with prior UI.
			const menu = this.complete?.el;
			if (menu) {
				menu.innerHTML = "";
				menu.append(el("div", "section", { text: "No matches" }));
				positionMenu(menu, leaf);
			}
			return;
		}
		this._autoMenu.show(leaf, { index: 0 });
	}

	hideComplete() {
		this._autoMenu?.hide();
		this.activeVarLeaf = null;
		this.autoItems = [];
	}

	moveAuto(delta) {
		this._autoMenu?.move(delta);
	}

	confirmAuto() {
		return this._autoMenu?.confirm() === true;
	}

	applyVarName(name) {
		if (!this.activeVarLeaf?.isConnected) {
			this.hideComplete();
			return false;
		}
		return this.blocks?.applyCompletion({ leaf: this.activeVarLeaf, value: name }) ?? false;
	}

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	emptySlotFromSelection() {
		const schema = this.schema;
		const cursor = this.editor.input.cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const n = cursor.selectedNode;
			if (schema?.hasRole(n, "hole")) {
				const slot = this.blocks?.closestSlot(n);
				if (slot && schema.isEmptySlot(slot)) return slot;
			}
			if (schema?.isEmptySlot(n)) return n;
		}
		const slot =
			this.blocks?.closestSlot(cursor.selectedNode) ??
			this.blocks?.closestSlot(cursor.anchor);
		return slot && schema?.isEmptySlot(slot) ? slot : null;
	}

	onCursorMove() {
		const schema = this.schema;
		const slot = this.emptySlotFromSelection();
		if (slot) {
			this.hideOpMenu();
			if (this.chooserSuppressedFor && this.chooserSuppressedFor !== slot) {
				this.chooserSuppressedFor = null;
			}
			if (this.activeEmptySlot !== slot || !this.isChooserOpen()) {
				this.showChooser(slot);
			}
		} else {
			this.chooserSuppressedFor = null;
			if (
				this.isChooserOpen() &&
				this.activeEmptySlot &&
				!this.activeEmptySlot.contains(this.editor.input.cursor.anchor) &&
				this.editor.input.cursor.selectedNode !== this.activeEmptySlot &&
				!this.activeEmptySlot.contains(this.editor.input.cursor.selectedNode)
			) {
				this.hideChooser();
			}
		}

		const cursor = this.editor.input.cursor;
		if (cursor.selectionKind === "node" && schema?.hasRole(cursor.selectedNode, "op")) {
			if (this.activeOpEl !== cursor.selectedNode || !this.isOpMenuOpen()) {
				this.showOpMenu(cursor.selectedNode);
			}
		} else if (this.isOpMenuOpen() && this.activeOpEl && cursor.selectedNode !== this.activeOpEl) {
			this.hideOpMenu();
		}
	}

	onClick(event) {
		const schema = this.schema;
		const opSel = schema
			? `${schema.selector("op")}.${schema.token("atom")}`
			: ".op.atom";
		const op = event.target.closest?.(opSel);
		if (op && this.editor.root.contains(op)) {
			event.preventDefault();
			this.blocks?.selectUnit(op);
			this.showOpMenu(op);
			return;
		}
		const hole = event.target.closest?.(schema?.selector("hole") ?? ".hole");
		if (hole) {
			const slot = this.blocks?.closestSlot(hole);
			if (slot && schema?.isEmptySlot(slot)) {
				event.preventDefault();
				this.blocks?.selectUnit(hole);
				this.showChooser(slot);
			}
		}
		const leafSel = schema ? `${schema.selector("leaf")}.var` : ".leaf.var";
		const leaf = event.target.closest?.(leafSel);
		if (leaf) this.showComplete(leaf);
	}

	onMouseDown(event) {
		const t = event.target;
		const schema = this.schema;
		const holeSel = schema?.selector("hole") ?? ".hole";
		const emptySlotSel = schema?.selector("slot", "empty") ?? ".slot.empty";
		const leafVarSel = schema ? `${schema.selector("leaf")}.var` : ".leaf.var";
		const opAtomSel = schema
			? `${schema.selector("op")}.${schema.token("atom")}`
			: ".op.atom";
		const root = this.editor.root;

		if (
			this.chooser?.el &&
			!this.chooser.el.contains(t) &&
			!t.closest?.(holeSel) &&
			!t.closest?.(emptySlotSel)
		) {
			this.hideChooser();
		}
		if (this.complete?.el && !this.complete.el.contains(t) && !t.closest?.(leafVarSel)) {
			if (t !== root && !root.contains(t)) {
				this.hideComplete();
			}
		}
		if (this.operator?.el && !this.operator.el.contains(t) && !t.closest?.(opAtomSel)) {
			this.hideOpMenu();
		}
	}
}
