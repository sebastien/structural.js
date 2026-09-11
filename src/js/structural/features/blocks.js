import { asElement } from "../foundation/document.js";
import { editorKeymap, blockWhenDomain, matchInputRuleWhen } from "../runtime/editor.js";
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

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: block rules

// Function: defaultBlockInput
// Common input rules for expression-like block editors.
export function defaultBlockInput(options = {}) {
	const opKeys = options.opKeys ?? ["+", "-", "*", "/", "−", "÷"];
	const numberMatch = options.numberMatch ?? /^[0-9.]$/;
	const varMatch = options.varMatch ?? /^[a-zA-Z_]$/;
	return [
		// Type-through on empty slots
		{
			when: { slot: "empty" },
			match: numberMatch,
			do: "fill",
			as: options.numberKind ?? "number",
			focus: "edit",
		},
		{
			when: { slot: "empty" },
			match: varMatch,
			do: "fill",
			as: options.varKind ?? "var",
			focus: "edit",
		},
		{
			when: { slot: "empty" },
			key: opKeys,
			do: "fill",
			as: "$key",
		},
		{
			when: { slot: "empty" },
			key: options.negKeys ?? ["n", "N"],
			do: "fill",
			as: options.negKind ?? "neg",
		},

		// Change operator when op atom selected
		{
			when: { selected: "op" },
			key: opKeys,
			do: "changeOp",
		},
		{
			when: { selected: "op" },
			key: options.negKeys ?? ["n", "N"],
			do: "changeOp",
			args: { op: options.negKind ?? "neg" },
		},

		// Wrap at leaf edges / with Shift
		{
			when: { inLeaf: true, edge: "end" },
			key: opKeys,
			do: "wrap",
			side: "after",
		},
		{
			when: (ctx, event) => {
				if (!ctx.inLeaf || !ctx.leaf) return false;
				if (!(ctx.edge === "start" || event.shiftKey)) return false;
				// Leading "-" in a number leaf is a sign, not a binary wrap.
				if (
					!event.shiftKey &&
					ctx.edge === "start" &&
					ctx.leaf.classList.contains("num") &&
					(event.key === "-" || event.key === "−")
				) {
					return false;
				}
				return true;
			},
			key: opKeys,
			do: "wrap",
			side: "before",
		},
		// Wrap when a structural unit is node-selected
		{
			when: (ctx) =>
				ctx.isUnitSelected &&
				!ctx.isOpSelected &&
				!ctx.isHoleSelected &&
				!ctx.slotEmpty,
			key: opKeys,
			do: "wrap",
		},

		// Typing into a selected number/var unit replaces content and edits
		{
			when: (ctx) =>
				ctx.selectionKind === "node" &&
				ctx.slot &&
				ctx.slot.dataset?.kind === "number",
			match: numberMatch,
			do: (args, env) => {
				const blocks = env.editor.capability?.("blocks") ?? env.editor.blocks;
				const schema = blocks?.schema;
				const leafSel = schema ? `${schema.selector("leaf")}.num` : ".leaf.num";
				const slot = args.context.slot;
				const leaf = slot?.querySelector?.(leafSel);
				if (!leaf) return false;
				leaf.textContent = args.key === "." ? "0." : args.key;
				env.editor.text.refresh();
				blocks?.placeCaretIn(leaf, true, env);
				blocks?.notifyChange();
				return true;
			},
		},
		{
			when: (ctx) =>
				ctx.selectionKind === "node" &&
				ctx.slot &&
				ctx.slot.dataset?.kind === "var",
			match: varMatch,
			do: (args, env) => {
				const blocks = env.editor.capability?.("blocks") ?? env.editor.blocks;
				const schema = blocks?.schema;
				const leafSel = schema ? `${schema.selector("leaf")}.var` : ".leaf.var";
				const slot = args.context.slot;
				const leaf = slot?.querySelector?.(leafSel);
				if (!leaf) return false;
				leaf.textContent = args.key;
				env.editor.text.refresh();
				blocks?.placeCaretIn(leaf, true, env);
				env.editor.plugin("block-menus")?.showComplete?.(leaf);
				blocks?.notifyChange();
				return true;
			},
		},

		// Swallow raw text when a non-editable unit is selected
		{
			when: (ctx) =>
				ctx.selectionKind === "node" &&
				ctx.selected &&
				!ctx.isOpSelected &&
				!(ctx.slot?.dataset?.kind === "number") &&
				!(ctx.slot?.dataset?.kind === "var") &&
				!ctx.slotEmpty &&
				!ctx.isHoleSelected,
			match: /^.$/,
			do: "noop",
		},
	];
}

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04


const DEFAULT_ROLE_CLASSES = {
	hole: "hole",
	op: "op",
	leaf: "leaf",
	slot: "slot",
	block: "block",
};

const DEFAULT_TOKENS = {
	empty: "empty",
	nested: "nested",
	selected: "selected",
	focus: "focus",
	atom: "atom",
	container: "container",
};

const BUILTIN_UNIT_ROLES = ["hole", "op", "leaf", "slot", "block"];

