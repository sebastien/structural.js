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
	wordBoundsInData,
	wordRangeAtIndex,
	DEFAULT_BLOCK_SELECTOR,
	isLegacyAtom,
	isLegacyContainer,
	isLegacySkipped,
	LEGACY_ATOM_SELECTOR,
	LEGACY_CONTAINER_SELECTOR,
	LEGACY_SKIPPED_SELECTOR,
	LEGACY_STRUCTURAL_SELECTOR,
} from "./foundation/document.js";
export { Caret, Cursor } from "./interaction/cursor.js";
export { EditorSelectionController, SelectionOverlay, TextSelection } from "./interaction/selection.js";
export { Modification } from "./features/richtext.js";
export { EditorPluginHost, HISTORY_SKIP, blockWhenDomain, matchInputRuleKey, matchInputRuleWhen } from "./runtime/editor.js";
export {
	Editor,
	EditorClassController,
	EditorCommand,
	EditorCursor,
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
	richTextClasses,
	richTextKeymap,
	richTextNormalizer,
	richTextRules,
	richTextSchema,
} from "./features/richtext.js";
export { Shorthands, normalizeDefinition } from "./features/shorthands.js";

export { default as richtext } from "./features/richtext.js";

export {
	BlockMenus,
	BlockSchema,
	Blocks,
	ListMenu,
	defaultBlockInput,
	blockEl,
	blockKeymap,
	blockSchema,
} from "./features/blocks.js";

export { default as blocks } from "./features/blocks.js";
