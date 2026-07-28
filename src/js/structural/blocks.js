// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: blocks
// Declarative structural-block editing: role schema, transforms, input rules, menus.

import { editorKeymap } from "./editor.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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

function asElement(node) {
	if (!node) return null;
	return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function closestMatch(node, predicate, root) {
	let el = asElement(node);
	while (el && el !== root && root?.contains?.(el) !== false) {
		if (predicate(el)) return el;
		el = el.parentElement;
	}
	if (el && predicate(el)) return el;
	return null;
}

// ----------------------------------------------------------------------------
// BlockSchema
// ----------------------------------------------------------------------------

// Class: BlockSchema
// Role-oriented schema for slot/block/leaf documents. Create fns stay app-owned.
class BlockSchema {
	constructor(def = {}) {
		this.def = def;
		this.units = def.units ?? [".hole", ".op", ".leaf", ".slot", ".block"];
		this.roles = def.roles ?? {};
		this.create = def.create ?? {};
		this.shapes = def.shapes ?? {};
		this.nest = typeof def.nest === "function" ? def.nest : null;
		this.ops = def.ops ?? null;
		this.choices = def.choices ?? null;
	}

	// Method: make
	// Invokes a registered create(kind) factory.
	make(kind, ...args) {
		const fn = this.create[kind];
		if (typeof fn !== "function") {
			throw new Error(`BlockSchema: unknown create kind "${kind}"`);
		}
		return fn(...args);
	}

	// Method: has
	// True when a create factory is registered for kind.
	has(kind) {
		return typeof this.create[kind] === "function";
	}

	// Method: shape
	// Returns shape descriptor for an operator id.
	shape(op) {
		return this.shapes[op] ?? null;
	}

	// Method: opFromKey
	// Maps a keyboard key to an operator id using shapes/ops.
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

	// Method: roleOf
	// Resolves the structural role name for a DOM node.
	roleOf(node) {
		const el = asElement(node);
		if (!el?.classList) return null;
		if (el.classList.contains("hole")) return "hole";
		if (el.classList.contains("op")) return "op";
		if (el.classList.contains("leaf")) return "leaf";
		if (el.classList.contains("slot")) return "slot";
		if (el.classList.contains("block")) return "block";
		for (const [name, rule] of Object.entries(this.roles)) {
			if (typeof rule?.match === "function" && rule.match(el)) return name;
			if (typeof rule?.selector === "string" && el.matches?.(rule.selector)) return name;
		}
		return null;
	}

	// Method: isUnit
	// True when node participates in the structural scope ladder.
	isUnit(node) {
		const el = asElement(node);
		if (!el) return false;
		const role = this.roleOf(el);
		if (role && this.roles[role]?.type === "unit") return true;
		if (role === "hole" || role === "op" || role === "leaf" || role === "slot" || role === "block") {
			return true;
		}
		return this.units.some((sel) => {
			try {
				return el.matches?.(sel);
			} catch {
				return el.classList?.contains?.(sel.replace(/^\./, ""));
			}
		});
	}

	// Method: unitSelector
	// CSS selector union for unit nodes.
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

// ----------------------------------------------------------------------------
// Blocks plugin
// ----------------------------------------------------------------------------

// Class: Blocks
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
		this._selectedClass = options.selectedClass ?? "selected";
	}

	// Method: attach
	// Installs actions, input rules, and cursor styling on the editor.
	attach(editor) {
		this.editor = editor;
		editor.blocks = this;
		editor.blockSchema = this.schema;

		editor.configureActions({
			blockFill: (command, ctx) => this.fill(command.args, ctx),
			blockClear: (command, ctx) => this.clear(command.args, ctx),
			blockWrap: (command, ctx) => this.wrap(command.args, ctx),
			blockChangeOp: (command, ctx) => this.changeOp(command.args, ctx),
			blockSelectUnit: (command, ctx) => this.selectUnit(command.args?.node ?? command.args?.unit, ctx),
			blockApplyCompletion: (command, ctx) => this.applyCompletion(command.args, ctx),
			selectStructuralScope: (command, ctx) =>
				this.selectStructuralScope(command.args?.mode === "contract" ? "contract" : "expand", ctx),
			collapseStructural: (_command, ctx) => this.collapseStructural(ctx),
			deleteBackward: (_command, ctx) => this.handleDelete(-1, ctx),
			deleteForward: (_command, ctx) => this.handleDelete(1, ctx),
		});

		const compiled = this.compileInputRules(this.input);
		if (compiled.length) editor.addInputRules(compiled);

		editor.root.addEventListener("CursorMove", this._onCursorMove);
		return this;
	}

	// Method: detach
	detach() {
		if (!this.editor) return this;
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		if (this.editor.blocks === this) delete this.editor.blocks;
		if (this.editor.blockSchema === this.schema) delete this.editor.blockSchema;
		this.editor = null;
		return this;
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
		const cursor = session?.cursor ?? editor.input.cursor;
		const selected =
			cursor.selectionKind === "node" && cursor.selectedNode?.isConnected
				? cursor.selectedNode
				: null;
		const anchor = cursor.anchor;
		const origin = selected ?? anchor;

		const hole = closestMatch(origin, (n) => n.classList?.contains("hole"), root);
		const op = closestMatch(origin, (n) => n.classList?.contains("op"), root);
		const leaf = closestMatch(origin, (n) => n.classList?.contains("leaf"), root);
		const slot = closestMatch(origin, (n) => n.classList?.contains("slot"), root);
		const block = closestMatch(origin, (n) => n.classList?.contains("block"), root);

		const slotEmpty = !!(slot && slot.classList.contains("empty"));
		const slotKind = slot?.dataset?.kind ?? (slotEmpty ? "empty" : null);

		let unit = null;
		if (selected && this.schema.isUnit(selected)) unit = selected;
		else if (hole) unit = hole;
		else if (leaf) unit = closestMatch(leaf, (n) => n.classList?.contains("slot"), root) ?? leaf;
		else if (op) unit = closestMatch(op, (n) => n.classList?.contains("block"), root) ?? op;
		else if (slot) unit = slot;
		else if (block) unit = block;

		const edge = this.edgeInLeaf(leaf, cursor);
		const role = selected ? this.schema.roleOf(selected) : this.schema.roleOf(origin);
		const selectedRole = selected ? this.schema.roleOf(selected) : null;

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
			isOpSelected: !!(selected && selected.classList.contains("op")),
			isHoleSelected: !!(selected && selected.classList.contains("hole")),
			isUnitSelected: !!(selected && this.schema.isUnit(selected)),
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
	// Declarative context matcher for block rules.
	matchWhen(when, ctx, event) {
		if (when == null) return true;
		if (typeof when === "function") return !!when(ctx, event);
		if (typeof when !== "object") return !!when;

		if (when.slot != null) {
			if (when.slot === "empty" || when.slot === true) {
				if (!ctx.slotEmpty && !ctx.emptySlot) return false;
			} else if (typeof when.slot === "string") {
				if (ctx.slotKind !== when.slot && !(when.slot === "empty" && ctx.slotEmpty)) return false;
			}
		}
		if (when.slotEmpty != null && !!ctx.slotEmpty !== !!when.slotEmpty) return false;
		if (when.selected != null) {
			const sel = when.selected;
			if (sel === "op" && !ctx.isOpSelected) return false;
			else if (sel === "hole" && !ctx.isHoleSelected) return false;
			else if (sel === "unit" && !ctx.isUnitSelected) return false;
			else if (sel === "node" && ctx.selectionKind !== "node") return false;
			else if (typeof sel === "string" && sel !== "op" && sel !== "hole" && sel !== "unit" && sel !== "node") {
				if (ctx.selectedRole !== sel && !ctx.selected?.classList?.contains?.(sel)) return false;
			} else if (sel === true && ctx.selectionKind !== "node") return false;
		}
		if (when.unit != null) {
			if (when.unit === true && !ctx.unit) return false;
			if (when.unit === false && ctx.unit) return false;
		}
		if (when.edge != null) {
			if (when.edge === "start" && ctx.edge !== "start") return false;
			if (when.edge === "end" && ctx.edge !== "end") return false;
			if (when.edge === "inside" && ctx.edge !== "inside") return false;
			if (when.edge === "boundary" && ctx.edge !== "start" && ctx.edge !== "end") return false;
		}
		if (when.leaf != null) {
			if (when.leaf === true && !ctx.leaf) return false;
			if (when.leaf === false && ctx.leaf) return false;
			if (typeof when.leaf === "string" && !ctx.leaf?.classList?.contains?.(when.leaf)) return false;
		}
		if (when.inLeaf != null && !!ctx.inLeaf !== !!when.inLeaf) return false;
		if (when.block != null) {
			if (when.block === true && !ctx.block) return false;
			if (typeof when.block === "string" && ctx.block?.dataset?.op !== when.block) return false;
		}
		if (when.role != null && ctx.role !== when.role && ctx.selectedRole !== when.role) return false;
		if (when.not) {
			if (this.matchWhen(when.not, ctx, event)) return false;
		}
		if (when.or) {
			const list = Array.isArray(when.or) ? when.or : [when.or];
			if (!list.some((item) => this.matchWhen(item, ctx, event))) return false;
		}
		// Custom predicate
		if (typeof when.test === "function" && !when.test(ctx, event)) return false;
		return true;
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
		return closestMatch(node, (n) => n.classList?.contains("slot"), this.editor.root);
	}

	closestLeaf(node) {
		return closestMatch(node, (n) => n.classList?.contains("leaf"), this.editor.root);
	}

	closestBlock(node) {
		return closestMatch(node, (n) => n.classList?.contains("block"), this.editor.root);
	}

	closestHole(node) {
		return closestMatch(node, (n) => n.classList?.contains("hole"), this.editor.root);
	}

	// Method: extractOperandNode
	// Normalizes a selection target into a wrappable slot/block node.
	extractOperandNode(node) {
		const root = this.editor.root;
		if (!node || !root.contains(node)) return null;
		if (node.classList.contains("op")) return this.closestBlock(node);
		if (node.classList.contains("hole") || node.classList.contains("leaf")) {
			return this.closestSlot(node);
		}
		if (node.classList.contains("block")) {
			const parent = node.parentElement;
			if (parent?.classList.contains("slot") && parent.dataset.kind === "expr") return parent;
			return node;
		}
		if (node.classList.contains("slot")) return node;
		return this.closestSlot(node) || this.closestBlock(node);
	}

	// Method: asBlockChildOperand
	// Ensures a block child is slot-shaped (nests bare blocks).
	asBlockChildOperand(node) {
		if (!node) return this.schema.make("empty");
		if (node.classList.contains("block")) {
			if (typeof this.schema.nest === "function") return this.schema.nest(node);
			if (this.schema.has("nest")) return this.schema.make("nest", node);
			return node;
		}
		return node;
	}

	resolveWrapUnit(ctx, sideHint = null) {
		const cursor = ctx.cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const n = cursor.selectedNode;
			if (n.classList.contains("op") || n.classList.contains("hole")) return null;
			if (n.classList.contains("empty")) return null;
			const unit = this.extractOperandNode(n);
			if (!unit || unit.classList.contains("empty")) return null;
			return unit;
		}
		const leaf = ctx.leaf ?? this.closestLeaf(cursor.anchor);
		if (leaf) {
			const slot = this.closestSlot(leaf);
			if (!slot || slot.classList.contains("empty")) return null;
			return slot;
		}
		const slot = ctx.slot ?? this.closestSlot(cursor.anchor);
		if (slot && !slot.classList.contains("empty")) return slot;
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
		const { previous, current } = event.detail ?? {};
		previous?.anchor?.classList?.remove("focus");
		current?.anchor?.classList?.add("focus");
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
		const cursor = env.session?.cursor ?? editor.input.cursor;
		if (!node?.isConnected || !editor.root.contains(node)) return false;
		editor.text.refresh();
		this.markSelected(node);
		try {
			if (node.classList.contains("hole") || editor.text.isAtom(node)) {
				cursor.selectAtom(node);
				return true;
			}
			if (
				editor.text.isContainer(node) ||
				node.classList.contains("slot") ||
				node.classList.contains("block")
			) {
				cursor.selectContainer(node);
				return true;
			}
			if (node.classList.contains("leaf")) {
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
		const cursor = env.session?.cursor ?? editor.input.cursor;
		editor.text.refresh();
		this.clearSelectedClass();
		if (!node) {
			cursor.moveTo(0);
			return true;
		}
		if (node.classList?.contains("slot") && node.dataset.kind === "empty") {
			const hole = node.querySelector(".hole");
			if (hole) return this.selectUnit(hole, env);
		}
		const leaf = node.classList?.contains("leaf") ? node : this.closestLeaf(node);
		const host = leaf ?? node;
		let text =
			host.nodeType === Node.TEXT_NODE
				? host
				: [...(host.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE) ?? null;
		if (!text && host.classList?.contains("leaf")) {
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
		if (!next?.isConnected) return false;
		if (next.classList.contains("slot") && next.classList.contains("empty")) {
			const hole = next.querySelector(".hole");
			return this.selectUnit(hole ?? next, env);
		}
		if (next.dataset?.kind === "expr") {
			const block = next.querySelector(":scope > .block");
			return this.selectUnit(block ?? next, env);
		}
		return this.selectUnit(next, env);
	}

	// Method: unitScopeNodes
	// Ladder of unit nodes from the current selection outward to root.
	unitScopeNodes(session = null) {
		const editor = this.editor;
		const active = editor.activeSession(session);
		const cursor = active.cursor;
		let start = cursor.selectedNode;
		if (!start || !editor.root.contains(start)) {
			const anchor = cursor.anchor;
			start = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		}
		if (!start || !editor.root.contains(start)) return [];

		let el = start;
		if (!this.schema.isUnit(el)) {
			el = el.closest?.(this.schema.unitSelector()) ?? el;
		}

		const scopes = [];
		while (el && el !== editor.root && editor.root.contains(el)) {
			if (this.schema.isUnit(el) && !scopes.includes(el)) scopes.push(el);
			el = el.parentElement;
		}
		const rootChild = editor.root.firstElementChild;
		if (rootChild && editor.root.contains(rootChild) && !scopes.includes(rootChild)) {
			scopes.push(rootChild);
		}
		return scopes;
	}

	// Method: selectStructuralScope
	// Expands/contracts node selection along the unit ladder (Mod+A).
	selectStructuralScope(mode = "expand", env = {}) {
		const editor = this.editor;
		const session = env.session ?? editor.localSession;
		const cursor = session.cursor;
		const scopes = this.unitScopeNodes(session);
		if (!scopes.length) return false;

		const stored = cursor._structuralScopePath?.filter((n) => n?.isConnected);
		const path = stored?.length ? stored : scopes;
		const usePath = path.length && path.some((n) => scopes.includes(n)) ? path : scopes;

		let currentIdx = usePath.indexOf(cursor._structuralScopeNode);
		if (currentIdx < 0 && cursor.selectedNode) {
			currentIdx = usePath.indexOf(cursor.selectedNode);
		}
		if (currentIdx < 0) {
			currentIdx = usePath.findIndex((n) => scopes[0] === n);
		}

		if (mode === "contract") {
			if (currentIdx <= 0) {
				const focus =
					cursor.selectedNode?.querySelector?.(".leaf") ||
					this.closestLeaf(cursor.anchor) ||
					cursor.selectedNode;
				if (focus) this.placeCaretIn(focus, false, env);
				else cursor.moveTo(cursor.offset ?? 0);
				cursor._structuralScopeNode = null;
				cursor._structuralScopePath = null;
				this.clearSelectedClass();
				return true;
			}
			currentIdx -= 1;
		} else {
			currentIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, usePath.length - 1);
		}

		const target = usePath[currentIdx];
		if (!target?.isConnected) return false;
		cursor._structuralScopeNode = target;
		cursor._structuralScopePath = usePath;
		this.editor.plugin("block-menus")?.hideAll?.({ keepChooser: false });
		return this.selectUnit(target, env);
	}

	// Method: collapseStructural
	// Escape: exit node selection into an inner caret/hole.
	collapseStructural(env = {}) {
		const editor = this.editor;
		const cursor = env.session?.cursor ?? editor.input.cursor;
		const menus = editor.plugin("block-menus");
		if (menus?.hasOpen?.()) {
			menus.hideAll?.({ suppress: true });
			return true;
		}
		if (cursor.selectionKind !== "node" || !cursor.selectedNode) return false;
		const n = cursor.selectedNode;
		if (n.classList.contains("op")) {
			menus?.hideOpMenu?.();
			const block = this.closestBlock(n);
			const leaf = block?.querySelector(".leaf");
			if (leaf) this.placeCaretIn(leaf, false, env);
			else cursor.moveTo(cursor.offset ?? 0);
			this.clearSelectedClass();
			return true;
		}
		const inner =
			n.querySelector?.(".leaf") || n.querySelector?.(".hole") || this.closestLeaf(n);
		if (inner?.classList?.contains("hole")) {
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

	afterMutate(env = {}) {
		this.editor.text.refresh();
		this.notifyChange();
	}

	// Method: replaceNode
	// Swaps a node and applies focus policy.
	replaceNode(node, next, options = {}, env = {}) {
		if (!node?.parentNode || !next) return null;
		node.replaceWith(next);
		this.retouchNested();
		this.afterMutate(env);
		const focus = options.focus ?? "select";
		if (focus === "edit" || focus === true) {
			const target =
				next.querySelector?.(".leaf") || next.querySelector?.(".slot.empty") || next;
			this.placeCaretIn(target, true, env);
			if (options.edit === "var" || options.complete) {
				const leaf = this.closestLeaf(target) ?? next.querySelector?.(".leaf");
				if (leaf) this.editor.plugin("block-menus")?.showComplete?.(leaf);
			}
		} else if (focus === "hole") {
			const hole = next.querySelector?.(".hole") ?? next;
			this.selectUnit(hole, env);
		} else {
			this.selectFilledUnit(next, env);
			if (next.dataset?.kind === "var") {
				const leaf = next.querySelector?.(".leaf.var");
				if (leaf && !(leaf.textContent ?? "").trim()) {
					this.editor.plugin("block-menus")?.showComplete?.(leaf);
				}
			}
			if (next.classList?.contains("empty")) {
				this.editor.plugin("block-menus")?.showChooser?.(next);
			} else if (next.dataset?.kind === "expr" && next.querySelector?.(".slot.empty")) {
				const empty = next.querySelector(".slot.empty");
				const hole = empty?.querySelector(".hole");
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
		for (const block of root.querySelectorAll(".block")) {
			const inExpr =
				block.parentElement?.classList?.contains("slot") &&
				block.parentElement.dataset.kind === "expr";
			block.classList.toggle("nested", inExpr || !!block.parentElement?.closest?.(".block"));
		}
		for (const slot of root.querySelectorAll(".slot.empty")) {
			if (!slot.querySelector(":scope > .hole")) {
				slot.replaceChildren(el("span", "hole atom", { text: "⬚" }));
			}
		}
	}

	// Method: fill
	// Fills an empty slot with a created kind.
	fill(args = {}, env = {}) {
		const slot = args.slot;
		if (!slot?.classList?.contains("empty")) return false;
		const as = args.as;
		if (as == null) return false;
		this.editor.plugin("block-menus")?.hideChooser?.();
		let next = null;
		if (this.schema.has(as)) {
			const init = args.init;
			// Prefer (init) when provided and factory accepts it.
			next =
				init != null && as !== init
					? this.schema.make(as, init)
					: this.schema.make(as);
		} else if (this.schema.shape(as) || this.schema.has("binary") || this.schema.has("unary")) {
			const shape = this.schema.shape(as);
			if (shape?.kind === "unary" || as === "neg") {
				next = this.schema.has("unary")
					? this.schema.make("unary", as)
					: this.schema.make(as);
			} else {
				next = this.schema.has("binary")
					? this.schema.make("binary", as)
					: this.schema.make(as);
			}
			if (this.schema.nest && next?.classList?.contains("block")) {
				next = this.schema.nest(next);
			} else if (this.schema.has("nest") && next?.classList?.contains("block")) {
				next = this.schema.make("nest", next);
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
		const node = args.node;
		const root = this.editor.root;
		if (!node || !root.contains(node)) return false;
		const cursor = env.session?.cursor ?? this.editor.input.cursor;
		cursor._structuralScopeNode = null;
		cursor._structuralScopePath = null;

		if (node.classList?.contains("hole")) {
			const slot = this.closestSlot(node);
			if (slot) {
				this.selectUnit(node, env);
				this.editor.plugin("block-menus")?.showChooser?.(slot);
			}
			return true;
		}
		if (node.classList?.contains("op")) {
			const block = this.closestBlock(node);
			if (block) return this.clear({ node: block }, env);
			return false;
		}
		if (node.classList?.contains("leaf")) {
			const slot = this.closestSlot(node);
			if (slot) {
				this.replaceNode(slot, this.schema.make("empty"), { focus: "hole" }, env);
				this.editor.plugin("block-menus")?.showChooser?.(this.closestSlot(cursor.selectedNode) ?? slot);
				return true;
			}
			return false;
		}
		if (node.classList?.contains("slot")) {
			this.replaceNode(node, this.schema.make("empty"), { focus: "hole" }, env);
			return true;
		}
		if (node.classList?.contains("block")) {
			const parent = node.parentElement;
			if (parent?.classList?.contains("slot") && parent.dataset.kind === "expr") {
				this.replaceNode(parent, this.schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
			if (parent === root) {
				this.replaceNode(node, this.schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
			const slot = this.closestSlot(node);
			if (slot) {
				this.replaceNode(slot, this.schema.make("empty"), { focus: "hole" }, env);
				return true;
			}
		}
		return false;
	}

	// Method: changeOp
	// Changes a block's operator, reshaping unary↔binary when needed.
	changeOp(args = {}, env = {}) {
		const block = args.block ?? args.form;
		const newOp = args.op;
		if (!block?.classList?.contains("block") || !newOp) return false;
		const prev = block.dataset.op;
		const labelOf = (op) => this.schema.shape(op)?.label ?? op;

		if (prev === "neg" && newOp !== "neg") {
			const slots = [...block.children].filter((c) => c.classList.contains("slot"));
			const operand = slots[0] ?? this.schema.make("empty");
			block.dataset.op = newOp;
			block.replaceChildren(
				operand,
				el("span", "op atom", { "data-op": newOp, text: labelOf(newOp) }),
				this.schema.make("empty"),
			);
			this.retouchNested();
			this.afterMutate(env);
			this.selectUnit(block.querySelector(":scope > .op"), env);
			return true;
		}

		if (prev !== "neg" && newOp === "neg") {
			const slots = [...block.children].filter((c) => c.classList.contains("slot"));
			const left = slots[0] ?? this.schema.make("empty");
			block.dataset.op = "neg";
			block.replaceChildren(
				el("span", "op atom", { "data-op": "neg", text: labelOf("neg") }),
				left,
			);
			this.retouchNested();
			this.afterMutate(env);
			this.selectUnit(block.querySelector(":scope > .op"), env);
			return true;
		}

		block.dataset.op = newOp;
		const opEl = block.querySelector(":scope > .op");
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
		const unit = args.unit;
		const op = args.op;
		const side = args.side === "before" ? "before" : "after";
		if (!unit?.parentNode || !op) return false;
		if (unit.classList.contains("empty")) return false;

		const node = this.extractOperandNode(unit) ?? unit;
		if (!node?.parentNode || node.classList.contains("empty")) return false;

		const marker = document.createElement("span");
		marker.className = "skipped wrap-marker";
		node.replaceWith(marker);

		const empty = this.schema.make("empty");
		const left = side === "after" ? this.asBlockChildOperand(node) : empty;
		const right = side === "before" ? this.asBlockChildOperand(node) : empty;
		const label = this.schema.shape(op)?.label ?? op;
		const block = el("span", "block container", { "data-op": op });
		block.append(
			left,
			el("span", "op atom", { "data-op": op, text: label }),
			right,
		);

		const parent = marker.parentElement;
		let replacement = block;
		if (parent && parent !== this.editor.root && parent.classList.contains("block")) {
			if (typeof this.schema.nest === "function") replacement = this.schema.nest(block);
			else if (this.schema.has("nest")) replacement = this.schema.make("nest", block);
		}

		marker.replaceWith(replacement);
		this.retouchNested();
		this.afterMutate(env);

		const focusEmpty =
			(side === "after" ? right : left).classList?.contains("empty")
				? side === "after"
					? right
					: left
				: replacement.querySelector?.(".slot.empty");
		if (focusEmpty) {
			const hole = focusEmpty.querySelector?.(".hole");
			if (hole) this.selectUnit(hole, env);
			else this.selectUnit(focusEmpty, env);
			this.editor.plugin("block-menus")?.showChooser?.(focusEmpty, { force: true });
		} else {
			this.selectUnit(block.querySelector(":scope > .op") || block, env);
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
		return this.editor.history.run("delete", () => this._handleDelete(direction, env));
	}

	_handleDelete(direction, env = {}) {
		const editor = this.editor;
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
			if (slot?.classList.contains("empty")) return true;
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

// ----------------------------------------------------------------------------
// BlockMenus plugin
// ----------------------------------------------------------------------------

// Class: BlockMenus
// Chooser / operator / autocomplete chrome driven by schema + context.
class BlockMenus {
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
		this.chooserIndex = 0;
		this.opMenuIndex = 0;
		this.autoItems = [];
		this.autoIndex = 0;
		this.chooserSuppressedFor = null;
		this._onCursorMove = this.onCursorMove.bind(this);
		this._onClick = this.onClick.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		this._mo = null;
	}

	attach(editor) {
		this.editor = editor;
		this.blocks = editor.blocks ?? editor.plugin("blocks");
		editor.root.addEventListener("CursorMove", this._onCursorMove);
		editor.root.addEventListener("click", this._onClick);
		document.addEventListener("mousedown", this._onMouseDown);

		// Menu navigation / confirm rules take priority while a menu is open.
		editor.addInputRules([
			{
				when: () => this.isChooserOpen(),
				key: "ArrowDown",
				do: () => {
					this.moveChooser(1);
					return true;
				},
			},
			{
				when: () => this.isChooserOpen(),
				key: "ArrowUp",
				do: () => {
					this.moveChooser(-1);
					return true;
				},
			},
			{
				when: () => this.isChooserOpen(),
				key: "Enter",
				do: () => {
					this.confirmChooser();
					return true;
				},
			},
			{
				when: () => this.isChooserOpen(),
				key: "Escape",
				do: () => {
					const keep = this.activeEmptySlot;
					this.hideChooser({ suppress: true });
					const hole = keep?.querySelector?.(".hole");
					if (hole) this.blocks?.selectUnit(hole);
					return true;
				},
			},
			{
				when: () => this.isChooserOpen(),
				match: /.*/,
				do: (args, env) => this.chooserShortcut(args, env),
			},
			{
				when: () => this.isCompleteOpen(),
				key: "ArrowDown",
				do: () => {
					this.moveAuto(1);
					return true;
				},
			},
			{
				when: () => this.isCompleteOpen(),
				key: "ArrowUp",
				do: () => {
					this.moveAuto(-1);
					return true;
				},
			},
			{
				when: () => this.isCompleteOpen(),
				key: ["Enter", "Tab"],
				do: () => {
					this.confirmAuto();
					return true;
				},
			},
			{
				when: () => this.isCompleteOpen(),
				key: "Escape",
				do: () => {
					this.hideComplete();
					return true;
				},
			},
			{
				when: () => this.isOpMenuOpen(),
				key: "ArrowDown",
				do: () => {
					this.moveOpMenu(1);
					return true;
				},
			},
			{
				when: () => this.isOpMenuOpen(),
				key: "ArrowUp",
				do: () => {
					this.moveOpMenu(-1);
					return true;
				},
			},
			{
				when: () => this.isOpMenuOpen(),
				key: "Enter",
				do: () => {
					this.confirmOpMenu();
					return true;
				},
			},
			{
				when: () => this.isOpMenuOpen(),
				key: "Escape",
				do: () => {
					const keep = this.activeOpEl;
					this.hideOpMenu();
					if (keep) this.blocks?.selectUnit(keep);
					return true;
				},
			},
			{
				when: () => this.isOpMenuOpen(),
				match: /.*/,
				do: (args, env) => this.opMenuShortcut(args, env),
			},
			// Open chooser on Enter/Space when on empty slot.
			{
				when: { slot: "empty" },
				key: ["Enter", "Space"],
				do: (args) => {
					const slot = args.context?.emptySlot ?? args.context?.slot;
					if (!slot) return false;
					const hole = slot.querySelector(".hole");
					if (hole) this.blocks?.selectUnit(hole);
					this.showChooser(slot, { force: true });
					return true;
				},
			},
			// Enter/Space on op opens operator menu.
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
		], { prepend: true });

		// Leaf mutation observer for live complete / change notify.
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
		return this;
	}

	// ------------------------------------------------------------------
	// Open state
	// ------------------------------------------------------------------

	isChooserOpen() {
		return !!this.chooser?.el?.classList.contains("open");
	}

	isOpMenuOpen() {
		return !!this.operator?.el?.classList.contains("open");
	}

	isCompleteOpen() {
		return !!this.complete?.el?.classList.contains("open");
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
	// Positioning / items
	// ------------------------------------------------------------------

	positionMenu(menu, anchor) {
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

	chooserItems() {
		if (typeof this.chooser?.items === "function") return this.chooser.items();
		if (Array.isArray(this.chooser?.items)) return this.chooser.items;
		const schema = this.blocks?.schema;
		if (Array.isArray(schema?.choices)) return schema.choices;
		return [];
	}

	opItems(block) {
		if (typeof this.operator?.items === "function") return this.operator.items(block);
		if (Array.isArray(this.operator?.items)) return this.operator.items;
		const shapes = this.blocks?.schema?.shapes ?? {};
		return Object.entries(shapes).map(([id, shape]) => ({
			id,
			label: shape.menuLabel ?? shape.label ?? id,
			kbd: shape.kbd ?? shape.key ?? id,
		}));
	}

	// ------------------------------------------------------------------
	// Chooser
	// ------------------------------------------------------------------

	renderChooser() {
		const menu = this.chooser?.el;
		if (!menu) return;
		const items = this.chooserItems();
		menu.innerHTML = "";
		let lastSection = null;
		items.forEach((item, i) => {
			if (item.section && item.section !== lastSection) {
				lastSection = item.section;
				menu.append(el("div", "section", { text: item.section }));
			}
			const btn = el("button", i === this.chooserIndex ? "active" : "", { type: "button" });
			btn.dataset.id = item.id;
			btn.innerHTML = `<span>${item.label}</span>${
				item.kbd != null ? `<span class="kbd">${item.kbd}</span>` : ""
			}`;
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this.activeEmptySlot) {
					this.blocks?.fill({ slot: this.activeEmptySlot, as: item.id });
					this.hideChooser();
				}
			});
			menu.append(btn);
		});
	}

	showChooser(slot, options = {}) {
		if (!this.chooser?.el || !slot?.isConnected) return;
		if (!options.force && this.chooserSuppressedFor === slot) return;
		this.chooserSuppressedFor = null;
		this.hideComplete();
		this.hideOpMenu();
		this.activeEmptySlot = slot;
		this.chooserIndex = 0;
		this.renderChooser();
		this.positionMenu(this.chooser.el, slot);
	}

	hideChooser(options = {}) {
		if (options.suppress && this.activeEmptySlot) {
			this.chooserSuppressedFor = this.activeEmptySlot;
		}
		this.chooser?.el?.classList.remove("open");
		this.activeEmptySlot = null;
	}

	moveChooser(delta) {
		const items = this.chooserItems();
		if (!items.length) return;
		this.chooserIndex = (this.chooserIndex + delta + items.length) % items.length;
		this.renderChooser();
		this.chooser.el?.querySelector("button.active")?.scrollIntoView({ block: "nearest" });
	}

	confirmChooser() {
		const items = this.chooserItems();
		const item = items[this.chooserIndex];
		if (!item || !this.activeEmptySlot) return false;
		this.blocks?.fill({ slot: this.activeEmptySlot, as: item.id });
		this.hideChooser();
		return true;
	}

	chooserShortcut(args) {
		const key = args.key;
		const items = this.chooserItems();
		// Prefer explicit item.shortcut / id match via schema ops.
		const op = this.blocks?.schema?.opFromKey(key);
		if (op && this.activeEmptySlot) {
			const hit = items.find((it) => it.id === op);
			if (hit) {
				this.blocks.fill({ slot: this.activeEmptySlot, as: hit.id });
				this.hideChooser();
				return true;
			}
		}
		const byId = items.find(
			(it) => it.id === key || it.shortcut === key || it.kbd === key,
		);
		if (byId && this.activeEmptySlot) {
			// Only treat single-letter section shortcuts specially when declared.
			if (byId.shortcut === key || (key.length === 1 && byId.id === key)) {
				this.blocks.fill({ slot: this.activeEmptySlot, as: byId.id });
				this.hideChooser();
				return true;
			}
		}
		// Digit / letter type-through is handled by block input rules (fill), not here.
		return false;
	}

	// ------------------------------------------------------------------
	// Operator menu
	// ------------------------------------------------------------------

	renderOpMenu(block) {
		const menu = this.operator?.el;
		if (!menu) return;
		const items = this.opItems(block);
		menu.innerHTML = "";
		menu.append(el("div", "section", { text: "Operator" }));
		items.forEach((item, i) => {
			const btn = el("button", i === this.opMenuIndex ? "active" : "", { type: "button" });
			btn.dataset.id = item.id;
			const mark = block?.dataset.op === item.id ? " ✓" : "";
			btn.innerHTML = `<span>${item.label}${mark}</span>${
				item.kbd != null ? `<span class="kbd">${item.kbd}</span>` : ""
			}`;
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this.activeOpEl) {
					this.blocks?.changeOp({ block: this.blocks.closestBlock(this.activeOpEl), op: item.id });
					this.hideOpMenu();
				}
			});
			menu.append(btn);
		});
	}

	showOpMenu(opEl) {
		if (!this.operator?.el || !opEl?.isConnected) return;
		this.hideChooser();
		this.hideComplete();
		this.activeOpEl = opEl;
		const block = this.blocks?.closestBlock(opEl);
		const items = this.opItems(block);
		const cur = items.findIndex((it) => it.id === block?.dataset.op);
		this.opMenuIndex = cur >= 0 ? cur : 0;
		this.renderOpMenu(block);
		this.positionMenu(this.operator.el, opEl);
	}

	hideOpMenu() {
		this.operator?.el?.classList.remove("open");
		this.activeOpEl = null;
	}

	moveOpMenu(delta) {
		if (!this.activeOpEl) return;
		const block = this.blocks?.closestBlock(this.activeOpEl);
		const items = this.opItems(block);
		if (!items.length) return;
		this.opMenuIndex = (this.opMenuIndex + delta + items.length) % items.length;
		this.renderOpMenu(block);
		this.operator.el?.querySelector("button.active")?.scrollIntoView({ block: "nearest" });
	}

	confirmOpMenu() {
		if (!this.activeOpEl) return false;
		const block = this.blocks?.closestBlock(this.activeOpEl);
		const items = this.opItems(block);
		const item = items[this.opMenuIndex];
		if (item) this.blocks?.changeOp({ block, op: item.id });
		this.hideOpMenu();
		return true;
	}

	opMenuShortcut(args) {
		const op = this.blocks?.schema?.opFromKey(args.key);
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

	renderComplete() {
		const menu = this.complete?.el;
		if (!menu) return;
		menu.innerHTML = "";
		if (!this.autoItems.length) {
			menu.append(el("div", "section", { text: "No matches" }));
			return;
		}
		const format =
			this.complete?.formatItem ??
			((name) => ({
				label: name,
				kbd: this.complete?.detail?.(name),
			}));
		this.autoItems.forEach((name, i) => {
			const meta = format(name) ?? { label: name };
			const btn = el("button", i === this.autoIndex ? "active" : "", { type: "button" });
			btn.dataset.name = name;
			btn.innerHTML = `<span>${meta.label ?? name}</span>${
				meta.kbd != null ? `<span class="kbd">${meta.kbd}</span>` : ""
			}`;
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.applyVarName(name);
			});
			menu.append(btn);
		});
	}

	showComplete(leaf) {
		if (!this.complete?.el || !leaf?.isConnected) return;
		this.hideChooser();
		this.hideOpMenu();
		this.activeVarLeaf = leaf;
		const prefix = leaf.textContent ?? "";
		this.autoItems = this.completeSource(prefix);
		this.autoIndex = 0;
		this.renderComplete();
		this.positionMenu(this.complete.el, leaf);
	}

	hideComplete() {
		this.complete?.el?.classList.remove("open");
		this.activeVarLeaf = null;
		this.autoItems = [];
	}

	moveAuto(delta) {
		if (!this.autoItems.length) return;
		this.autoIndex = (this.autoIndex + delta + this.autoItems.length) % this.autoItems.length;
		this.renderComplete();
		this.complete.el?.querySelector("button.active")?.scrollIntoView({ block: "nearest" });
	}

	confirmAuto() {
		if (!this.autoItems.length) return false;
		return this.applyVarName(this.autoItems[this.autoIndex]);
	}

	applyVarName(name) {
		if (!this.activeVarLeaf?.isConnected) {
			this.hideComplete();
			return false;
		}
		return (
			this.blocks?.applyCompletion({ leaf: this.activeVarLeaf, value: name }) ?? false
		);
	}

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	emptySlotFromSelection() {
		const cursor = this.editor.input.cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const n = cursor.selectedNode;
			if (n.classList.contains("hole")) {
				const slot = this.blocks?.closestSlot(n);
				if (slot?.classList.contains("empty")) return slot;
			}
			if (n.classList.contains("slot") && n.classList.contains("empty")) return n;
		}
		const slot =
			this.blocks?.closestSlot(cursor.selectedNode) ??
			this.blocks?.closestSlot(cursor.anchor);
		return slot?.classList.contains("empty") ? slot : null;
	}

	onCursorMove() {
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
		if (cursor.selectionKind === "node" && cursor.selectedNode?.classList?.contains("op")) {
			if (this.activeOpEl !== cursor.selectedNode || !this.isOpMenuOpen()) {
				this.showOpMenu(cursor.selectedNode);
			}
		} else if (this.isOpMenuOpen() && this.activeOpEl && cursor.selectedNode !== this.activeOpEl) {
			this.hideOpMenu();
		}
	}

	onClick(event) {
		const op = event.target.closest?.(".op.atom");
		if (op && this.editor.root.contains(op)) {
			event.preventDefault();
			this.blocks?.selectUnit(op);
			this.showOpMenu(op);
			return;
		}
		const hole = event.target.closest?.(".hole");
		if (hole) {
			const slot = this.blocks?.closestSlot(hole);
			if (slot?.classList.contains("empty")) {
				event.preventDefault();
				this.blocks?.selectUnit(hole);
				this.showChooser(slot);
			}
		}
		const leaf = event.target.closest?.(".leaf.var");
		if (leaf) this.showComplete(leaf);
	}

	onMouseDown(event) {
		const t = event.target;
		if (
			this.chooser?.el &&
			!this.chooser.el.contains(t) &&
			!t.closest?.(".hole") &&
			!t.closest?.(".slot.empty")
		) {
			this.hideChooser();
		}
		if (
			this.complete?.el &&
			!this.complete.el.contains(t) &&
			!t.closest?.(".leaf.var")
		) {
			if (!t.closest?.("#editor") && t !== this.editor.root && !this.editor.root.contains(t)) {
				this.hideComplete();
			}
		}
		if (
			this.operator?.el &&
			!this.operator.el.contains(t) &&
			!t.closest?.(".op.atom")
		) {
			this.hideOpMenu();
		}
	}
}

// Function: defaultExprInput
// Common input rules for expression-like block editors.
function defaultBlockInput(options = {}) {
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
				const slot = args.context.slot;
				const leaf = slot?.querySelector?.(".leaf.num");
				if (!leaf) return false;
				leaf.textContent = args.key === "." ? "0." : args.key;
				env.editor.text.refresh();
				env.editor.blocks?.placeCaretIn(leaf, true, env);
				env.editor.blocks?.notifyChange();
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
				const slot = args.context.slot;
				const leaf = slot?.querySelector?.(".leaf.var");
				if (!leaf) return false;
				leaf.textContent = args.key;
				env.editor.text.refresh();
				env.editor.blocks?.placeCaretIn(leaf, true, env);
				env.editor.plugin("block-menus")?.showComplete?.(leaf);
				env.editor.blocks?.notifyChange();
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

export {
	BlockMenus,
	BlockSchema,
	Blocks,
	defaultBlockInput,
	el as blockEl,
	blockKeymap,
	blockSchema,
};

export default {
	BlockMenus,
	BlockSchema,
	Blocks,
	defaultBlockInput,
	blockEl: el,
	blockKeymap,
	blockSchema,
};
