# Editor Reference

Structural uses the DOM as its document model. `Editor` owns `editor.text`,
`editor.range`, `editor.selection`, and the active cursor at
`editor.input.cursor`.

```js
import { Editor, Modification } from "./src/js/structural/index.js";

const editor = new Editor(root, {
  caret: { node: document.querySelector("#caret"), mode: "virtual" },
  selection: { node: document.querySelector("#selection"), mode: "virtual" },
});
```

## Default keymap

`Editor` installs a default keymap when no `keymap` option is supplied.
`editorKeymap(overrides?)` returns the same map for composition with custom
bindings.

| Key | Behavior |
| --- | --- |
| Arrow keys | Move the structural cursor. |
| Shift+Arrow keys | Extend the current selection. |
| Mod+A | Select all editor content. |
| Mod+Shift+A | Collapse a selection to its focus end. |
| Backspace / Delete | Delete backward / forward, including an active selection. |

`Mod` means Ctrl on Windows/Linux and Command on macOS. The rich-text preset
overrides some bindings (notably `Mod+A`) with its structural block commands.

## Coordinates and structural nodes

Structural's logical indexes name **caret slots**, not JavaScript string
offsets. Text navigation is grapheme-aware, so a composed character or emoji is
one editing step. Convert with `editor.text.pointAt(index)` and
`editor.text.indexOfPoint({ node, offset })`.

| Class | Meaning |
| --- | --- |
| `.S`, `.skip`, `.skipped` | Exclude the subtree from editable traversal. |
| `.C`, `.container` | A partly intersecting selection expands to its bounds unless both endpoints are inside. |
| `.atom`, `.atomic` | Opaque selectable unit; an intersecting selection expands to include it. |

Schema-declared atoms behave the same way. The DOM remains the source of truth.
After external mutation, call `editor.text.refresh()` before a synchronous
position query; its mutation observer otherwise invalidates the index on the
next mutation turn.

## `TextAdapter`

`new TextAdapter(root, options?)` builds the logical position index. `Editor`
constructs one automatically.

| Option | Meaning |
| --- | --- |
| `acceptsText(position)` | Return `false` to make a position non-editable. |
| `skipFormattingWhitespace` | Whether formatting-only whitespace participates in navigation. |
| `eagerBlockCount` | Initially indexed top-level blocks; default `8`. |
| `maxCacheBytes` | Approximate position-cache cap; default `100 MiB`. |

| Method | Result |
| --- | --- |
| `attach()` / `detach()` | Start or stop DOM mutation observation. |
| `refresh()` | Invalidate and immediately rebuild positions. |
| `invalidatePositions()` | Mark positions stale. |
| `ensurePositions()` / `ensureIndex(index)` | Build the index, expanding its window as needed. |
| `positions()` | Return indexed position slots. |
| `clampIndex(index)` / `moveIndex(index, delta, options?)` | Clamp or navigate logical indexes. |
| `pointAt(index)` / `positionSlotAt(index)` | Get a DOM point or full slot metadata. |
| `indexOfPoint(point)` | Get the logical index for `{ node, offset }`, or `-1`. |
| `offsetWithin(root, point)` / `pointAtOffsetWithin(root, offset, bias?)` | Convert subtree-local grapheme offsets. |
| `indexFromPoint(x, y)` / `visualPositionAt(index)` | Resolve pointer coordinates or caret geometry. |
| `contextAt(index)` | Get neighboring characters, DOM point, boundary, and deletion context. |
| `insertAtIndex(index, text)` | Insert and return the next `{ index }`. |
| `deleteBackwardAtIndex(index)` / `deleteForwardAtIndex(index)` | Delete a grapheme or adjacent deletable node. |
| `insertAt(offset, text)`, `deleteAt(offset, length)`, `replaceAt(offset, length, text)` | Offset-based mutation helpers. |
| `textBetween(start, end)` | Read text represented by a logical interval. |

