// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: keymap
// Default editor key bindings and history-skip command set (no Editor dependency).

// Function: editorKeymap
// Returns the built-in editing keys. Use this helper to compose custom maps.
export function editorKeymap(overrides = {}) {
	return {
		ArrowLeft: { type: "moveCursor", args: { direction: "left" } },
		ArrowRight: { type: "moveCursor", args: { direction: "right" } },
		ArrowUp: { type: "moveCursor", args: { direction: "up" } },
		ArrowDown: { type: "moveCursor", args: { direction: "down" } },
		"Shift+ArrowLeft": { type: "moveCursor", args: { direction: "left", extend: true } },
		"Shift+ArrowRight": { type: "moveCursor", args: { direction: "right", extend: true } },
		"Shift+ArrowUp": { type: "moveCursor", args: { direction: "up", extend: true } },
		"Shift+ArrowDown": { type: "moveCursor", args: { direction: "down", extend: true } },
		"Mod+A": { type: "selectStructuralScope", args: { mode: "expand" } },
		"Mod+Shift+A": { type: "selectStructuralScope", args: { mode: "contract" } },
		"Mod+ArrowLeft": { type: "moveStructural", args: { direction: "left" } },
		"Mod+ArrowRight": { type: "moveStructural", args: { direction: "right" } },
		"Mod+ArrowUp": { type: "moveStructural", args: { direction: "up" } },
		"Mod+ArrowDown": { type: "moveStructural", args: { direction: "down" } },
		"Mod+Shift+ArrowLeft": { type: "moveStructural", args: { direction: "left", extend: true } },
		"Mod+Shift+ArrowRight": { type: "moveStructural", args: { direction: "right", extend: true } },
		"Mod+Shift+ArrowUp": { type: "moveStructural", args: { direction: "up", extend: true } },
		"Mod+Shift+ArrowDown": { type: "moveStructural", args: { direction: "down", extend: true } },
		"Mod+Z": { type: "undo" },
		"Mod+Shift+Z": { type: "redo" },
		"Mod+Y": { type: "redo" },
		Tab: { type: "moveTraversal", args: { direction: "forward" } },
		"Shift+Tab": { type: "moveTraversal", args: { direction: "backward" } },
		Backspace: { type: "deleteBackward" },
		Delete: { type: "deleteForward" },
		...overrides,
	};
}

// Commands that only move selection — never push history.
export const HISTORY_SKIP = new Set([
	"moveCursor",
	"selectAll",
	"selectStructuralScope",
	"moveStructural",
	"moveTraversal",
	"collapseSelection",
	"collapseStructural",
	"undo",
	"redo",
	"copy",
]);
