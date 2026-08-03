// Project: structural.js
// Author: Sébastien Pierre
// License: Revised BSD License

// Public entrypoint for the bundled distribution.

export { TextAdapter } from "./text.js";
export { EditorRangeController } from "./range.js";
export { Caret, Cursor } from "./cursor.js";
export { EditorSelectionController, SelectionOverlay, TextSelection } from "./selection.js";
export { Modification } from "./modification.js";
export { EditorCommand } from "./core/command.js";
export { EditorTransaction } from "./core/transaction.js";
export { EditorPluginHost } from "./core/plugin-host.js";
export {
	asElement,
	blockSelectorFromSchema,
	firstTextNode,
	lastTextNode,
	wordBoundsInData,
	wordRangeAtIndex,
	DEFAULT_BLOCK_SELECTOR,
} from "./dom.js";
export {
	blockWhenDomain,
	matchInputRuleKey,
	matchInputRuleWhen,
} from "./rules.js";
export { HISTORY_SKIP } from "./keymap.js";
export {
	isLegacyAtom,
	isLegacyContainer,
	isLegacySkipped,
	LEGACY_ATOM_SELECTOR,
	LEGACY_CONTAINER_SELECTOR,
	LEGACY_SKIPPED_SELECTOR,
	LEGACY_STRUCTURAL_SELECTOR,
} from "./compat.js";
// Schema/history/session/keymap symbols also re-exported from editor for deep-import compat.
export {
	Editor,
	EditorClassController,
	EditorCommand,
	EditorCursor,
	EditorHistory,
	editorKeymap,
	EditorNormalizer,
	EditorSchema,
	EditorSession,
	EditorTextInput,
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

export {
	BlockMenus,
	BlockSchema,
	Blocks,
	ListMenu,
	defaultBlockInput,
	blockEl,
	blockKeymap,
	blockSchema,
} from "./blocks.js";

export { default as blocks } from "./blocks.js";
