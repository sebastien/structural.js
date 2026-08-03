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
