```
   _____ __                  __                   __    _
  / ___// /________  _______/ /___  ___________ _/ /   (_)____
  \__ \/ __/ ___/ / / / ___/ __/ / / / ___/ __ `/ /   / / ___/
 ___/ / /_/ /  / /_/ / /__/ /_/ /_/ / /  / /_/ / /   / (__  )
/____/\__/_/   \__,_/\___/\__/\__,_/_/   \__,_/_(_)_/ /____/
                                                 /___/
```

*Structural.js* is a lightweight toolkit for building structural, document-backed, and rich text editors for the Web. It is designed to use the DOM as the source of truth for the document. Because it doesn't require an AST (Abstract Syntax Tree), it avoids complex synchronization or serialization layers, working seamlessly with any web framework or raw DOM-based rendering.

Instead of managing a custom schema and AST representation, Structural operates directly on standard DOM elements, using class-based semantic markup (`.C`/`.container`, `.S`/`.skip`/`.skipped`, and `.atom`/`.atomic`) to model structured nodes. The cursor can traverse the document linearly using keyboard navigation or point-and-click, treating read-only or template structures as cohesive, interactive boundaries.

You can learn more about each component:

- **Editor**: Main orchestrator and event hub ― [source](src/js/structural/editor.js)
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
    /* Atoms are selectable but not editable */
    .atom { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "structural/editor": "./src/js/structural/editor.js",
      "structural/modification": "./src/js/structural/modification.js"
    }
  }
  </script>
</head>
<body>

<div id="toolbar">
  <button id="btn-bold">Bold</button>
  <button id="btn-h1">Heading 1</button>
</div>

<div id="editor" class="editor">
  <h1>Editable Document</h1>
  <p>Modify this text, or interact with this <span class="atom">{AtomicToken}</span>.</p>
</div>

<!-- Virtual Selection & Caret elements -->
<div id="selection" style="position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;"></div>
<div id="caret" style="position:absolute;height:1lh;width:1px;background-color:#0056cc;visibility:hidden;pointer-events:none;"></div>

<script type="module">
import { Editor } from "structural/editor";
import { Modification } from "structural/modification";

const editor = new Editor(document.getElementById("editor"));
const mod = new Modification(editor);

// Bind toolbar actions
document.getElementById("btn-bold").addEventListener("click", () => mod.toggleInline("strong"));
document.getElementById("btn-h1").addEventListener("click", () => mod.toggleBlock("h1"));

// Custom styling on cursor movement
editor.root.addEventListener("CursorMove", (event) => {
  const { previous, current } = event.detail;
  previous.anchor?.classList?.remove("focus");
  current.anchor?.classList?.add("focus");
});
</script>

</body>
</html>
```

### CDN usage (jsDelivr)

```html
<script type="importmap">
{
  "imports": {
    "structural/editor": "https://cdn.jsdelivr.net/gh/sebastien/structural.js@v0.1.0/src/js/structural/editor.js",
    "structural/modification": "https://cdn.jsdelivr.net/gh/sebastien/structural.js@v0.1.0/src/js/structural/modification.js"
  }
}
</script>

<script type="module">
import { Editor } from "structural/editor";
import { Modification } from "structural/modification";
</script>
```

### API

- `Editor(rootNode, options?)`: Main orchestrator wrapping the DOM tree, initializing the text adapter and text inputs.
- `TextAdapter(rootNode, options?)`: Linear mapping agent indexing the DOM tree structure into editable caret positions.
- `Cursor(input, options?)`: State-holder driving horizontal/vertical movement, selection, and mutation coordinates.
- `Caret(caretNode)`: Virtual caret placement agent responsible for drawing and positioning the visual caret.
- `TextSelection(cursor, options?)`: Selection coordinator mapping native or virtual ranges to structural element boundaries.
- `SelectionOverlay(overlayNode)`: Graphic helper drawing virtual highlighting rectangles aligned with current ranges.
- `Modification(editor, options?)`: High-level utility for mutative rich-text styling (inline/block tags) and schema verification.
- `Schema`: Base structure schema validator interface.
- `Adapter`: Base storage/AST representation adapter.

### Modules

- [`src/js/structural/editor.js`](src/js/structural/editor.js): Contains the `Editor` core, `TextInput` (keyboard event router), and base `Schema`/`Adapter` classes.
- [`src/js/structural/text.js`](src/js/structural/text.js): Implements `TextAdapter`, coordinating DOM MutationObservers and translating structural layout to a linear index space.
- [`src/js/structural/cursor.js`](src/js/structural/cursor.js): Implements the interactive `Cursor` driver and visual `Caret` placement rendering.
- [`src/js/structural/selection.js`](src/js/structural/selection.js): Implements `TextSelection` and `SelectionOverlay` for boundary-aware selection styling.
- [`src/js/structural/modification.js`](src/js/structural/modification.js): Implements `Modification`, handling inline toggles (e.g. bold, italic, code) and block transformations (e.g. lists, blockquotes, headings).

### Notable examples

- [`examples/app-richtext.example.html`](examples/app-richtext.example.html): Demonstrates a standard rich text editor toolbar with keyboard shortcuts and inline/block mutation commands.
- [`examples/app-structure.example.html`](examples/app-structure.example.html): Highlights structural semantics (`skip` vs `atom` vs `container` elements) and keyboard traversal.
- [`examples/app-mentions.example.html`](examples/app-mentions.example.html): Illustrates inline annotation structures like atomic variables and editable mention elements (`C mention`).
- [`examples/app-annotation.example.html`](examples/app-annotation.example.html): Features DOM-backed inline document feedback and annotations where suggestions live alongside primary text.
- [`examples/app-template.example.html`](examples/app-template.example.html): Showcases a structured email template builder with conditional blocks, repeats, placeholders, and interactive fields.

# Features

- *DOM as Source of Truth*: No AST or intermediate JSON schemas are required; state is mapped directly to content elements.
- *Atomic & Skipped Boundaries*: Supports read-only tags (`.atom`/`.atomic`), skipped visual decorators (`.skip`/`.skipped`), and nested editable spaces (`.container`/`.C`).
- *Virtual Caret & Selection*: Precise visual selection blocks and caret alignments that integrate perfectly without breaking layout or native select behaviors.
- *Horizontal & Vertical Precision*: Multi-directional key navigation keeping track of column boundaries, letter spacing, and line moves (with `_desiredX`).
- *Built-in Mutations & Schema Support*: Safe toggling of rich-text decorations with layout-aware unwrapping, replacement, and block promotion guards.
- *Framework Agnostic*: Zero dependencies, works natively using modern ES modules (ESM) in any browser.
