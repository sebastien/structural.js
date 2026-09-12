// Project: structural.js
// Author: Sébastien Pierre
// License: Revised BSD License

// Public compatibility entrypoint. Implementation modules are intentionally private.

export {
	TextAdapter,
	asElement,
	blockSelectorFromSchema,
	firstTextNode,
	lastTextNode,
	wordRangeAtIndex,
	DEFAULT_BLOCK_SELECTOR,
} from "./foundation/document.js";
export { Caret, Cursor } from "./interaction/cursor.js";
export { EditorSelectionController, PlaceholderOverlay, SelectionOverlay, TextSelection } from "./interaction/selection.js";
export { Modification } from "./features/richtext.js";
export {
	Editor,
	EditorClassController,
	EditorCommand,
	EditorHistory,
	editorKeymap,
	EditorNormalizer,
	EditorRangeController,
	EditorSchema,
	EditorSession,
	EditorTextInput,
	EditorTransaction,
} from "./runtime/editor.js";
export {
	RichText,
	RichTextCommandMenu,
	richTextClasses,
	richTextKeymap,
	richTextSchema,
} from "./features/richtext.js";
export { Shorthands } from "./features/shorthands.js";
export {
	BlockMenus,
	BlockSchema,
	Blocks,
	defaultBlockInput,
	blockEl,
	blockKeymap,
	blockSchema,
} from "./features/blocks.js";
