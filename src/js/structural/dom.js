// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-08-03

// Module: dom
// Shared DOM helpers used across text, selection, richtext, and blocks.

// Default block-level tags when no schema is available.
export const DEFAULT_BLOCK_SELECTOR =
	"p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, div, section, nav, header";

// Function: asElement
// Returns the element for a node (itself or its parentElement).
export function asElement(node) {
	if (!node) return null;
	return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

// Function: firstTextNode
// First descendant text node within `root` (or root if it is a text node).
export function firstTextNode(root) {
	if (!root) return null;
	if (root.nodeType === Node.TEXT_NODE) return root;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	return walker.nextNode();
}

// Function: lastTextNode
// Last descendant text node within `root` (or root if it is a text node).
export function lastTextNode(root) {
	if (!root) return null;
	if (root.nodeType === Node.TEXT_NODE) return root;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let text = null;
	while (walker.nextNode()) text = walker.currentNode;
	return text;
}

// Function: blockSelectorFromSchema
// CSS selector for schema block tags that hold text (plus blockquote).
// Falls back to DEFAULT_BLOCK_SELECTOR when the schema has no block rules.
export function blockSelectorFromSchema(schema, fallback = DEFAULT_BLOCK_SELECTOR) {
	if (schema && typeof schema.tagsOfType === "function") {
		const tags = schema
			.tagsOfType("block")
			.filter((tag) =>
				schema.contains ? schema.contains(tag, "#text") || tag === "blockquote" : true,
			);
		if (tags.length) return tags.join(", ");
	}
	return fallback;
}

// Function: wordBoundsInData
// Code-unit {start,end} of the word at `offset` inside a string, or null.
// At a boundary after a word char, prefers the word to the left.
export function wordBoundsInData(data, offset) {
	if (typeof data !== "string" || !Number.isFinite(offset)) return null;
	let start = Math.max(0, Math.min(offset | 0, data.length));
	let end = start;
	if (
		start > 0 &&
		start === end &&
		!/\w/.test(data[start] ?? "") &&
		/\w/.test(data[start - 1] ?? "")
	) {
		start -= 1;
		end = start + 1;
	}
	while (start > 0 && /\w/.test(data[start - 1])) start -= 1;
	while (end < data.length && /\w/.test(data[end])) end += 1;
	if (start === end) return null;
	return { start, end };
}

// Function: wordRangeAtIndex
// Structural {start,end} covering the word at logical position `index`, or null.
// `text` is a TextAdapter-like object (pointAt, indexOfPoint, ensureIndex).
export function wordRangeAtIndex(text, index) {
	if (!text || index == null) return null;
	text.ensureIndex?.(index);
	const point = text.pointAt(index);
	if (!point || point.node?.nodeType !== Node.TEXT_NODE) return null;
	const bounds = wordBoundsInData(point.node.data, point.offset);
	if (!bounds) return null;
	const startIndex = text.indexOfPoint({ node: point.node, offset: bounds.start });
	const endIndex = text.indexOfPoint({ node: point.node, offset: bounds.end });
	if (startIndex < 0 || endIndex < startIndex) return null;
	return { start: startIndex, end: endIndex };
}
