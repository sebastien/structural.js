// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

import { asElement } from "../../dom.js";
import { editorKeymap } from "../../keymap.js";

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
