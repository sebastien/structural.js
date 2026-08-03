// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

import { editorKeymap } from "../../keymap.js";

// Function: richTextKeymap
// Returns standard key binding maps for structural formatting.
function richTextKeymap(overrides = {}) {
	return editorKeymap({
		"Mod+B": { type: "toggleInline", args: { tag: "strong" } },
		"Mod+I": { type: "toggleInline", args: { tag: "em" } },
		"Mod+`": { type: "toggleInline", args: { tag: "code" } },
		"Mod+1": { type: "toggleBlock", args: { tag: "h1" } },
		"Mod+2": { type: "toggleBlock", args: { tag: "h2" } },
		"Mod+3": { type: "toggleBlock", args: { tag: "h3" } },
		"Mod+ArrowLeft": { type: "moveCursor", args: { direction: "left", word: true } },
		"Mod+ArrowRight": { type: "moveCursor", args: { direction: "right", word: true } },
		"Mod+Shift+ArrowLeft": {
			type: "moveCursor",
			args: { direction: "left", word: true, extend: true },
		},
		"Mod+Shift+ArrowRight": {
			type: "moveCursor",
			args: { direction: "right", word: true, extend: true },
		},
		"Mod+C": { type: "copy" },
		"Mod+X": { type: "cut" },
		// Paste is handled only via the document `paste` event (has clipboardData).
		// Binding Mod+V on keydown would preventDefault and force async clipboard.readText,
		// which is often denied — so paste would silently no-op.
		Enter: { type: "splitBlock" },
		"Shift+Enter": { type: "insertLineBreak" },
		Tab: { type: "indent" },
		"Shift+Tab": { type: "dedent" },
		Backspace: { type: "deleteSmart" },
		Delete: { type: "deleteSmart" },
		...overrides,
	});
}

export { richTextKeymap };
