// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-26

// Module: richtext
// Installs rich-text schema presets, keymaps, classes, and block editing behavior.

import { editorKeymap, EditorNormalizer, EditorSchema } from "./editor.js";

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

// Function: richTextKeymap
// Returns standard key binding maps for structural formatting.
function richTextKeymap(overrides = {}) {
	return editorKeymap({
		"Mod+B": { type: "toggleInline", args: { tag: "strong" } },
		"Mod+I": { type: "toggleInline", args: { tag: "em" } },
		"Mod+`": { type: "toggleInline", args: { tag: "code" } },
		"Mod+1": { type: "toggleBlock", args: { tag: "h1" } },
		"Mod+2": { type: "toggleBlock", args: { tag: "h2" } },
		"Mod+3": { type: "toggleBlock", args: { tag: "h3" } },
		"Mod+ArrowLeft": { type: "moveCursor", args: { direction: "left", word: true } },
		"Mod+ArrowRight": { type: "moveCursor", args: { direction: "right", word: true } },
		"Mod+Shift+ArrowLeft": {
			type: "moveCursor",
			args: { direction: "left", word: true, extend: true },
		},
		"Mod+Shift+ArrowRight": {
			type: "moveCursor",
			args: { direction: "right", word: true, extend: true },
		},
		"Mod+C": { type: "copy" },
		"Mod+X": { type: "cut" },
		// Paste is handled only via the document `paste` event (has clipboardData).
		// Binding Mod+V on keydown would preventDefault and force async clipboard.readText,
		// which is often denied — so paste would silently no-op.
		Enter: { type: "splitBlock" },
		"Shift+Enter": { type: "insertLineBreak" },
		Tab: { type: "indent" },
		"Shift+Tab": { type: "dedent" },
		Backspace: { type: "deleteSmart" },
		Delete: { type: "deleteSmart" },
		...overrides,
	});
}

// Function: richTextClasses
// Standard CSS class selectors and states for styling focus and selections.
function richTextClasses(options = {}) {
	return {
		selector: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre", "li", "blockquote", "strong", "em", "code"],
		focus: "focus",
		focusWithin: "focus-within",
		selected: "selected",
		selectedWithin: "selected-within",
		...options,
	};
}

// Function: richTextNormalizer
// Helper to construct a standard EditorNormalizer.
function richTextNormalizer(schema = richTextSchema(), options = {}) {
	return new EditorNormalizer(schema, options);
}

// Class: RichText
// Installs rich-text editing helpers and default block-level commands into an Editor.
class RichText {
	static pluginName = "richtext";

	constructor(options = {}) {
		this.options = options;
		this.editor = null;
		this.boundMethods = new Map();
		this._onCopy = this.onCopy.bind(this);
		this._onCut = this.onCut.bind(this);
		this._onPaste = this.onPaste.bind(this);
		// Timestamp of the last keymap clipboard chord so document events do not double-apply.
		this._clipboardChordAt = 0;
	}