// Class: BlockSchema
// Role-oriented schema for slot/block/leaf documents. Create fns stay app-owned.
// Role ids (hole/op/leaf/slot/block) are stable; CSS class names are configurable
// via `classes` / `roles[name].className` and state tokens via `classes` tokens.
class BlockSchema {
	constructor(def = {}) {
		this.def = def;
		this.create = def.create ?? {};
		this.shapes = def.shapes ?? {};
		this.nest = typeof def.nest === "function" ? def.nest : null;
		this.ops = def.ops ?? null;
		this.choices = def.choices ?? null;

		const classOverrides = def.classes ?? {};
		this._tokens = { ...DEFAULT_TOKENS };
		this._roleClass = { ...DEFAULT_ROLE_CLASSES };
		for (const [key, value] of Object.entries(classOverrides)) {
			if (value == null || value === "") continue;
			if (key in DEFAULT_TOKENS && !(key in DEFAULT_ROLE_CLASSES)) this._tokens[key] = value;
			else if (key in DEFAULT_ROLE_CLASSES) this._roleClass[key] = value;
			else if (key in DEFAULT_TOKENS) this._tokens[key] = value;
			else this._roleClass[key] = value;
		}

		this.roles = { ...(def.roles ?? {}) };
		for (const name of BUILTIN_UNIT_ROLES) {
			const base = {
				className: this._roleClass[name] ?? name,
				type: "unit",
				atom: name === "hole" || name === "op",
				container: name === "slot" || name === "block",
			};
			this.roles[name] = { ...base, ...(this.roles[name] ?? {}) };
			if (this.roles[name].className) this._roleClass[name] = this.roles[name].className;
		}
		for (const [name, rule] of Object.entries(this.roles)) {
			if (rule?.className) this._roleClass[name] = rule.className;
		}

		this.units =
			def.units ??
			Object.keys(this.roles)
				.filter((name) => (this.roles[name]?.type ?? "unit") === "unit")
				.map((name) => this.selector(name));
	}

	make(kind, ...args) {
		const fn = this.create[kind];
		if (typeof fn !== "function") {
			throw new Error(`BlockSchema: unknown create kind "${kind}"`);
		}
		return fn(...args);
	}

	has(kind) {
		return typeof this.create[kind] === "function";
	}

	shape(op) {
		return this.shapes[op] ?? null;
	}

	opFromKey(key) {
		if (key == null) return null;
		if (this.ops && typeof this.ops === "object") {
			if (this.ops[key] != null) return this.ops[key];
		}
		for (const [id, shape] of Object.entries(this.shapes)) {
			const keys = shape.keys ?? (shape.key != null ? [shape.key] : [id]);
			const list = Array.isArray(keys) ? keys : [keys];
			if (list.some((k) => k === key || String(k).toLowerCase() === String(key).toLowerCase())) {
				return id;
			}
		}
		return null;
	}

	className(roleOrToken) {
		if (roleOrToken == null) return "";
		return this._roleClass[roleOrToken] ?? this._tokens[roleOrToken] ?? roleOrToken;
	}

	token(name) {
		return this._tokens[name] ?? name;
	}

	classes(...parts) {
		return parts
			.flat()
			.filter(Boolean)
			.map((p) => this.className(p))
			.join(" ");
	}

	selector(role, ...extras) {
		const bits = [role, ...extras].filter(Boolean).map((p) => {
			const cls = this.className(p);
			return cls.startsWith(".") ? cls : `.${cls}`;
		});
		return bits.join("");
	}

	hasToken(node, name) {
		const eln = asElement(node);
		const cls = this.token(name);
		return !!eln?.classList?.contains(cls);
	}

	hasRole(node, role) {
		return this.roleOf(node) === role;
	}

	isEmptySlot(node) {
		return this.hasRole(node, "slot") && this.hasToken(node, "empty");
	}

	closest(node, role, root) {
		let cur = asElement(node);
		while (cur && cur !== root && root?.contains?.(cur) !== false) {
			if (this.hasRole(cur, role)) return cur;
			cur = cur.parentElement;
		}
		return cur && this.hasRole(cur, role) ? cur : null;
	}

	roleOf(node) {
		const eln = asElement(node);
		if (!eln?.classList) return null;
		for (const [name, rule] of Object.entries(this.roles)) {
			if (typeof rule?.match === "function" && rule.match(eln)) return name;
			if (typeof rule?.selector === "string" && eln.matches?.(rule.selector)) return name;
		}
		for (const name of BUILTIN_UNIT_ROLES) {
			const cls = this._roleClass[name];
			if (cls && eln.classList.contains(cls)) return name;
		}
		for (const [name, cls] of Object.entries(this._roleClass)) {
			if (BUILTIN_UNIT_ROLES.includes(name)) continue;
			if (cls && eln.classList.contains(cls)) return name;
		}
		return null;
	}

	isUnit(node) {
		const eln = asElement(node);
		if (!eln) return false;
		const role = this.roleOf(eln);
		if (!role) {
			return this.units.some((sel) => {
				try {
					return eln.matches?.(sel);
				} catch {
					return eln.classList?.contains?.(String(sel).replace(/^\./, ""));
				}
			});
		}
		const rule = this.roles[role];
		if (rule?.type === "unit") return true;
		if (rule?.type && rule.type !== "unit") return false;
		return BUILTIN_UNIT_ROLES.includes(role);
	}

	unitSelector() {
		return this.units.join(", ");
	}
}

// Function: blockSchema
// Builds a BlockSchema from a definition object.
function blockSchema(def = {}) {
	return def instanceof BlockSchema ? def : new BlockSchema(def);
}

