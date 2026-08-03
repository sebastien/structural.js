// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

import { EditorNormalizer } from "../../document/normalizer.js";
import { EditorSchema } from "../../schema.js";

const richTextRules = {
	":root": {
		type: "root",
		contains: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre", "ul", "ol", "blockquote"],
		default: "p",
		normalize: { empty: "fill", text: "wrap", invalidChild: "lift" },
	},
	"@inline": ["strong", "em", "code"],
	section: { type: "block", contains: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre", "ul", "ol", "blockquote"], default: "p", normalize: { empty: "prune", text: "wrap", invalidChild: "lift" } },
	nav: { type: "block", contains: ["header", "h1", "h2", "h3", "p", "pre", "ul", "ol", "blockquote"], default: "p", normalize: { empty: "prune", text: "wrap", invalidChild: "lift" } },
	header: { type: "block", contains: ["h1", "h2", "h3", "p", "pre", "ul", "ol", "blockquote"], default: "p", normalize: { empty: "prune", text: "wrap", invalidChild: "lift" } },
	blockquote: { type: "block", contains: ["p", "h1", "h2", "h3", "pre", "ul", "ol"], default: "p", normalize: { empty: "prune", text: "wrap", invalidChild: "lift" } },
	ul: { type: "block", contains: ["li", "ul", "ol"], absorb: ["ul"], default: "li", normalize: { empty: "prune", invalidChild: "wrap" } },
	ol: { type: "block", contains: ["li", "ul", "ol"], absorb: ["ol"], default: "li", normalize: { empty: "prune", invalidChild: "wrap" } },
	li: { type: "block", contains: ["#text", "@inline", "p", "ul", "ol"], wrapIn: "ul", default: "p", normalize: { empty: "placeholder", text: "preserve", invalidChild: "lift" }, enter: { next: "same" } },
	p: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "same" } },
	pre: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", text: "preserve", invalidChild: "unwrap" }, enter: { next: "same" } },
	h1: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	h2: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	h3: { type: "block", contains: ["#text", "@inline"], normalize: { empty: "placeholder", invalidChild: "unwrap" }, enter: { next: "parentDefault" } },
	strong: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	em: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	code: { type: "inline", contains: ["#text"], normalize: { empty: "unwrap", invalidChild: "lift" } },
};

// Function: richTextSchema
// Creates a default EditorSchema configured with standard rich-text formatting rules.
function richTextSchema(overrides = {}, options = {}) {
	const atoms = Array.isArray(options.atoms) ? options.atoms : [];
	const atomRules = Object.fromEntries(
		atoms.map((tag) => [tag, { type: "atom", render: { track: false } }]),
	);
	return new EditorSchema({ ...richTextRules, ...atomRules, ...overrides }, {
		aliases: { b: "strong", i: "em", ...(options.aliases ?? {}) },
		atoms,
		normalize: {
			unknownElement: "unwrap",
			pruneEmptyText: true,
			...options.normalize,
		},
	});
}

// Function: richTextNormalizer
// Helper to construct a standard EditorNormalizer.
function richTextNormalizer(schema = richTextSchema(), options = {}) {
	return new EditorNormalizer(schema, options);
}

export { richTextNormalizer, richTextRules, richTextSchema };
