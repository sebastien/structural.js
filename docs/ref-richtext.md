# Rich Text Reference

`structural/richtext` provides a rich-text schema, keymap, class configuration,
normalizer, and `RichText` plugin. It edits the document DOM directly and does
not create an AST or serialization format.

```js
import {
  Editor, Modification, RichText,
  richTextClasses, richTextKeymap, richTextSchema,
} from "./src/js/structural/index.js";

const editor = new Editor(document.querySelector("#editor"), {
  schema: richTextSchema(),
  keymap: richTextKeymap(),
  classes: richTextClasses(),
  plugins: [RichText],
  caret: { node: document.querySelector("#caret"), mode: "virtual" },
  selection: { node: document.querySelector("#selection"), mode: "virtual" },
});

const modification = new Modification(editor);
editor.configureActions({
  toggleInline: command => modification.toggleInline(command.args.tag ?? command.args.value),
  toggleBlock: command => modification.toggleBlock(command.args.tag ?? command.args.value),
});
```

The plugin installs editing behavior. `Modification` deliberately remains a
separate action, so wire `toggleInline` and `toggleBlock` for toolbar and
keyboard formatting commands.

## Schema

`richTextSchema(overrides?, options?)` returns an `EditorSchema`.

| Category | Nodes |
| --- | --- |
| Root/container blocks | `section`, `nav`, `header`, `blockquote` |
| Text blocks | `p`, `pre`, `h1`, `h2`, `h3` |
| Lists | `ul`, `ol`, `li` |
| Inline formatting | `strong`, `em`, `code` |

The root accepts containers, text blocks, lists, and blockquotes. Containers
lift invalid children and prune empty containers. Paragraphs, headings, `pre`,
and list items preserve an editable placeholder when empty. `pre` preserves
whitespace. Unknown elements are unwrapped and empty text nodes pruned by the
default normalization. `strong` and `em` may nest inline content; `code` accepts
text only. `b` aliases to `strong`, and `i` to `em`.

| Argument | Meaning |
| --- | --- |
| `overrides` | Rule map merged over built-in `richTextRules`. |
| `options.atoms` | Opaque atom tag names; adds `type: "atom"` rules. |
| `options.aliases` | Extra aliases merged with `b` and `i`. |
| `options.normalize` | Global normalization overrides. |

`richTextRules` is exported for inspection and composition.
`richTextNormalizer(schema?, options?)` constructs an `EditorNormalizer` when
one is needed independently of the editor.

## Keymap

`richTextKeymap(overrides?)` returns an action map. Overrides are merged last.

| Key | Action |
| --- | --- |
| `Mod+A` / `Mod+Shift+A` | Expand / contract current-block selection. |
| `Mod+B`, `Mod+I`, `Mod+\`` | Toggle `strong`, `em`, `code`. |
| `Mod+1`, `Mod+2`, `Mod+3` | Toggle `h1`, `h2`, `h3`. |
| `Mod+Shift+ArrowLeft/Right/Up/Down` | Extend structural selection. |
| `Enter` / `Shift+Enter` | Split current block / insert line break. |
| `Tab` / `Shift+Tab` | Indent / dedent current list item. |
| `Backspace` / `Delete` | Smart block deletion and merging. |

## Classes

`richTextClasses(options?)` returns:

```js
{
  selector: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre",
             "li", "blockquote", "strong", "em", "code"],
  focus: "focus",
  focusWithin: "focus-within",
  selected: "selected",
  selectedWithin: "selected-within",
}
```

Pass overrides for class names or `selector`. These classes are styling hooks;
style the virtual caret and selection overlay host in your application.

## `RichText` Plugin

Install with `plugins: [RichText]` or `plugins: [new RichText(options)]`. While
installed, the plugin is available as `editor.richText`, registers document
copy/paste listeners, and removes them on plugin detachment.

| Action | Behavior |
| --- | --- |
| `beforeTextInput` | Remove an empty-block `<br>` placeholder before typing. |
| `selectCurrentBlock` | Select current block and then enclosing scopes; contract reverses this. |
| `expandSelection` | Extend structural selection and sync it to native selection. |
| `splitBlock` | Split paragraph, heading, preformatted block, or list item. |
| `insertLineBreak` | Insert `<br>` in the current block. |
| `deleteSmart` | Delete selected blocks, remove an empty block, or merge backward. |
| `indent` / `dedent` | Indent or dedent current list item. |

The plugin binds these helpers directly to `editor` while installed:

| Helper | Purpose |
| --- | --- |
| `blockSelector()` / `blockFor(node)` | Resolve editable block elements. |
| `createBlock(tag?)` / `replaceBlock(block, tag)` | Create or replace an editable block. |
| `firstTextNode(node)` / `lastTextNode(node)` | Find descendant text nodes. |
| `ensureEditableContent(block, preferBr?)` | Ensure an empty block has a text node or `<br>`. |
| `moveCursorToBlockStart(block, session?)` / `moveCursorToBlockEnd(...)` | Place cursor at a block edge. |
| `currentEditableBlock(session?)` | Resolve the active block. |
| `selectCurrentBlock(session?, mode?)` | Expand or contract selection scopes programmatically. |
| `splitCurrentBlock(session?)` / `insertLineBreak(session?)` | Enter behavior primitives. |
| `indentCurrentListItem(session?)` / `dedentCurrentListItem(session?)` | List indentation primitives. |
| `deleteSelectedBlocks(session?)`, `deleteEmptyBlock(session?)`, `mergeBlockBackward(session?, event?)` | Smart deletion primitives. |

## Editing behavior

**Typing.** Empty-block `<br>` placeholders are removed before input. A normal
space is rejected when adjacent to whitespace (outside `pre` etc.) to avoid
doubles; instead the caret advances past a following space.

**Enter.** Paragraphs, `pre`, and list items split to the same tag. Headings use
their parent default, normally a paragraph. `Shift+Enter` inserts a line break.

**Lists and quotes.** Toggling `ul` or `ol` wraps a block as one list item;
toggling an active list unwraps direct items into paragraphs. Switching types
changes the list element. `Tab` nests an item under its preceding sibling;
`Shift+Tab` moves it outward. Toggling `blockquote` wraps the block or unwraps
its containing quote.

**Deletion.** A selection that fully contains blocks removes them. Deleting an
empty block moves to a neighbor. Backspace at a nonempty block start merges it
with the preceding editable block when possible.

**Clipboard.** Paste uses plain text, converts CRLF/CR to LF, and inserts it
through the active cursor.

## Toolbar actions

Dispatch a compact string or command object:

```js
editor.action("toggleInline:strong");
editor.action({ type: "toggleBlock", args: { tag: "blockquote" } });
editor.action({ type: "toggleBlock", args: { tag: "ul" } });
```

To support another format, add its schema rule, permit it in the appropriate
parent rules, extend the keymap/classes as needed, and implement its DOM
transform in a custom action or `Modification` subclass. A toolbar-only tag can
be rejected by the schema guard in the current editing context.
