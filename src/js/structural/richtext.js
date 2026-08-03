// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-26

// Module: richtext
// Installs rich-text schema presets, keymaps, classes, and block editing behavior.

import { RichText } from "./features/richtext/plugin.js";
import { richTextClasses } from "./features/richtext/classes.js";
import { richTextKeymap } from "./features/richtext/keymap.js";
import { richTextNormalizer, richTextRules, richTextSchema } from "./features/richtext/schema.js";

export { RichText, richTextClasses, richTextKeymap, richTextNormalizer, richTextRules, richTextSchema };

// Short aliases for convenient default import usage:
//   import richtext from "structural/richtext"
//   richtext.schema(...)
//   new Editor(node, { ...richtext.options, caret: ... })
export {
  richTextSchema as schema,
  richTextKeymap as keymap,
  richTextClasses as classes,
  richTextNormalizer as normalizer,
  richTextRules as rules,
};

const richtext = {
  RichText,
  schema: richTextSchema,
  keymap: richTextKeymap,
  classes: richTextClasses,
  normalizer: richTextNormalizer,
  rules: richTextRules,
  options: {
    schema: richTextSchema({}, { atoms: ["aos-ref", "aos-key"] }),
    keymap: richTextKeymap(),
    classes: richTextClasses(),
    plugins: [RichText],
  },
};

export { richtext };
export default richtext;

// EOF