// Function: blockKeymap
// Default keymap for block editors (composes editorKeymap).
function blockKeymap(overrides = {}) {
	return editorKeymap({
		Escape: { type: "collapseStructural" },
		...overrides,
	});
}

export { BlockSchema, blockKeymap, blockSchema };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: blocks
// Declarative structural-block editing: role schema, transforms, input rules, menus.


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
		this.blocks = editor.blocks ?? editor.plugin("blocks");
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

// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: features/blocks/plugin
// Structural-block transforms, unit scope, and declarative input rules.


class Blocks {
	static pluginName = "blocks";

	constructor(options = {}) {
		this.options = options;
		this.schema = blockSchema(options.schema ?? options);
		this.input = options.input ?? [];
		this.focus = options.focus ?? {};
		this.onChange = typeof options.onChange === "function" ? options.onChange : null;
		this.editor = null;
		this._onCursorMove = this.onCursorMove.bind(this);
		this._selectedClass = options.selectedClass ?? this.schema.token("selected");
		this._inputRules = [];
	}

	// Method: attach
	// Installs actions, input rules, scope provider, and cursor styling.
	attach(editor) {
		this.editor = editor;
		editor.blocks = this;
		editor.blockSchema = this.schema;
		editor.scopeProvider = this;

		editor.configureActions({
			blockFill: (command, ctx) => this.fill(command.args, ctx),
			blockClear: (command, ctx) => this.clear(command.args, ctx),
			blockWrap: (command, ctx) => this.wrap(command.args, ctx),
			blockChangeOp: (command, ctx) => this.changeOp(command.args, ctx),
			blockSelectUnit: (command, ctx) => this.selectUnit(command.args?.node ?? command.args?.unit, ctx),
			blockApplyCompletion: (command, ctx) => this.applyCompletion(command.args, ctx),
			collapseStructural: (_command, ctx) => this.collapseStructural(ctx),
			deleteBackward: (_command, ctx) => this.handleDelete(-1, ctx),
			deleteForward: (_command, ctx) => this.handleDelete(1, ctx),
		});

		const compiled = this.compileInputRules(this.input);
		this._inputRules = compiled;
		if (compiled.length) editor.addInputRules(compiled);

		editor.root.addEventListener("CursorMove", this._onCursorMove);
		return this;
	}

	// Method: detach
	detach() {
		if (!this.editor) return this;
		this.editor.removeInputRules(this._inputRules);
		this._inputRules = [];
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		if (this.editor.scopeProvider === this) this.editor.scopeProvider = null;
		if (this.editor.blocks === this) delete this.editor.blocks;
		if (this.editor.blockSchema === this.schema) delete this.editor.blockSchema;
		this.editor = null;
		return this;
	}

	// Method: scopeNodes
	// Scope-provider hook: unit ladder for Editor.selectStructuralScope.
	scopeNodes(session = null) {
		return this.unitScopeNodes(session);
	}

	// Method: applyScopeSelection
	// Scope-provider hook: node-select a unit on the ladder.
	applyScopeSelection(node, session = null) {
		const ok = this.selectUnit(node, { session });
		if (ok) this.editor?.plugin("block-menus")?.hideAll?.({ keepChooser: false });
		return ok;
	}

	// Method: collapseScopeSelection
	// Scope-provider hook: exit outermost unit into an inner caret/hole.
	collapseScopeSelection(session = null) {
		const editor = this.editor;
		const env = { session: session ?? editor.localSession };
		const cursor = env.session.cursor;
		const focus =
			cursor.selectedNode?.querySelector?.(this.schema.selector("leaf")) ||
			this.closestLeaf(cursor.anchor) ||
			cursor.selectedNode;
		if (focus) this.placeCaretIn(focus, false, env);
		else cursor.moveTo(cursor.offset ?? 0);
		this.clearSelectedClass();
		return true;
	}

	// Method: enrichContext
	// Merges block-specific fields into editor.contextAt().
	enrichContext(ctx) {
		const blockCtx = this.buildContext(ctx.session, ctx);
		Object.assign(ctx, blockCtx);
	}

	// Method: buildContext
	// Resolves slot/block/leaf/op/unit/edge around the cursor.
	buildContext(session, base = {}) {
		const editor = this.editor;
		const root = editor.root;
		const schema = this.schema;
		const cursor = session?.cursor ?? editor.input.cursor;
		const selected =
			cursor.selectionKind === "node" && cursor.selectedNode?.isConnected
				? cursor.selectedNode
				: null;
		const anchor = cursor.anchor;
		const origin = selected ?? anchor;

		const hole = schema.closest(origin, "hole", root);
		const op = schema.closest(origin, "op", root);
		const leaf = schema.closest(origin, "leaf", root);
		const slot = schema.closest(origin, "slot", root);
		const block = schema.closest(origin, "block", root);

		const slotEmpty = !!(slot && schema.isEmptySlot(slot));
		const slotKind = slot?.dataset?.kind ?? (slotEmpty ? "empty" : null);

		let unit = null;
		if (selected && schema.isUnit(selected)) unit = selected;
		else if (hole) unit = hole;
		else if (leaf) unit = schema.closest(leaf, "slot", root) ?? leaf;
		else if (op) unit = schema.closest(op, "block", root) ?? op;
		else if (slot) unit = slot;
		else if (block) unit = block;

		const edge = this.edgeInLeaf(leaf, cursor);
		const role = selected ? schema.roleOf(selected) : schema.roleOf(origin);
		const selectedRole = selected ? schema.roleOf(selected) : null;

		return {
			...base,
			hole,
			op,
			leaf,
			slot,
			block,
			unit,
			slotEmpty,
			slotKind,
			edge,
			role,
			selectedRole,
			emptySlot: slotEmpty ? slot : null,
			isOpSelected: !!(selected && schema.hasRole(selected, "op")),
			isHoleSelected: !!(selected && schema.hasRole(selected, "hole")),
			isUnitSelected: !!(selected && schema.isUnit(selected)),
			inLeaf: !!leaf && cursor.selectionKind !== "node",
		};
	}

