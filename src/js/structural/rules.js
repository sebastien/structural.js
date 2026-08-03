// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-08-03

// Module: rules
// Declarative input-rule matching (when predicates + key/match filters).

// Function: matchInputRuleWhen
// Evaluates a rule's `when` predicate or declarative context matcher.
// `options.domain` may supply handlers for keys the generic matcher should not
// treat as plain context field equality (e.g. Blocks slot/edge/selected).
// Domain handlers return true/false, or undefined to fall through to generic.
export function matchInputRuleWhen(when, ctx, event, options = {}) {
	if (when == null) return true;
	if (typeof when === "function") return !!when(ctx, event);
	if (typeof when !== "object") return !!when;

	const domain = options.domain;

	for (const [key, expected] of Object.entries(when)) {
		if (expected === undefined) continue;
		if (key === "not") {
			if (matchInputRuleWhen(expected, ctx, event, options)) return false;
			continue;
		}
		if (key === "or") {
			const list = Array.isArray(expected) ? expected : [expected];
			if (!list.some((item) => matchInputRuleWhen(item, ctx, event, options))) return false;
			continue;
		}
		if (key === "and") {
			const list = Array.isArray(expected) ? expected : [expected];
			if (!list.every((item) => matchInputRuleWhen(item, ctx, event, options))) return false;
			continue;
		}
		if (key === "test" && typeof expected === "function") {
			if (!expected(ctx, event)) return false;
			continue;
		}
		if (domain && typeof domain[key] === "function") {
			const handled = domain[key](expected, ctx, event, when);
			if (handled !== undefined) {
				if (!handled) return false;
				continue;
			}
		}
		const actual = ctx?.[key];
		if (typeof expected === "boolean") {
			if (!!actual !== expected) return false;
			continue;
		}
		if (expected === null) {
			if (actual != null) return false;
			continue;
		}
		if (typeof expected === "string") {
			if (actual === expected) continue;
			// Allow matching DOM token lists / data attributes via context helpers.
			if (actual?.classList?.contains?.(expected)) continue;
			if (actual != null && String(actual) === expected) continue;
			return false;
		}
		if (typeof expected === "function") {
			if (!expected(actual, ctx, event)) return false;
			continue;
		}
		if (expected instanceof RegExp) {
			expected.lastIndex = 0;
			if (!expected.test(String(actual ?? ""))) return false;
			continue;
		}
		if (actual !== expected) return false;
	}
	return true;
}

// Function: matchInputRuleKey
// Matches event.key against rule.key (string|string[]) and/or rule.match (RegExp).
export function matchInputRuleKey(rule, event) {
	if (!event) return false;
	const key = event.key;
	const hasMod = !!(event.ctrlKey || event.metaKey);
	if (rule.mod != null) {
		if (hasMod !== !!rule.mod) return false;
	} else if (hasMod && rule.allowMod !== true && (rule.key != null || rule.match != null)) {
		// Character/key rules ignore ctrl/meta chords (those belong in the keymap).
		return false;
	}
	if (rule.alt != null && !!event.altKey !== !!rule.alt) return false;
	if (rule.shift != null && !!event.shiftKey !== !!rule.shift) return false;

	let keyOk = true;
	if (rule.key != null) {
		const keys = Array.isArray(rule.key) ? rule.key : [rule.key];
		keyOk = keys.some((k) => {
			if (k === "Space") return key === " ";
			return k === key || (typeof k === "string" && k.toLowerCase() === key.toLowerCase());
		});
	}
	let matchOk = true;
	if (rule.match != null) {
		const re = rule.match instanceof RegExp ? rule.match : new RegExp(rule.match);
		re.lastIndex = 0;
		matchOk = re.test(key);
	}
	// If neither key nor match specified, key always matches (when-only rule).
	if (rule.key == null && rule.match == null) return true;
	if (rule.key != null && rule.match != null) return keyOk || matchOk;
	if (rule.key != null) return keyOk;
	return matchOk;
}

// Domain matchers for structural-block context fields (used by Blocks).
export const blockWhenDomain = {
	slot(expected, ctx) {
		if (expected === "empty" || expected === true) {
			return !!(ctx.slotEmpty || ctx.emptySlot);
		}
		if (typeof expected === "string") {
			return ctx.slotKind === expected || (expected === "empty" && ctx.slotEmpty);
		}
		return undefined;
	},
	slotEmpty(expected, ctx) {
		return !!ctx.slotEmpty === !!expected;
	},
	selected(expected, ctx) {
		const sel = expected;
		if (sel === "op") return !!ctx.isOpSelected;
		if (sel === "hole") return !!ctx.isHoleSelected;
		if (sel === "unit") return !!ctx.isUnitSelected;
		if (sel === "node") return ctx.selectionKind === "node";
		if (sel === true) return ctx.selectionKind === "node";
		if (typeof sel === "string") {
			return ctx.selectedRole === sel || !!ctx.selected?.classList?.contains?.(sel);
		}
		return undefined;
	},
	unit(expected, ctx) {
		if (expected === true) return !!ctx.unit;
		if (expected === false) return !ctx.unit;
		return undefined;
	},
	edge(expected, ctx) {
		if (expected === "start") return ctx.edge === "start";
		if (expected === "end") return ctx.edge === "end";
		if (expected === "inside") return ctx.edge === "inside";
		if (expected === "boundary") return ctx.edge === "start" || ctx.edge === "end";
		return undefined;
	},
	leaf(expected, ctx) {
		if (expected === true) return !!ctx.leaf;
		if (expected === false) return !ctx.leaf;
		if (typeof expected === "string") return !!ctx.leaf?.classList?.contains?.(expected);
		return undefined;
	},
	inLeaf(expected, ctx) {
		return !!ctx.inLeaf === !!expected;
	},
	block(expected, ctx) {
		if (expected === true) return !!ctx.block;
		if (typeof expected === "string") return ctx.block?.dataset?.op === expected;
		return undefined;
	},
	role(expected, ctx) {
		return ctx.role === expected || ctx.selectedRole === expected;
	},
};