## `Caret` and `Cursor`

`Caret` renders a virtual caret. `Cursor` owns logical navigation, selection,
and simple text mutations.

```js
const editor = new Editor(root, {
  caret: { node: caretNode, mode: "virtual" },
  selection: { node: selectionNode, mode: "virtual" },
  skipFormattingWhitespace: true,
  preserveSemanticBoundaries: true,
  collapseBoundary: true,
});
```

`caret` accepts a DOM node, `{ node, mode, ...visualState }`, or `"virtual"` /
`"native"`. Without configuration, legacy `#caret` is used when it exists.
`Caret` exposes `setVirtual(position, options?)`, `set(node, offset, focus?)`,
`setFocused(focused)`, and `destroy()`.

Cursor state includes `offset`, `anchor`, `delta`, `direction`, `selectionKind`
(`"caret"`, `"range"`, or `"node"`), `selectedNode`, and `selection`.

| Method | Effect |
| --- | --- |
| `moveTo(index, options?)` | Move, normalize boundary positions, clear selection, and render the caret. |
| `left(extend?)`, `right(extend?)`, `up(extend?)`, `down(extend?)` | Navigate; `true` extends a range selection. |
| `select(start, endOrOptions?)` | Make a range selection or select a structural target. |
| `selectNode(node, options?)`, `selectAtom(node, side?)`, `selectContainer(node, side?)` | Select structural nodes. |
| `insertText(text)` | Insert text, replacing a range or selected node first. |
| `backspace()` / `delete()` | Delete backward/forward, or remove a range/node selection. |
| `offsetFromPoint(x, y)` / `offsetFromPointIn(node, x, y)` | Resolve pointer coordinates to an editable index. |
| `getContext()` | Return context at the cursor offset. |

Cursor moves emit `CursorMove` on the editor root. `event.detail.previous` and
`event.detail.current` are snapshots; current includes requested/resolved
offsets, slot/boundary data, and virtual-caret state.

## `Shorthands`

`Shorthands` recognizes configurable trigger/query pairs and emits popup and
document events. Install it with schema atom rules for custom elements:

```js
import { Editor, RichText, Shorthands, richTextSchema } from "structural";

const editor = new Editor(root, {
  schema: richTextSchema({}, { atoms: ["structural-date"] }),
  plugins: [RichText, new Shorthands({
    definitions: [
      { id: "tag", trigger: "#", source: findTags },
      { id: "mention", trigger: "@", source: findPeople },
      { id: "task", trigger: "+", source: findTasks },
      {
        id: "date", trigger: "@", pattern: /^\d{4}-\d{2}-\d{2}$/,
        auto: "delimiter", element: "structural-date",
      },
      { id: "topic", trigger: "!", source: findTopics },
    ],
  })],
});
```

Date shorthands are committed automatically before whitespace or punctuation.
Other definitions are committed with `editor.shorthands.pick(item)` from an
application popup, or with Enter/Tab when source items are available. The
plugin emits `ShorthandOpen`, `ShorthandChange`, `ShorthandCommit`, and
`ShorthandDismiss` on the editor root. A commit also emits `DocumentChange`
with `detail.kind === "shorthand-commit"`.

## `TextSelection` and `SelectionOverlay`

`TextSelection` stores logical anchor and focus offsets. Its default mode is
`"virtual"`; use `"native"` to apply browser selection. Pass `{ node }` to host
virtual highlight rectangles; legacy `#selection` is used when present.

```js
const cursor = editor.input.cursor;
cursor.select(3, 12);
const range = cursor.selection.normalizedRange();
cursor.selection.apply();
```

| Method/property | Meaning |
| --- | --- |
| `isActive`, `isCollapsed`, `start`, `end` | Selection state and ordered bounds. |
| `set(anchor, focus)` / `extendTo(offset)` | Set or extend endpoints. |
| `collapseTo(offset)` / `clear()` | Collapse or remove selection. |
| `normalizedRange()` | Return bounds after atom/container expansion. |
| `toDomRange(normalized?)` | Convert a non-collapsed selection to `Range`. |
| `apply()` | Render selection in the configured mode. |
| `replaceWithText(text)` | Replace selected DOM content and return `{ index }`. |