	// Method: edgeInLeaf
	// "start" | "end" | "inside" | null relative to an editable leaf.
	edgeInLeaf(leaf, cursor) {
		if (!leaf || cursor.selectionKind === "node") return null;
		const text = leaf.textContent ?? "";
		const len = text.length;
		let off = null;
		try {
			const point = this.editor.text.pointAt(cursor.offset ?? 0);
			if (!point) return null;
			if (!leaf.contains(point.node) && point.node !== leaf) return null;
			off = this.editor.text.offsetWithin(leaf, point);
		} catch {
			return null;
		}
		if (off == null) return null;
		if (off <= 0) return "start";
		if (off >= len) return "end";
		return "inside";
	}

	// Method: compileInputRules
	// Turns declarative rule objects into editor inputRules.
	compileInputRules(rules = []) {
		const out = [];
		for (const rule of rules) {
			if (!rule) continue;
			const action = rule.do;
			out.push({
				...rule,
				when: (ctx, event) => this.matchWhen(rule.when, ctx, event),
				do: (args, env) => this.runRuleAction(action, args, env, rule),
			});
		}
		return out;
	}

	// Method: matchWhen
	// Declarative context matcher for block rules (generic matcher + block domain keys).
	matchWhen(when, ctx, event) {
		return matchInputRuleWhen(when, ctx, event, { domain: blockWhenDomain });
	}

	// Method: runRuleAction
	// Dispatches a declarative or functional rule action.
	runRuleAction(action, args, env, rule) {
		const ctx = args.context ?? env.context;
		const event = args.event ?? env.event;
		const key = args.key ?? event?.key;

		if (typeof action === "function") {
			return action(args, env);
		}

		const name = typeof action === "string" ? action : action?.type;
		const extra = typeof action === "object" && action ? { ...action } : {};
		delete extra.type;

		switch (name) {
			case "fill": {
				const slot = ctx.emptySlot ?? ctx.slot;
				let as = args.as ?? extra.as ?? rule.as;
				if (as === "$key") as = this.schema.opFromKey(key) ?? key;
				if (as == null && rule.match) as = key;
				return this.fill(
					{
						slot,
						as,
						init: args.init ?? extra.init ?? key,
						focus: args.focus ?? extra.focus ?? rule.focus,
					},
					env,
				);
			}
			case "wrap": {
				const op = args.op ?? extra.op ?? this.schema.opFromKey(key) ?? key;
				let side = args.side ?? extra.side ?? rule.side;
				if (side == null) {
					if (event?.shiftKey) side = "before";
					else if (ctx.edge === "start") side = "before";
					else side = "after";
				}
				const unit = args.unit ?? this.resolveWrapUnit(ctx, side);
				return this.wrap({ unit, op, side }, env);
			}
			case "changeOp": {
				const op = args.op ?? extra.op ?? this.schema.opFromKey(key) ?? key;
				const block = args.block ?? ctx.block ?? (ctx.selected && this.closestBlock(ctx.selected));
				return this.changeOp({ block, op }, env);
			}
			case "clear": {
				const node = args.node ?? ctx.selected ?? ctx.unit ?? ctx.leaf ?? ctx.slot;
				return this.clear({ node }, env);
			}
			case "selectUnit":
				return this.selectUnit(args.node ?? args.unit ?? ctx.unit, env);
			case "openChooser":
				return this.editor.plugin("block-menus")?.showChooser?.(ctx.emptySlot ?? ctx.slot) ?? false;
			case "noop":
				return true;
			default:
				if (name) {
					return this.editor.action(
						{ type: name, args: { ...extra, ...args, key, context: ctx } },
						{ event, session: env.session },
					);
				}
				return false;
		}
	}

	// ------------------------------------------------------------------
	// DOM helpers
	// ------------------------------------------------------------------

	closestSlot(node) {
		return this.schema.closest(node, "slot", this.editor.root);
	}

	closestLeaf(node) {
		return this.schema.closest(node, "leaf", this.editor.root);
	}

	closestBlock(node) {
		return this.schema.closest(node, "block", this.editor.root);
	}

	closestHole(node) {
		return this.schema.closest(node, "hole", this.editor.root);
	}

	// Method: extractOperandNode
	// Normalizes a selection target into a wrappable slot/block node.
	extractOperandNode(node) {
		const root = this.editor.root;
		const schema = this.schema;
		if (!node || !root.contains(node)) return null;
		if (schema.hasRole(node, "op")) return this.closestBlock(node);
		if (schema.hasRole(node, "hole") || schema.hasRole(node, "leaf")) {
			return this.closestSlot(node);
		}
		if (schema.hasRole(node, "block")) {
			const parent = node.parentElement;
			if (schema.hasRole(parent, "slot") && parent.dataset.kind === "expr") return parent;
			return node;
		}
		if (schema.hasRole(node, "slot")) return node;
		return this.closestSlot(node) || this.closestBlock(node);
	}