	attach(editor) {
		this.editor = editor;
		editor.richText = this;
		document.addEventListener("copy", this._onCopy);
		document.addEventListener("cut", this._onCut);
		document.addEventListener("paste", this._onPaste);
		this.attachEditorMethods([
			"blockSelector",
			"blockFor",
			"createBlock",
			"replaceBlock",
			"firstTextNode",
			"lastTextNode",
			"pruneEmptyTextChildren",
			"ensureEditableContent",
			"moveCursorToBlockStart",
			"moveCursorToBlockEnd",
			"firstBlockIn",
			"lastBlockIn",
			"blockText",
			"isEmptyBlock",
			"removePlaceholderInCurrentBlock",
			"shouldInsertText",
			"currentEditableBlock",
			"isFullySelectedBlock",
			"fullySelectedBlocks",
			"removeBlock",
			"deleteSelectedBlocks",
			"deleteEmptyBlock",
			"previousEditableBlock",
			"mergeBlockBackward",
			"exitEmptyBlock",
			"splitBlockElement",
			"splitListItem",
			"insertLineBreak",
			"splitCurrentBlock",
			"indentListItem",
			"dedentListItem",
			"currentListItem",
			"indentCurrentListItem",
			"dedentCurrentListItem",
		]);
		editor.configureActions({
			beforeTextInput: (_command, context) => this.removePlaceholderInCurrentBlock(context.session),
			splitBlock: (_command, context) => this.splitCurrentBlock(context.session),
			insertLineBreak: (_command, context) => this.insertLineBreak(context.session),
			deleteSmart: (_command, context) =>
				this.editor.history.run("delete", () => {
					if (
						this.deleteSelectedBlocks(context.session) ||
						this.deleteEmptyBlock(context.session) ||
						this.mergeBlockBackward(context.session, context.event)
					) {
						return true;
					}
					// Character-level delete when no block merge/empty-block path matched.
					if (context.event?.key === "Delete") context.session.cursor.delete();
					else context.session.cursor.backspace();
					return true;
				}),
			indent: (_command, context) => this.indentCurrentListItem(context.session),
			dedent: (_command, context) => this.dedentCurrentListItem(context.session),
			// Copy/cut key chords. Paste is document `paste` only (see richTextKeymap).
			// Mark chord here so the matching document copy/cut event is not double-applied.
			copy: () => {
				this._markClipboardChord();
				return this.copySelection();
			},
			cut: () => {
				this._markClipboardChord();
				return this.cutSelection();
			},
		});
		return this;
	}

	detach() {
		if (!this.editor) return this;
		document.removeEventListener("copy", this._onCopy);
		document.removeEventListener("cut", this._onCut);
		document.removeEventListener("paste", this._onPaste);
		for (const [name, method] of this.boundMethods) {
			if (this.editor[name] === method) delete this.editor[name];
		}
		if (this.editor.richText === this) delete this.editor.richText;
		this.boundMethods.clear();
		this.editor = null;
		return this;
	}

	attachEditorMethods(names) {
		for (const name of names) {
			const method = this[name].bind(this);
			this.boundMethods.set(name, method);
			this.editor[name] = method;
		}
	}

	blockSelector() {
		const blocks = this.editor.schema.tagsOfType("block")
			.filter(tag => this.editor.schema.contains(tag, "#text") || tag === "blockquote");
		return blocks.join(", ") || "p, h1, h2, h3, h4, h5, h6, li, blockquote, div";
	}

	blockFor(node) {
		const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const block = el?.closest(this.blockSelector());
		return block && this.editor.root.contains(block) ? block : null;
	}

	createBlock(tag = "p") {
		const block = document.createElement(tag);
		this.ensureEditableContent(block, true);
		return block;
	}

	replaceBlock(block, tag) {
		const next = this.createBlock(tag);
		block.replaceWith(next);
		return next;
	}

	firstTextNode(node) {
		if (!node) return null;
		if (node.nodeType === Node.TEXT_NODE) return node;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		return walker.nextNode();
	}

	lastTextNode(node) {
		if (!node) return null;
		if (node.nodeType === Node.TEXT_NODE) return node;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		let text = null;
		while (walker.nextNode()) text = walker.currentNode;
		return text;
	}

