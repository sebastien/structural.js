// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-26

// Module: richtext plugin
// Installs rich-text block editing behavior.

import { Modification } from "../../modification.js";
import { RichTextClipboard } from "./clipboard.js";

// Class: RichText
// Installs rich-text editing helpers and default block-level commands into an Editor.
class RichText {
	static pluginName = "richtext";

	constructor(options = {}) {
		this.options = options;
		this.editor = null;
		this.clipboard = new RichTextClipboard(this);
		this._onCopy = this.onCopy.bind(this);
		this._onCut = this.onCut.bind(this);
		this._onPaste = this.onPaste.bind(this);
	}

	attach(editor) {
		this.editor = editor;
		editor.richText = this;
		document.addEventListener("copy", this._onCopy);
		document.addEventListener("cut", this._onCut);
		document.addEventListener("paste", this._onPaste);
		// Editing helpers live on the plugin (editor.richText). Keymap actions call them
		// directly; apps should use editor.richText.* rather than methods on Editor.
		editor.configureActions({
			toggleInline: (command, context) =>
				new Modification(context.session, { schema: editor.schema }).toggleInline(command.args.tag),
			toggleBlock: (command, context) =>
				new Modification(context.session, { schema: editor.schema }).toggleBlock(command.args.tag),
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
				}, context.session),
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
		if (this.editor.richText === this) delete this.editor.richText;
		this.editor = null;
		return this;
	}

	// blockSelector / blockFor / firstTextNode / lastTextNode: Editor core defaults.
	blockSelector() {
		return this.editor.blockSelector();
	}

	blockFor(node) {
		return this.editor.blockFor(node);
	}

	firstTextNode(node) {
		return this.editor.firstTextNode(node);
	}

	lastTextNode(node) {
		return this.editor.lastTextNode(node);
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

	ownsClipboard(event = null) { return this.clipboard.ownsClipboard(event); }

	selectedPlainText(session = null) { return this.clipboard.selectedPlainText(session); }

	selectedHTML(session = null) { return this.clipboard.selectedHTML(session); }

	writeClipboard(text, event = null, html = "") { return this.clipboard.writeClipboard(text, event, html); }

	readClipboard(event = null) { return this.clipboard.readClipboard(event); }

	sanitizeClipboardHTML(html) { return this.clipboard.sanitizeClipboardHTML(html); }

	pasteHTML(html, session = null, event = null) { return this.clipboard.pasteHTML(html, session, event); }

	_markClipboardChord() { return this.clipboard._markClipboardChord(); }

	_fromClipboardChord() { return this.clipboard._fromClipboardChord(); }

	copySelection(event = null) { return this.clipboard.copySelection(event); }

	cutSelection(event = null) { return this.clipboard.cutSelection(event); }

	pasteText(text = null, session = null, event = null) { return this.clipboard.pasteText(text, session, event); }

	onCopy(event) { return this.clipboard.onCopy(event); }

	onCut(event) { return this.clipboard.onCut(event); }

	onPaste(event) { return this.clipboard.onPaste(event); }
}

export { RichText };

// EOF
