// Project: structural.js
// Author: Sébastien Pierre
// License: Revised BSD License

// Public entrypoint for the bundled distribution.

export { TextAdapter } from "./text.js";
export { EditorRangeController } from "./range.js";
export { Caret, Cursor } from "./cursor.js";
export { EditorSelectionController, SelectionOverlay, TextSelection } from "./selection.js";
export { Modification } from "./modification.js";
export {
	Editor,
	EditorAdapter,
	EditorClassController,
	EditorCommand,
	EditorCursor,
	editorKeymap,
	EditorNormalizer,
	EditorSchema,
	EditorSession,
	EditorTransaction,
} from "./editor.js";
export {
	RichText,
	richTextClasses,
	richTextKeymap,
	richTextNormalizer,
	richTextRules,
	richTextSchema,
} from "./richtext.js";

export { default as richtext } from "./richtext.js";
