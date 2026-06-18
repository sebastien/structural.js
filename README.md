```
   _____ __                  __                   __    _
  / ___// /________  _______/ /___  ___________ _/ /   (_)____
  \__ \/ __/ ___/ / / / ___/ __/ / / / ___/ __ `/ /   / / ___/
 ___/ / /_/ /  / /_/ / /__/ /_/ /_/ / /  / /_/ / /   / (__  )
/____/\__/_/   \__,_/\___/\__/\__,_/_/   \__,_/_(_)_/ /____/
                                                 /___/
```

*Structural.js* is a lightweight toolkit for building structural, document-backed, and rich text editors for the Web. It uses the DOM as the source of truth, so there is no separate AST or serialization layer to keep in sync.

Instead of managing a custom schema and AST representation, Structural operates directly on standard DOM elements, using class-based semantic markup (`.C`/`.container`, `.S`/`.skip`/`.skipped`, and `.atom`/`.atomic`) to model structured nodes. The cursor can traverse the document linearly using keyboard navigation or point-and-click, treating read-only or template structures as cohesive, interactive boundaries.

The design principle for Structural is to not get in the way: you manage the DOM as you want, and Structural will manage the editing and updating part of it. Changes can be subscribed to so that you can maintain a separate representation if you want to. This sets Structural apart from most other editors, and makes it more versatile.

Key features are:

- **DOM first**: No AST or intermediate JSON schema is required, the DOM is the source of truth.
- **Editable fragments**: You can specify how any DOM element is editable or selectable.
- **Virtual Caret & Selection**: Visual selection overlays and caret positioning without breaking native editing.
- **Rich Text Helpers**: Built-in schema, keymap, class, and mutation helpers for common editing flows.
- **Framework Agnostic**: Zero runtime dependencies; works with plain DOM or any framework that can host a content tree.

The public entrypoint for bundlers is [`src/js/structural/index.js`](src/js/structural/index.js). In the browser, the examples import the source modules directly through an import map.

You can learn more about each component:

- **Editor**: Main orchestrator, commands, transactions, schema helpers ― [source](src/js/structural/editor.js)
- **TextAdapter**: DOM-backed coordinate mapping and positions index ― [source](src/js/structural/text.js)
- **Cursor & Caret**: Navigation, selection, and mutation tracking ― [source](src/js/structural/cursor.js)
- **TextSelection**: Range boundary normalization and overlays ― [source](src/js/structural/selection.js)
- **Modification**: Rich text and block structure mutations ― [source](src/js/structural/modification.js)

## In a nutshell

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    .editor { max-width: 600px; margin: 2rem auto; line-height: 1.6; }
    .focus { outline: 2px solid #0056cc; }
    .atom { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "structural/editor": "./src/js/structural/editor.js"
    }
  }
  </script>
</head>
<body>

<div id="editor" class="editor">
  <h1>Editable Document</h1>
  <p>Modify this text, or interact with this <span class="atom">{AtomicToken}</span>.</p>
</div>

<div id="selection" style="position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;"></div>
<div id="caret" style="position:absolute;height:1lh;width:1px;background-color:#0056cc;visibility:hidden;pointer-events:none;"></div>

<script type="module">
import { Editor } from "structural/editor";

const editor = new Editor(document.getElementById("editor"));

editor.root.addEventListener("CursorMove", (event) => {
  const { previous, current } = event.detail;
  previous.anchor?.classList?.remove("focus");
  current.anchor?.classList?.add("focus");
});
</script>

</body>
</html>
```

### Import styles

```html
<script type="module">
import { Editor, Modification, richTextSchema } from "./src/js/structural/index.js";
</script>
```

### API

- `Editor(rootNode, options?)`: Main orchestrator wrapping the DOM tree.
- `EditorSession`: Session state for the active editor.
- `Command`: Serializable editor command representation.
- `Transaction`: Command execution and step tracking.
- `Normalizer`: Schema-driven content normalization.
- `ClassTracker`: Class synchronization helper for structural state.
- `Schema`: Base structure schema validator interface.
- `Adapter`: Base storage/AST representation adapter.
- `richTextSchema(overrides?, options?)`: Default rich text schema helper.
- `richTextKeymap(overrides?)`: Default rich text keymap helper.
- `richTextClasses(options?)`: Default rich text class helper.
- `richTextNormalizer(schema?, options?)`: Default rich text normalizer helper.
- `EditorRangeController`: DOM range controller for subtree snapshots and restoration.
- `EditorSelectionController`: Native/structural selection synchronization controller.
- `TextAdapter(rootNode, options?)`: Linear mapping agent indexing the DOM tree into caret positions.
- `Cursor(input, options?)`: State-holder driving navigation, selection, and mutation coordinates.
- `Caret(caretNode)`: Virtual caret placement helper.
- `TextSelection(cursor, options?)`: Selection coordinator mapping ranges to structural boundaries.
- `SelectionOverlay(overlayNode)`: Helper drawing virtual highlighting rectangles.
- `Modification(editor, options?)`: High-level utility for rich-text styling and block transforms.

### Modules

- [`src/js/structural/index.js`](src/js/structural/index.js): Public re-export surface.
- [`src/js/structural/editor.js`](src/js/structural/editor.js): `Editor`, `EditorSession`, `Command`, `Transaction`, `Normalizer`, `ClassTracker`, `Schema`, `Adapter`, and rich text helpers.
- [`src/js/structural/range.js`](src/js/structural/range.js): `EditorRangeController`.
- [`src/js/structural/text.js`](src/js/structural/text.js): `TextAdapter`.
- [`src/js/structural/cursor.js`](src/js/structural/cursor.js): `Caret` and `Cursor`.
- [`src/js/structural/selection.js`](src/js/structural/selection.js): `EditorSelectionController`, `SelectionOverlay`, and `TextSelection`.
- [`src/js/structural/modification.js`](src/js/structural/modification.js): `Modification`.

### Notable examples

- [`examples/app-richtext.example.html`](examples/app-richtext.example.html): Rich text toolbar, keyboard shortcuts, and inline/block mutations.
- [`examples/app-structure.example.html`](examples/app-structure.example.html): Structural semantics and cursor traversal.
- [`examples/app-mentions.example.html`](examples/app-mentions.example.html): Atomic variables and mention-style inline annotations.
- [`examples/app-annotation.example.html`](examples/app-annotation.example.html): DOM-backed feedback and annotations alongside primary text.
- [`examples/app-template.example.html`](examples/app-template.example.html): Structured email template editing with conditional blocks and placeholders.
- [`examples/app-emailtemplate.example.html`](examples/app-emailtemplate.example.html): Full email template editor example with toolbar, selection, and caret rendering.