	pruneEmptyTextChildren(block) {
		if (!block || block.nodeType !== Node.ELEMENT_NODE) return;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) child.remove();
		}
	}

	ensureEditableContent(block, preferBr = false) {
		this.pruneEmptyTextChildren(block);
		if (block.childNodes.length > 0) return;
		const ph = preferBr ? document.createElement("br") : document.createTextNode("");
		block.appendChild(ph);
	}

	moveCursorToBlockStart(block, session = null) {
		this.ensureEditableContent(block, true);
		const tn = this.firstTextNode(block) || (block.firstChild && block.firstChild.nodeType === Node.TEXT_NODE ? block.firstChild : null);
		if (!tn && block.childNodes.length === 0) {
			const t = document.createTextNode("");
			block.appendChild(t);
			return this.editor.selection.setCaret(t, 0, session);
		}
		return tn
			? this.editor.selection.setCaret(tn, 0, session)
			: this.editor.selection.setCaret(block, 0, session);
	}

	moveCursorToBlockEnd(block, session = null) {
		this.ensureEditableContent(block, true);
		let tn = this.lastTextNode(block);
		if (!tn) {
			const last = block.lastChild;
			if (last && last.nodeType === Node.TEXT_NODE) tn = last;
		}
		if (!tn && block.childNodes.length === 0) {
			const t = document.createTextNode("");
			block.appendChild(t);
			return this.editor.selection.setCaret(t, 0, session);
		}
		return tn
			? this.editor.selection.setCaret(tn, tn.data.length, session)
			: this.editor.selection.setCaret(block, block.childNodes.length, session);
	}

	firstBlockIn(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		if (node.matches(this.blockSelector())) return node;
		return node.querySelector(this.blockSelector());
	}

	lastBlockIn(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		const blocks = node.matches(this.blockSelector())
			? [node, ...node.querySelectorAll(this.blockSelector())]
			: [...node.querySelectorAll(this.blockSelector())];
		return blocks.at(-1) ?? null;
	}

	blockText(block) {
		return (block?.textContent ?? "").replace(/\u200b/g, "").trim();
	}

	isEmptyBlock(block) {
		return !!block && this.blockText(block) === "";
	}

	removePlaceholderInCurrentBlock(session = null) {
		const block = this.currentEditableBlock(session);
		if (!block || !this.isEmptyBlock(block)) return false;
		let removed = false;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
				child.remove();
				removed = true;
			}
		}
		if (removed) this.editor.text.refresh();
		return removed;
	}

	currentEditableBlock(session = null) {
		const active = this.editor.activeSession(session);
		const range = this.editor.range.current(this.editor.root, active);
		const selectedBlock = range ? this.blockFor(range.startContainer) : null;
		if (selectedBlock) {
			active.currentBlock = selectedBlock;
			if (active === this.editor.localSession) this.editor._currentBlock = selectedBlock;
			return selectedBlock;
		}
		const anchorBlock = this.blockFor(active.cursor.anchor);
		if (anchorBlock) {
			active.currentBlock = anchorBlock;
			if (active === this.editor.localSession) this.editor._currentBlock = anchorBlock;
			return anchorBlock;
		}
		return active.currentBlock?.isConnected ? active.currentBlock : null;
	}

	selectionRangeFor(node) {
		if (!node?.isConnected) {
			return null;
		}
		this.editor.text.refresh();
		const endOffset = Math.max(0, this.editor.text.offsetWithin(node, {
			node,
			offset: node.childNodes.length,
		}));
		const startPoint = this.editor.text.pointAtOffsetWithin(node, 0, "forward");
		const endPoint = this.editor.text.pointAtOffsetWithin(node, endOffset, "backward");
		// indexOfPoint expands window as needed
		const start = startPoint ? this.editor.text.indexOfPoint(startPoint) : -1;
		const end = endPoint ? this.editor.text.indexOfPoint(endPoint) : -1;
		if (start < 0 || end < 0 || start === end) {
			return null;
		}
		return { start, end };
	}

	selectionScopes(session = null) {
		const block = this.currentEditableBlock(session);
		if (!block) {
			return [];
		}
		const scopes = [];
		let current = block;
		while (current?.isConnected) {
			const range = this.selectionRangeFor(current);
			if (range && !scopes.some(scope => scope.start === range.start && scope.end === range.end)) {
				scopes.push(range);
			}
			if (current === this.editor.root) {
				break;
			}
			current = current.parentElement;
		}
		return scopes;
	}

	selectCurrentBlock(session = null, mode = "expand") {
		const scopes = this.selectionScopes(session);
		if (scopes.length === 0) {
			return false;
		}
		const active = this.editor.activeSession(session);
		const normalized = active.cursor.selection.normalizedRange();
		const currentIndex = scopes.findIndex(scope =>
			normalized.start === scope.start && normalized.end === scope.end,
		);
		const targetIndex =
			mode === "contract"
				? currentIndex > 0
					? currentIndex - 1
					: 0
				: currentIndex >= 0
					? Math.min(scopes.length - 1, currentIndex + 1)
					: 0;
		const target = scopes[targetIndex];
		const selected = target
			? this.editor.selection.select(target.start, target.end, session)
			: false;
		if (selected) {
			this.editor.selection.syncToNative(session);
		}
		return selected;
	}

	shouldInsertText(text, session = null) {
		if (text !== " ") {
			return true;
		}
		const cursor = this.editor.activeSession(session).cursor;
		const context = cursor?.getContext();
		const pointNode = context?.point?.node;
		if (this.editor.text.isWhitespacePreserved(pointNode)) {
			return true;
		}
		// char.before/after on the current slot miss spaces across inline boundaries
		// (e.g. caret at start of <em> after "with "). Walk adjacent position slots.
		const offset = cursor?.offset;
		if (Number.isInteger(offset)) {
			this.editor.text.ensureIndex(offset);
			const positions = this.editor.text.positions();
			const prev = positions[offset - 1]?.char;
			const cur = positions[offset]?.char;
			const next = positions[offset + 1]?.char;
			const before = cur?.before ?? prev?.after ?? prev?.before ?? "";
			const after = cur?.after ?? next?.before ?? next?.after ?? "";
			return !/\s/.test(before) && !/\s/.test(after);
		}
		return !/\s/.test(context?.char?.before ?? "") && !/\s/.test(context?.char?.after ?? "");
	}

	expandSelection(direction, session = null) {
		const cursor = this.editor.activeSession(session).cursor;
		if (!cursor) return false;
		if (direction === "left") cursor.left(true);
		else if (direction === "right") cursor.right(true);
		else if (direction === "up") cursor.up(true);
		else if (direction === "down") cursor.down(true);
		else return false;
		this.editor.selection.syncToNative(session);
		return true;
	}

	isFullySelectedBlock(range, block) {
		if (!range || !block) return false;
		const covers = (blockRange) => {
			try {
				return (
					range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
					range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0
				);
			} catch (_) {
				return false;
			}
		};
		const around = document.createRange();
		around.selectNode(block);
		if (covers(around)) return true;
		// Structural selections usually cover node contents, not the element chrome
		// that Range.selectNode() includes — accept full content coverage too.
		const contents = document.createRange();
		contents.selectNodeContents(block);
		if (covers(contents)) return true;
		// Fallback: structural indices for the block lie inside the selection.
		const structural = this.editor.structuralRangeFor?.(block);
		if (!structural) return false;
		const start = this.editor.text.indexOfPoint({
			node: range.startContainer,
			offset: range.startOffset,
		});
		const end = this.editor.text.indexOfPoint({
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0 || end < 0) return false;
		const a = Math.min(start, end);
		const b = Math.max(start, end);
		return a <= structural.start && b >= structural.end;
	}

	fullySelectedBlocks(session = null) {
		const cursor = this.editor.activeSession(session).cursor;
		if (cursor.selectionKind === "node" && cursor.selectedNode) {
			const block = this.blockFor(cursor.selectedNode);
			return block ? [block] : [];
		}
		const range = this.editor.range.selected(this.editor.root, session);
		if (!range) return [];
		const blocks = [];
		for (const block of this.editor.root.querySelectorAll(this.blockSelector())) {
			if (range.intersectsNode(block) && this.isFullySelectedBlock(range, block)) blocks.push(block);
		}
		return blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
	}

	removeBlock(block) {
		if (!block?.isConnected) return;
		const tag = block.tagName.toLowerCase();
		if (tag === "li") {
			const list = block.parentElement;
			block.remove();
			if (list && !list.querySelector(":scope > li")) list.remove();
			return;
		}
		if (tag === "p" && block.parentElement?.tagName?.toLowerCase() === "blockquote") {
			const quote = block.parentElement;
			block.remove();
			if (!quote.querySelector(this.blockSelector())) quote.remove();
			return;
		}
		block.remove();
	}

	deleteSelectedBlocks(session = null) {
		const blocks = this.fullySelectedBlocks(session);
		if (blocks.length === 0) return false;
		const afterBlock = blocks.map(block => this.firstBlockIn(block.nextElementSibling)).find(Boolean);
		const beforeBlock = [...blocks].reverse().map(block => this.lastBlockIn(block.previousElementSibling)).find(Boolean);
		for (const block of blocks) this.removeBlock(block);
		this.editor.setContent(undefined, { session, selection: afterBlock ? { node: afterBlock, position: "start" } : beforeBlock ? { node: beforeBlock, position: "end" } : undefined });
		return true;
	}

	deleteEmptyBlock(session = null) {
		const range = this.editor.range.current(this.editor.root, session);
		if (!range?.collapsed) return false;
		const block = this.blockFor(range.startContainer);
		if (!block) return false;
		// Treat a caret in a block with no meaningful text as empty so Delete
		// after splitting at a block end removes the new empty list item / block.
		const empty = this.isEmptyBlock(block) || !(this.blockText(block) ?? "").replace(/\u200b/g, "").trim();
		if (!empty) return false;
		const afterBlock = this.firstBlockIn(block.nextElementSibling);
		const beforeBlock = this.lastBlockIn(block.previousElementSibling);
		this.removeBlock(block);
		this.editor.setContent(undefined, { session, selection: afterBlock ? { node: afterBlock, position: "start" } : beforeBlock ? { node: beforeBlock, position: "end" } : undefined });
		return true;
	}

	previousEditableBlock(block) {
		let sibling = block?.previousElementSibling ?? null;
		while (sibling) {
			const previous = this.lastBlockIn(sibling);
			if (previous) return previous;
			sibling = sibling.previousElementSibling;
		}
		return null;
	}

	mergeBlockBackward(session = null, event = null) {
		if (event && event.key !== "Backspace") return false;
		const range = this.editor.range.current(this.editor.root, session);
		if (!range?.collapsed) return false;
		const block = this.blockFor(range.startContainer);
		if (!block || !this.editor.range.atBlockStart(range, block)) return false;
		const previous = this.previousEditableBlock(block);
		if (!previous) return false;

		for (const child of [...previous.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") child.remove();
		}
		const markerText = this.lastTextNode(previous);
		const markerNode = markerText ?? previous;
		const markerOffset = markerText ? markerText.data.length : previous.childNodes.length;
		for (const child of [...block.childNodes]) {
			if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
				child.remove();
			} else {
				previous.appendChild(child);
			}
		}
		block.remove();
		this.editor.setContent(undefined, { session, selection: { node: markerNode, offset: markerOffset } });
		return true;
	}

	exitEmptyBlock(block, session = null) {
		if (!this.isEmptyBlock(block)) return false;
		const container = block.parentElement ?? this.editor.root;
		if (container === this.editor.root) {
			const defaultTag = this.editor.schema.defaultChild(":root");
			const next = this.editor.schema.tag(block) === defaultTag ? block : this.replaceBlock(block, defaultTag);
			next.replaceChildren();
			this.ensureEditableContent(next, true);
			this.editor.setContent(undefined, { session, selection: { node: next, position: "start" } });
			return true;
		}
		const outerParent = container.parentElement ?? this.editor.root;
		const nextBlock = this.createBlock(this.editor.schema.defaultChild(outerParent === this.editor.root ? ":root" : outerParent));
		container.parentNode.insertBefore(nextBlock, container.nextSibling);
		block.remove();
		this.editor.setContent(undefined, { session, selection: { node: nextBlock, position: "start" } });
		return true;
	}

	splitBlockElement(block, range, session = null) {
		if (this.isEmptyBlock(block)) return this.exitEmptyBlock(block, session);
		const parent = block.parentElement === this.editor.root ? null : block.parentElement;
		const nextTag = this.editor.schema.enterNext(block, parent, this.editor.schema.defaultChild(":root"));
		const nextBlock = document.createElement(nextTag);
		const trailing = document.createRange();
		trailing.selectNodeContents(block);
		trailing.setStart(range.startContainer, range.startOffset);
		nextBlock.appendChild(trailing.extractContents());
		this.ensureEditableContent(block, true);
		this.ensureEditableContent(nextBlock, true);
		block.parentNode.insertBefore(nextBlock, block.nextSibling);
		this.editor.setContent(undefined, { session, selection: { node: nextBlock, position: "start" } });
		return true;
	}

	ensureTextTarget(block) {
		if (!block) return null;
		const tn = this.firstTextNode(block);
		if (tn) return tn;
		for (const ch of block.childNodes) {
			if (ch.nodeType === Node.TEXT_NODE) return ch;
		}
		const t = document.createTextNode("");
		block.appendChild(t);
		return t;
	}

	splitListItem(item, range, session = null) {
		if (this.isEmptyBlock(item)) return this.exitEmptyBlock(item, session);
		const nextItem = document.createElement("li");
		const trailing = document.createRange();
		trailing.selectNodeContents(item);
		trailing.setStart(range.startContainer, range.startOffset);
		nextItem.appendChild(trailing.extractContents());
		this.ensureEditableContent(item, true);
		this.ensureEditableContent(nextItem, true);
		item.parentNode.insertBefore(nextItem, item.nextSibling);
		this.editor.setContent(undefined, { session, selection: { node: nextItem, position: "start" } });
		return true;
	}

	insertLineBreak(session = null) {
		const range = this.editor.range.current(this.editor.root, session);
		if (!range) return false;
		const block = this.blockFor(range.startContainer);
		if (!block) return false;
		this.editor.range.split(range);
		const br = document.createElement("br");
		const tail = document.createTextNode("");
		range.insertNode(tail);
		range.insertNode(br);
		this.editor.setContent(undefined, { session, selection: { node: tail, offset: 0 } });
		return true;
	}

	splitCurrentBlock(session = null) {
		const range = this.editor.range.current(this.editor.root, session);
		if (!range) return false;
		const block = this.blockFor(range.startContainer);
		if (!block?.contains(range.startContainer)) return false;
		this.editor.range.split(range);
		return block.tagName.toLowerCase() === "li"
			? this.splitListItem(block, range, session)
			: this.splitBlockElement(block, range, session);
	}

	indentListItem(item, session = null) {
		const previous = item.previousElementSibling;
		const list = item.parentElement;
		if (previous?.tagName?.toLowerCase() !== "li" || !list) return false;
		let nested = previous.lastElementChild;
		const tag = list.tagName.toLowerCase();
		if (!nested || nested.tagName.toLowerCase() !== tag) {
			nested = document.createElement(tag);
			previous.appendChild(nested);
		}
		nested.appendChild(item);
		this.editor.setContent(undefined, { session, selection: { node: item, position: "start" } });
		return true;
	}

	dedentListItem(item, session = null) {
		const list = item.parentElement;
		const parentItem = list?.parentElement?.closest("li");
		if (parentItem) {
			parentItem.parentElement.insertBefore(item, parentItem.nextSibling);
			if (!list.querySelector(":scope > li")) list.remove();
			this.editor.setContent(undefined, { session, selection: { node: item, position: "start" } });
			return true;
		}
		if (!list) return false;
		const paragraph = document.createElement(this.editor.schema.defaultChild(":root"));
		while (item.firstChild) paragraph.appendChild(item.firstChild);
		this.ensureEditableContent(paragraph, true);
		list.parentNode.insertBefore(paragraph, list.nextSibling);
		item.remove();
		if (!list.querySelector(":scope > li")) list.remove();
		this.editor.setContent(undefined, { session, selection: { node: paragraph, position: "start" } });
		return true;
	}

	currentListItem(session = null) {
		const active = this.editor.activeSession(session);
		const block = active.currentBlock?.isConnected && active.currentBlock.tagName?.toLowerCase() === "li"
			? active.currentBlock
			: this.currentEditableBlock(active);
		return block?.tagName?.toLowerCase() === "li" ? block : null;
	}

	indentCurrentListItem(session = null) {
		const item = this.currentListItem(session);
		return item ? this.indentListItem(item, session) : false;
	}

	dedentCurrentListItem(session = null) {
		const item = this.currentListItem(session);
		return item ? this.dedentListItem(item, session) : false;
	}

	// Method: ownsClipboard
	// True when clipboard events should target this editor (not a foreign input).
	ownsClipboard(event = null) {
		if (!this.editor?.root?.isConnected) return false;
		const input = this.editor.input;
		const target = event?.target;
		const active = document.activeElement;
		// Never steal from a foreign control the user is in / targeting.
		if (input?._isForeignEditable?.(target)) return false;
		if (input?._isForeignEditable?.(active)) return false;
		const root = this.editor.root;
		const inRoot = (el) => !!el && (el === root || root.contains(el));
		if (inRoot(target) || inRoot(active)) return true;
		const session = this.editor.activeSession();
		if (session?.cursor?.selectionKind === "range") return true;
		// Virtual caret: click places the caret without always keeping focus on root.
		// `_editorActive` stays true after mouseup until the user clicks elsewhere.
		if (input?._editorActive || input?._mouseOwned) return true;
		const focusLoose =
			!active ||
			active === document.body ||
			active === document.documentElement ||
			active === document;
		if (focusLoose && session?.cursor && typeof session.cursor.offset === "number") {
			return true;
		}
		return false;
	}

	// Method: selectedPlainText
	// Plain text for the current structural (or native) selection.
	selectedPlainText(session = null) {
		const range = this.editor.range.selected(this.editor.root, session);
		return range ? range.toString() : "";
	}

	// Method: writeClipboard
	// Writes plain text to the system clipboard (event payload or Clipboard API).
	writeClipboard(text, event = null) {
		if (text == null) return false;
		if (event?.clipboardData) {
			event.clipboardData.setData("text/plain", text);
			return true;
		}
		if (globalThis.navigator?.clipboard?.writeText) {
			globalThis.navigator.clipboard.writeText(text).catch(() => {});
			return true;
		}
		// Legacy fallback for non-secure contexts.
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "");
			ta.style.cssText = "position:fixed;left:-9999px;top:0";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			return ok;
		} catch (_) {
			return false;
		}
	}

	// Method: readClipboard
	// Reads plain text from a paste event or the Clipboard API (async → Promise).
	readClipboard(event = null) {
		const fromEvent = event?.clipboardData?.getData?.("text/plain");
		if (fromEvent != null && fromEvent !== "") return Promise.resolve(fromEvent);
		if (globalThis.navigator?.clipboard?.readText) {
			return globalThis.navigator.clipboard.readText().catch(() => "");
		}
		return Promise.resolve("");
	}

	// Method: _markClipboardChord
	// Notes a keymap-driven clipboard op so the matching document event is ignored.
	_markClipboardChord() {
		this._clipboardChordAt = performance.now();
	}

	// Method: _fromClipboardChord
	// True when a document cut/copy/paste event is the echo of a just-handled keymap chord.
	_fromClipboardChord() {
		return performance.now() - this._clipboardChordAt < 100;
	}

	// Method: copySelection
	// Copies the current selection to the clipboard.
	copySelection(event = null) {
		if (event && this._fromClipboardChord()) {
			event.preventDefault();
			return true;
		}
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const text = this.selectedPlainText();
		if (!text) return false;
		const ok = this.writeClipboard(text, event);
		if (ok && event) {
			event.preventDefault();
			event.stopPropagation();
		}
		return ok;
	}

	// Method: cutSelection
	// Copies the selection then deletes it (one history unit).
	cutSelection(event = null) {
		if (event && this._fromClipboardChord()) {
			event.preventDefault();
			return true;
		}
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const session = this.editor.activeSession();
		const text = this.selectedPlainText(session);
		if (!text) return false;
		const ok = this.writeClipboard(text, event);
		if (!ok) return false;
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		this.editor.history.run("cut", () => {
			// Range delete via backspace/replace; no-op if selection already collapsed.
			if (session.cursor.selectionKind === "range" || session.cursor.selectionKind === "node") {
				session.cursor.backspace();
			}
			session.classes?.update();
		});
		return true;
	}

	// Method: pasteText
	// Inserts clipboard plain text at the caret/selection.
	// Prefer the `paste` event's clipboardData — do not rely on async clipboard.readText.
	pasteText(text = null, session = null, event = null) {
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const active = this.editor.activeSession(session);
		const apply = (raw) => {
			const value = String(raw ?? "").replace(/\r\n?/g, "\n");
			if (!value) return false;
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}
			this.removePlaceholderInCurrentBlock(active);
			active.cursor.insertText(value);
			active.classes?.update();
			return true;
		};
		if (text != null) return apply(text);
		if (event?.clipboardData) {
			// text/plain first; fall back to text if browsers only expose that.
			const plain =
				event.clipboardData.getData("text/plain") ||
				event.clipboardData.getData("text") ||
				"";
			return apply(plain);
		}
		return false;
	}

	onCopy(event) {
		this.copySelection(event);
	}

	onCut(event) {
		this.cutSelection(event);
	}

	onPaste(event) {
		this.pasteText(null, null, event);
	}
}

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