	// Method: asBlockChildOperand
	// Ensures a block child is slot-shaped (nests bare blocks).
	asBlockChildOperand(node) {
		if (!node) return this.schema.make("empty");
		if (this.schema.hasRole(node, "block")) {
			if (typeof this.schema.nest === "function") return this.schema.nest(node);
			if (this.schema.has("nest")) return this.schema.make("nest", node);
			return node;
		}
		return node;
	}

	resolveWrapUnit(ctx, _sideHint = null) {
		const schema = this.schema;
		const cursor = ctx.cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const n = cursor.selectedNode;
			if (schema.hasRole(n, "op") || schema.hasRole(n, "hole")) return null;
			if (schema.hasToken(n, "empty")) return null;
			const unit = this.extractOperandNode(n);
			if (!unit || schema.hasToken(unit, "empty") || schema.isEmptySlot(unit)) return null;
			return unit;
		}
		const leaf = ctx.leaf ?? this.closestLeaf(cursor.anchor);
		if (leaf) {
			const slot = this.closestSlot(leaf);
			if (!slot || schema.isEmptySlot(slot)) return null;
			return slot;
		}
		const slot = ctx.slot ?? this.closestSlot(cursor.anchor);
		if (slot && !schema.isEmptySlot(slot)) return slot;
		const block = ctx.block ?? this.closestBlock(cursor.anchor);
		return block ?? null;
	}

	// ------------------------------------------------------------------
	// Selection
	// ------------------------------------------------------------------

	clearSelectedClass() {
		const cls = this._selectedClass;
		for (const node of this.editor.root.querySelectorAll(`.${cls}`)) {
			node.classList.remove(cls);
		}
	}

	markSelected(node) {
		this.clearSelectedClass();
		if (node?.isConnected && this.editor.root.contains(node)) {
			node.classList.add(this._selectedClass);
		}
	}

	onCursorMove(event) {
		const cursor = this.editor.input.cursor;
		const focusCls = this.schema.token("focus");
		const { previous, current } = event.detail ?? {};
		previous?.anchor?.classList?.remove(focusCls);
		current?.anchor?.classList?.add(focusCls);
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			this.markSelected(cursor.selectedNode);
		} else {
			this.clearSelectedClass();
		}
	}

	// Method: selectUnit
	// Selects a structural unit (atom/container/leaf) consistently.
	selectUnit(node, env = {}) {
		const editor = this.editor;
		const schema = this.schema;
		const cursor = env.session?.cursor ?? editor.input.cursor;
		if (!node?.isConnected || !editor.root.contains(node)) return false;
		editor.text.refresh();
		this.markSelected(node);
		try {
			if (schema.hasRole(node, "hole") || editor.text.isAtom(node)) {
				cursor.selectAtom(node);
				return true;
			}
			if (
				editor.text.isContainer(node) ||
				schema.hasRole(node, "slot") ||
				schema.hasRole(node, "block")
			) {
				cursor.selectContainer(node);
				return true;
			}
			if (schema.hasRole(node, "leaf")) {
				cursor.select(node, { kind: "container", side: "before", behavior: "enter" });
				return true;
			}
			cursor.selectNode(node);
			return true;
		} catch {
			return false;
		}
	}

	// Method: placeCaretIn
	// Puts the caret inside a leaf (or selects hole/unit fallback).
	placeCaretIn(node, atEnd = false, env = {}) {
		const editor = this.editor;
		const schema = this.schema;
		const cursor = env.session?.cursor ?? editor.input.cursor;
		editor.text.refresh();
		this.clearSelectedClass();
		if (!node) {
			cursor.moveTo(0);
			return true;
		}
		if (schema.hasRole(node, "slot") && node.dataset.kind === "empty") {
			const hole = node.querySelector(schema.selector("hole"));
			if (hole) return this.selectUnit(hole, env);
		}
		const leaf = schema.hasRole(node, "leaf") ? node : this.closestLeaf(node);
		const host = leaf ?? node;
		let text =
			host.nodeType === Node.TEXT_NODE
				? host
				: [...(host.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE) ?? null;
		if (!text && schema.hasRole(host, "leaf")) {
			text = document.createTextNode("");
			host.appendChild(text);
			editor.text.refresh();
		}
		if (text) {
			const point = { node: text, offset: atEnd ? text.data.length : 0 };
			const index = editor.text.indexOfPoint(point);
			if (index >= 0) {
				cursor.moveTo(index);
				return true;
			}
		}
		return this.selectUnit(host, env);
	}

	selectFilledUnit(next, env = {}) {
		const schema = this.schema;
		if (!next?.isConnected) return false;
		if (schema.isEmptySlot(next)) {
			const hole = next.querySelector(schema.selector("hole"));
			return this.selectUnit(hole ?? next, env);
		}
		if (next.dataset?.kind === "expr") {
			const block = next.querySelector(`:scope > ${schema.selector("block")}`);
			return this.selectUnit(block ?? next, env);
		}
		return this.selectUnit(next, env);
	}

	// Method: unitScopeNodes
	// Ladder of unit nodes from the current selection outward to root.
	unitScopeNodes(session = null) {
		const editor = this.editor;
		const schema = this.schema;
		const active = editor.activeSession(session);
		const cursor = active.cursor;
		let start = cursor.selectedNode;
		if (!start || !editor.root.contains(start)) {
			const anchor = cursor.anchor;
			start = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		}
		if (!start || !editor.root.contains(start)) return [];

		let cur = start;
		if (!schema.isUnit(cur)) {
			cur = cur.closest?.(schema.unitSelector()) ?? cur;
		}

		const scopes = [];
		while (cur && cur !== editor.root && editor.root.contains(cur)) {
			if (schema.isUnit(cur) && !scopes.includes(cur)) scopes.push(cur);
			cur = cur.parentElement;
		}
		const rootChild = editor.root.firstElementChild;
		if (rootChild && editor.root.contains(rootChild) && !scopes.includes(rootChild)) {
			scopes.push(rootChild);
		}
		return scopes;
	}

	// Method: collapseStructural
	// Escape: exit node selection into an inner caret/hole.
	collapseStructural(env = {}) {
		const editor = this.editor;
		const schema = this.schema;
		const cursor = env.session?.cursor ?? editor.input.cursor;
		const menus = editor.plugin("block-menus");
		if (menus?.hasOpen?.()) {
			menus.hideAll?.({ suppress: true });
			return true;
		}
		if (cursor.selectionKind !== "node" || !cursor.selectedNode) return false;
		const n = cursor.selectedNode;
		if (schema.hasRole(n, "op")) {
			menus?.hideOpMenu?.();
			const block = this.closestBlock(n);
			const leaf = block?.querySelector(schema.selector("leaf"));
			if (leaf) this.placeCaretIn(leaf, false, env);
			else cursor.moveTo(cursor.offset ?? 0);
			this.clearSelectedClass();
			return true;
		}
		const inner =
			n.querySelector?.(schema.selector("leaf")) ||
			n.querySelector?.(schema.selector("hole")) ||
			this.closestLeaf(n);
		if (inner && schema.hasRole(inner, "hole")) {
			const slot = this.closestSlot(inner);
			if (slot) menus?.suppressChooserFor?.(slot);
			this.selectUnit(inner, env);
		} else if (inner) {
			this.placeCaretIn(inner, false, env);
		} else {
			cursor.moveTo(cursor.offset ?? 0);
			this.clearSelectedClass();
		}
		return true;
	}

	// ------------------------------------------------------------------
	// Transforms
	// ------------------------------------------------------------------

	notifyChange() {
		this.onChange?.(this.editor);
	}

	afterMutate(_env = {}) {
		this.editor.text.refresh();
		this.notifyChange();
	}

	// Method: replaceNode
	// Swaps a node and applies focus policy.
	replaceNode(node, next, options = {}, env = {}) {
		const schema = this.schema;
		if (!node?.parentNode || !next) return null;
		node.replaceWith(next);
		this.retouchNested();
		this.afterMutate(env);
		const focus = options.focus ?? "select";
		const leafSel = schema.selector("leaf");
		const emptySlotSel = schema.selector("slot", "empty");
		const holeSel = schema.selector("hole");
		if (focus === "edit" || focus === true) {
			const target =
				next.querySelector?.(leafSel) || next.querySelector?.(emptySlotSel) || next;
			this.placeCaretIn(target, true, env);
			if (options.edit === "var" || options.complete) {
				const leaf = this.closestLeaf(target) ?? next.querySelector?.(leafSel);
				if (leaf) this.editor.plugin("block-menus")?.showComplete?.(leaf);
			}
		} else if (focus === "hole") {
			const hole = next.querySelector?.(holeSel) ?? next;
			this.selectUnit(hole, env);
		} else {
			this.selectFilledUnit(next, env);
			if (next.dataset?.kind === "var") {
				const leaf = next.querySelector?.(`${leafSel}.var`);
				if (leaf && !(leaf.textContent ?? "").trim()) {
					this.editor.plugin("block-menus")?.showComplete?.(leaf);
				}
			}
			if (schema.isEmptySlot(next) || schema.hasToken(next, "empty")) {
				this.editor.plugin("block-menus")?.showChooser?.(next);
			} else if (next.dataset?.kind === "expr" && next.querySelector?.(emptySlotSel)) {
				const empty = next.querySelector(emptySlotSel);
				const hole = empty?.querySelector(holeSel);
				if (hole) {
					this.selectUnit(hole, env);
					this.editor.plugin("block-menus")?.showChooser?.(empty);
				}
			}
		}
		return next;
	}

	retouchNested() {
		const root = this.editor.root;
		const schema = this.schema;
		const nestedTok = schema.token("nested");
		const blockSel = schema.selector("block");
		const emptySlotSel = schema.selector("slot", "empty");
		const holeSel = schema.selector("hole");
		for (const block of root.querySelectorAll(blockSel)) {
			const parent = block.parentElement;
			const inExpr = schema.hasRole(parent, "slot") && parent?.dataset?.kind === "expr";
			block.classList.toggle(
				nestedTok,
				inExpr || !!parent?.closest?.(blockSel),
			);
		}
		for (const slot of root.querySelectorAll(emptySlotSel)) {
			if (!slot.querySelector(`:scope > ${holeSel}`)) {
				slot.replaceChildren(
					el("span", schema.classes("hole", "atom"), { text: "⬚" }),
				);
			}
		}
	}

	// Method: fill
	// Fills an empty slot with a created kind.
	fill(args = {}, env = {}) {
		const schema = this.schema;
		const slot = args.slot;
		if (!slot || !schema.isEmptySlot(slot)) return false;
		const as = args.as;
		if (as == null) return false;
		this.editor.plugin("block-menus")?.hideChooser?.();
		let next = null;
		if (schema.has(as)) {
			const init = args.init;
			next =
				init != null && as !== init
					? schema.make(as, init)
					: schema.make(as);
		} else if (schema.shape(as) || schema.has("binary") || schema.has("unary")) {
			const shape = schema.shape(as);
			if (shape?.kind === "unary" || as === "neg") {
				next = schema.has("unary") ? schema.make("unary", as) : schema.make(as);
			} else {
				next = schema.has("binary") ? schema.make("binary", as) : schema.make(as);
			}
			if (schema.nest && schema.hasRole(next, "block")) {
				next = schema.nest(next);
			} else if (schema.has("nest") && schema.hasRole(next, "block")) {
				next = schema.make("nest", next);
			}
		} else {
			return false;
		}
		const focus =
			args.focus ??
			(as === "number" || as === "var" ? "edit" : "select");
		const edit = as === "var" ? "var" : as === "number" ? "number" : undefined;
		this.replaceNode(slot, next, { focus, edit, complete: as === "var" }, env);
		return true;
	}

	// Method: clear
	// Clears a unit back to an empty hole, preserving parent structure.
	clear(args = {}, env = {}) {
		const schema = this.schema;
		const node = args.node;
		const root = this.editor.root;
		if (!node || !root.contains(node)) return false;
		const cursor = env.session?.cursor ?? this.editor.input.cursor;
		cursor._structuralScopeNode = null;
		cursor._structuralScopePath = null;

		if (schema.hasRole(node, "hole")) {
			const slot = this.closestSlot(node);
			if (slot) {
				this.selectUnit(node, env);
				this.editor.plugin("block-menus")?.showChooser?.(slot);
			}
			return true;
		}
		if (schema.hasRole(node, "op")) {
			const block = this.closestBlock(node);
			if (block) return this.clear({ node: block }, env);
			return false;
		}
		if (schema.hasRole(node, "leaf")) {
			const slot = this.closestSlot(node);
			if (slot) {
				this.replaceNode(slot, schema.make("empty"), { focus: "hole" }, env);
				this.editor.plugin("block-menus")?.showChooser?.(
					this.closestSlot(cursor.selectedNode) ?? slot,
				);
				return true;
			}
			return false;
		}
		if (schema.hasRole(node, "slot")) {
			this.replaceNode(node, schema.make("empty"), { focus: "hole" }, env);
			return true;
		}
		if (schema.hasRole(node, "block")) {
			const parent = node.parentElement;
			if (schema.hasRole(parent, "slot") && parent.dataset.kind === "expr") {
				this.replaceNode(parent, schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
			if (parent === root) {
				this.replaceNode(node, schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
			const slot = this.closestSlot(node);
			if (slot) {
				this.replaceNode(slot, schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
		}
		return false;
	}

	// Method: changeOp
	// Changes a block's operator, reshaping unary↔binary when needed.
	changeOp(args = {}, env = {}) {
		const schema = this.schema;
		const block = args.block ?? args.form;
		const newOp = args.op;
		if (!block || !schema.hasRole(block, "block") || !newOp) return false;
		const prev = block.dataset.op;
		const labelOf = (op) => schema.shape(op)?.label ?? op;
		const opSel = `:scope > ${schema.selector("op")}`;
		const opAtom = schema.classes("op", "atom");

		if (prev === "neg" && newOp !== "neg") {
			const slots = [...block.children].filter((c) => schema.hasRole(c, "slot"));
			const operand = slots[0] ?? schema.make("empty");
			block.dataset.op = newOp;
			block.replaceChildren(
				operand,
				el("span", opAtom, { "data-op": newOp, text: labelOf(newOp) }),
				schema.make("empty"),
			);
			this.retouchNested();
			this.afterMutate(env);
			this.selectUnit(block.querySelector(opSel), env);
			return true;
		}

		if (prev !== "neg" && newOp === "neg") {
			const slots = [...block.children].filter((c) => schema.hasRole(c, "slot"));
			const left = slots[0] ?? schema.make("empty");
			block.dataset.op = "neg";
			block.replaceChildren(
				el("span", opAtom, { "data-op": "neg", text: labelOf("neg") }),
				left,
			);
			this.retouchNested();
			this.afterMutate(env);
			this.selectUnit(block.querySelector(opSel), env);
			return true;
		}

		block.dataset.op = newOp;
		const opEl = block.querySelector(opSel);
		if (opEl) {
			opEl.dataset.op = newOp;
			opEl.textContent = labelOf(newOp);
		}
		this.notifyChange();
		if (opEl) this.selectUnit(opEl, env);
		return true;
	}

	// Method: wrap
	// Wraps a unit with a binary block on the given side.
	wrap(args = {}, env = {}) {
		const schema = this.schema;
		const unit = args.unit;
		const op = args.op;
		const side = args.side === "before" ? "before" : "after";
		if (!unit?.parentNode || !op) return false;
		if (schema.hasToken(unit, "empty") || schema.isEmptySlot(unit)) return false;

		const node = this.extractOperandNode(unit) ?? unit;
		if (!node?.parentNode || schema.hasToken(node, "empty") || schema.isEmptySlot(node)) {
			return false;
		}

		const marker = document.createElement("span");
		marker.className = "skipped wrap-marker";
		node.replaceWith(marker);

		const empty = schema.make("empty");
		const left = side === "after" ? this.asBlockChildOperand(node) : empty;
		const right = side === "before" ? this.asBlockChildOperand(node) : empty;
		const label = schema.shape(op)?.label ?? op;
		const block = el("span", schema.classes("block", "container"), { "data-op": op });
		block.append(
			left,
			el("span", schema.classes("op", "atom"), { "data-op": op, text: label }),
			right,
		);

		const parent = marker.parentElement;
		let replacement = block;
		if (parent && parent !== this.editor.root && schema.hasRole(parent, "block")) {
			if (typeof schema.nest === "function") replacement = schema.nest(block);
			else if (schema.has("nest")) replacement = schema.make("nest", block);
		}

		marker.replaceWith(replacement);
		this.retouchNested();
		this.afterMutate(env);

		const sideNode = side === "after" ? right : left;
		const focusEmpty =
			schema.isEmptySlot(sideNode) || schema.hasToken(sideNode, "empty")
				? sideNode
				: replacement.querySelector?.(schema.selector("slot", "empty"));
		if (focusEmpty) {
			const hole = focusEmpty.querySelector?.(schema.selector("hole"));
			if (hole) this.selectUnit(hole, env);
			else this.selectUnit(focusEmpty, env);
			this.editor.plugin("block-menus")?.showChooser?.(focusEmpty, { force: true });
		} else {
			this.selectUnit(
				block.querySelector(`:scope > ${schema.selector("op")}`) || block,
				env,
			);
		}
		return true;
	}

	// Method: applyCompletion
	// Writes a completion string into the active var leaf.
	applyCompletion(args = {}, env = {}) {
		const leaf = args.leaf ?? this.buildContext(env.session).leaf;
		const value = args.value ?? args.name;
		if (!leaf?.isConnected || value == null) return false;
		leaf.textContent = value;
		if (!leaf.firstChild) leaf.appendChild(document.createTextNode(value));
		if (leaf.classList.contains("var")) leaf.dataset.name = value;
		this.afterMutate(env);
		this.editor.plugin("block-menus")?.hideComplete?.();
		const slot = this.closestSlot(leaf);
		if (args.focus === "edit") this.placeCaretIn(leaf, true, env);
		else this.selectUnit(slot ?? leaf, env);
		return true;
	}

	// Method: handleDelete
	// Structure-preserving delete/backspace.
	handleDelete(direction, env = {}) {
		return this.editor.history.run("delete", () => this._handleDelete(direction, env), env.session);
	}

	_handleDelete(direction, env = {}) {
		const editor = this.editor;
		const schema = this.schema;
		const cursor = env.session?.cursor ?? editor.input.cursor;
		const menus = editor.plugin("block-menus");
		menus?.hideChooser?.();

		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			menus?.hideComplete?.();
			return this.clear({ node: cursor.selectedNode }, env);
		}

		if (cursor.selectionKind === "range" && cursor.selection?.isActive) {
			const start = cursor.selection.start;
			const end = cursor.selection.end;
			const a = this.closestLeaf(editor.text.pointAt(start)?.node);
			const b = this.closestLeaf(editor.text.pointAt(end)?.node);
			if (a && a === b) {
				const next = cursor.selection.replaceWithText("");
				editor.text.refresh();
				if (next) cursor.moveTo(next.index);
				this.afterLeafEdit(a, env);
				return true;
			}
			menus?.hideComplete?.();
			const block = this.closestBlock(cursor.anchor);
			const slot = this.closestSlot(cursor.anchor);
			return this.clear({ node: block ?? slot ?? a ?? b }, env);
		}

		const leaf = this.closestLeaf(cursor.anchor);
		if (!leaf) {
			if (cursor.selectedNode) return this.clear({ node: cursor.selectedNode }, env);
			const slot = this.closestSlot(cursor.anchor);
			if (slot && schema.isEmptySlot(slot)) return true;
			const block = this.closestBlock(cursor.anchor);
			return this.clear({ node: block ?? slot }, env);
		}

		const text = leaf.textContent ?? "";
		const edge = this.edgeInLeaf(leaf, cursor);
		const atStart = edge === "start";
		const atEnd = edge === "end";

		if (text.length <= 1) {
			menus?.hideComplete?.();
			return this.clear({ node: leaf }, env);
		}

		if (direction < 0) {
			if (atStart) {
				menus?.hideComplete?.();
				return this.clear({ node: leaf }, env);
			}
			cursor.backspace();
			this.afterLeafEdit(leaf, env);
			return true;
		}

		if (atEnd) {
			menus?.hideComplete?.();
			return this.clear({ node: leaf }, env);
		}
		cursor.delete();
		this.afterLeafEdit(leaf, env);
		return true;
	}

	afterLeafEdit(leaf, env = {}) {
		if (!leaf?.isConnected) return;
		const text = leaf.textContent ?? "";
		if (text === "") {
			this.clear({ node: leaf }, env);
			this.editor.plugin("block-menus")?.hideComplete?.();
			return;
		}
		if (leaf.classList.contains("var")) {
			this.editor.plugin("block-menus")?.showComplete?.(leaf);
		}
		this.notifyChange();
	}
}


export { Blocks };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: blocks
// Declarative structural-block editing: role schema, transforms, input rules, menus.


export { el as blockEl };
