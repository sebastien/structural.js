// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License

// Module: anchor
// Content-fingerprint cursor anchoring across external document replacement.
//
// The cursor is offset-indexed, so a wholesale document replace restores the
// same integer and the caret drifts whenever text before it changed. Anchors
// describe each selection end relative to its block (tag, index, text context)
// before the replace and re-resolve to fresh nodes after, falling back to the
// numeric behavior when nothing matches. Dependency-free apart from the editor
// interface (root, blockFor, blockSelector, text, localSession).

// Characters of text context kept on each side of an anchored offset.
const CONTEXT = 24;

// Grapheme segmentation, matching TextAdapter so anchored offsets agree with
// editor.text (Array.from would split by code point, not cluster).
const GRAPHEME_SEGMENTER =
	typeof Intl !== "undefined" && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

// Function: graphemes
// Splits text into grapheme clusters so offsets stay correct past emoji.
function graphemes(text) {
	const value = String(text ?? "");
	if (!GRAPHEME_SEGMENTER) return Array.from(value);
	return [...GRAPHEME_SEGMENTER.segment(value)].map((part) => part.segment);
}

// Function: lastIndexOfGraphemes
// Last index at which needle occurs in hay (grapheme arrays), or -1.
function lastIndexOfGraphemes(hay, needle) {
	if (!needle.length) return -1;
	outer: for (let i = hay.length - needle.length; i >= 0; i--) {
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

// Function: indexOfGraphemes
// First index at which needle occurs in hay (grapheme arrays), or -1.
function indexOfGraphemes(hay, needle) {
	if (!needle.length) return -1;
	outer: for (let i = 0; i + needle.length <= hay.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

// Function: blocksOf
// Block elements of the editor root in document order.
function blocksOf(editor) {
	if (!editor?.root) return [];
	return [...editor.root.querySelectorAll(editor.blockSelector())];
}

// Function: describeEnd
// Describes a global offset relative to its block for later re-resolution.
function describeEnd(editor, offset) {
	const point = editor.text.pointAt(offset);
	const block = point?.node ? editor.blockFor(point.node) : null;
	if (!block) return { kind: "global", fallback: offset };
	const blocks = blocksOf(editor);
	const chars = graphemes(block.textContent);
	const inner = Math.max(
		0,
		Math.min(chars.length, editor.text.offsetWithin(block, point)),
	);
	return {
		kind: "block",
		tag: block.tagName.toLowerCase(),
		blockIndex: blocks.indexOf(block),
		inner,
		length: chars.length,
		leading: chars.slice(Math.max(0, inner - CONTEXT), inner).join(""),
		trailing: chars.slice(inner, inner + CONTEXT).join(""),
		fallback: offset,
	};
}

// Function: captureAnchor
// Captures the current selection as re-resolvable block anchors. An inactive
// text selection carries no numbers, so a plain caret falls back to the
// cursor offset (mirrors the setContent numeric fallback).
function captureAnchor(editor, session = editor.localSession) {
	const cursor = session?.cursor;
	const range = cursor?.selection?.normalizedRange?.() ?? {};
	const fallback = cursor?.offset ?? 0;
	const start = typeof range.start === "number" ? range.start : fallback;
	const end = typeof range.end === "number" ? range.end : start;
	const collapsed = range.collapsed ?? start === end;
	const ends = collapsed ? [start] : [start, end];
	return { collapsed, ends: ends.map((offset) => describeEnd(editor, offset)) };
}

// Function: mapInner
// Maps an anchored within-block offset onto fresh block text via context.
// Boundary offsets stick to the block structure; interior offsets follow
// their content. When neither context survives, the neighborhood is gone:
// land at the block start rather than a meaningless interior offset.
function mapInner(chars, end) {
	if (end.inner <= 0) return 0;
	if (end.inner >= (end.length ?? end.inner)) return chars.length;
	const leading = graphemes(end.leading);
	const trailing = graphemes(end.trailing);
	if (leading.length) {
		const at = lastIndexOfGraphemes(chars, leading);
		if (at >= 0) return Math.min(chars.length, at + leading.length);
	}
	if (trailing.length) {
		const at = indexOfGraphemes(chars, trailing);
		if (at >= 0) return Math.min(chars.length, at);
	}
	return 0;
}

// Function: resolveEnd
// Re-resolves one anchored end to a global offset in the current document.
// The best-scoring block wins, but only on actual context evidence;
// otherwise the numeric fallback preserves the legacy behavior exactly.
function resolveEnd(editor, blocks, end) {
	const fallback = () => editor.text.clampIndex(end.fallback ?? 0);
	if (end.kind !== "block" || !blocks.length) return fallback();
	let best = null;
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const chars = graphemes(block.textContent);
		let score = -Math.min(12, Math.abs(i - end.blockIndex));
		if (block.tagName.toLowerCase() === end.tag) score += 8;
		const leading = graphemes(end.leading);
		const trailing = graphemes(end.trailing);
		let hit = false;
		if (leading.length && lastIndexOfGraphemes(chars, leading) >= 0) {
			score += leading.length * 2;
			hit = true;
		}
		if (trailing.length && indexOfGraphemes(chars, trailing) >= 0) {
			score += trailing.length * 2;
			hit = true;
		}
		if (!best || score > best.score) best = { block, score, hit };
	}
	if (!best?.hit) return fallback();
	const inner = mapInner(graphemes(best.block.textContent), end);
	const point = editor.text.pointAtOffsetWithin(best.block, inner, "forward");
	if (!point?.node) return fallback();
	return editor.text.indexOfPoint(point);
}

// Function: resolveAnchor
// Re-resolves a captured anchor to global {start, end} offsets.
function resolveAnchor(editor, anchor) {
	if (!anchor) return null;
	const blocks = blocksOf(editor);
	const ends = anchor.ends.map((end) => resolveEnd(editor, blocks, end));
	if (anchor.collapsed || ends.length < 2) {
		const at = ends[0] ?? editor.text.clampIndex(0);
		return { start: at, end: at };
	}
	return { start: Math.min(ends[0], ends[1]), end: Math.max(ends[0], ends[1]) };
}

export { captureAnchor, resolveAnchor };