`SelectionOverlay` is the lower-level renderer. Construct it with a node or
`{ node, mode, container?, ...stateConfig }`, then call `apply(range, mode)`,
`clear()`, or `destroy()`. Virtual caret and selection hosts are mounted as
**siblings of the editor root** (under the root's parent) so they share the same
scroll and offset parent as the edited content. Highlight and caret coordinates
are host/offset-parent relative, not document-absolute.

Place the hosts next to the editor inside a shared shell when the editor scrolls
inside an overflow container:

```html
<div class="editor-shell" style="position: relative; overflow: auto">
  <div id="editor">…</div>
  <div id="selection" aria-hidden="true"></div>
  <div id="caret" aria-hidden="true"></div>
</div>
```

## `EditorSelectionController`

`editor.selection` synchronizes browser ranges and structural cursor state.

| Method | Effect |
| --- | --- |
| `setCaret(node, offset, session?)` | Resolve a DOM point and move the active cursor. |
| `select(start, end, session?)` | Make a structural range selection. |
| `placeCaretFromPoint(root, x, y, session?, options?)` | Place from pointer coordinates; `fallback: "none"` disables edge snapping. |
| `previewCaretAtIndex(index, session?, options?)` | Update only the virtual caret for previews. |
| `previewCaretFromPoint(root, x, y, session?, options?)` | Coordinate-based preview equivalent. |
| `syncToNative(session?)` | Write active caret/range to `window.getSelection()`. |
| `syncFromNative(root?, session?)` | Read a browser range inside `root` into the cursor. |

`syncToNative()` is a no-op when the active session has `nativeSelection: "none"`.

## `EditorRangeController`

`editor.range` provides DOM `Range` helpers scoped to the editor or a subtree.

| Method | Effect |
| --- | --- |
| `within(root, range)` | Whether both range endpoints are inside `root`. |
| `current(root?, session?)` | Current native range when valid, else structural caret/range. |
| `selected(root?, session?)` | Current non-collapsed range, or `null`. |
| `atBlockStart(range, block)` / `atBlockEnd(range, block)` | Check a collapsed range against a block edge. |
| `split(range)` | Delete selected contents and collapse to its start. |
| `snapshot(root?, session?)` | Save selection as subtree-local grapheme `{ start, end }`. |
| `restore(snapshot, root?, session?)` | Restore a saved snapshot after mutation. |

## `Modification`

`Modification` performs rich-text DOM transforms while preserving cursor or
selection where possible. Construct it with an editor or session.

```js
const modification = new Modification(editor);
editor.configureActions({
  toggleInline: command => modification.toggleInline(command.args.tag),
  toggleBlock: command => modification.toggleBlock(command.args.tag),
});
```

| Method | Effect |
| --- | --- |
| `formats()` | Active `strong`, `em`, `code`, heading, list, and blockquote flags. |
| `allowsInline(tag)` / `allowsBlock(tag)` | Check current schema context. |
| `toggleInline(tag)` | Wrap/unwrap selection; uses surrounding word if available. |
| `toggleBlock(tag)` | Toggle heading, `ul`/`ol`, or `blockquote` on the current block. |
| `rangeFromCursor()` / `expandToWord()` | Resolve active DOM range or word range. |
| `wrapRange(range, tag)` / `unwrapElement(element)` | Low-level inline transforms. |
| `changeTagName(element, tag)` | Replace an element while retaining children and attributes. |
| `findBlock(node)` / `unwrapList(list)` | Block and list helpers. |

Formatting APIs mutate live DOM. Do not retain DOM ranges or points across a
format operation; obtain them again after the mutation completes.
