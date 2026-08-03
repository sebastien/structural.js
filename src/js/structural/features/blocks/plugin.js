// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: features/blocks/plugin
// Structural-block transforms, unit scope, and declarative input rules.

import { asElement } from "../../dom.js";
import { el } from "./menus.js";
import { blockWhenDomain, matchInputRuleWhen } from "../../rules.js";
import { BlockSchema, blockSchema } from "./schema.js";

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
		if (compiled.length) editor.addInputRules(compiled);

		editor.root.addEventListener("CursorMove", this._onCursorMove);
		return this;
	}

	// Method: detach
	detach() {
		if (!this.editor) return this;
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

	resolveWrapUnit(ctx, sideHint = null) {
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

	afterMutate(env = {}) {
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
