import { DEFAULT_BLOCK_SELECTOR, asElement, wordRangeAtIndex } from "../foundation/document.js";
import { EditorNormalizer, EditorSchema } from "../foundation/schema.js";
import { editorKeymap } from "../runtime/editor.js";
// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: modification
// Provides rich-text formatting operations that mutate the DOM tree managed by an Editor.


// ----------------------------------------------------------------------------
//
// CLASSES
//
// ----------------------------------------------------------------------------

// Class: Modification
// Rich-text formatting operations and DOM mutations.
// - session: EditorSession - the associated editor session
// - editor: Editor - the parent editor
// - schema: Schema - schema definitions for the editor
class Modification {
	// ----------------------------------------------------------------------------
	//
	// LIFECYCLE
	//
	// ----------------------------------------------------------------------------

	// Method: constructor
	// Initializes the `Modification` instance with an `editorOrSession` and `options`.
	constructor(editorOrSession, options = {}) {
		this.session = options.session ?? (editorOrSession?.cursor && editorOrSession?.editor ? editorOrSession : null);
		this.editor = this.session?.editor ?? editorOrSession;
		this.schema = options.schema ?? this.editor.schema ?? null;
		this._savedPoint = null;
		this._savedOffset = null;
		this._savedWrapper = null;
		this._savedRangeStart = null;
		this._savedRangeEnd = null;
	}

	// Property: cursor
	// Retrieves the active cursor.
	get cursor() {
		return this.session?.cursor ?? this.editor.input.cursor;
	}

	// Property: text
	// Retrieves the editor text adapter.
	get text() {
		return this.editor.text;
	}

	// ----------------------------------------------------------------------------
	//
	// FORMAT DETECTION
	//
	// ----------------------------------------------------------------------------

	// Method: formats
	// Detects active rich-text formats around the current cursor anchor.
	formats() {
		const anchor = this.cursor.anchor;
		const el = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
		if (!el || !this.editor.root.contains(el)) {
			return {
				strong: false, em: false, u: false, code: false, link: false,
				h1: false, h2: false, h3: false,
				ul: false, ol: false, blockquote: false,
			};
		}
		return {
			strong:     !!el.closest('strong, b'),
			em:         !!el.closest('em, i'),
			u:          !!el.closest('u'),
			code:       !!el.closest('code'),
			link:       !!el.closest('a'),
			h1:         !!el.closest('h1'),
			h2:         !!el.closest('h2'),
			h3:         !!el.closest('h3'),
			ul:         !!el.closest('ul'),
			ol:         !!el.closest('ol'),
			blockquote: !!el.closest('blockquote'),
		};
	}

	// ----------------------------------------------------------------------------
	//
	// SCHEMA GUARDS
	//
	// ----------------------------------------------------------------------------

	// Method: allowsInline
	// Checks if the specified inline `tag` is allowed by the schema in the current context.
	allowsInline(tag) {
		if (!this.schema?.allowsInline) return true;
		return this.schema.allowsInline(tag, {
			formats: this.formats(),
			block: this.findBlock(this.cursor.anchor),
			cursor: { offset: this.cursor.offset, selectionKind: this.cursor.selectionKind },
		});
	}

	// Method: allowsBlock
	// Checks if the specified block `tag` is allowed by the schema in the current context.
	allowsBlock(tag) {
		if (!this.schema?.allowsBlock) return true;
		const block = this.findBlock(this.cursor.anchor);
		return this.schema.allowsBlock(tag, {
			block,
			parent: block?.parentElement ?? this.editor.root,
			root: this.editor.root,
			formats: this.formats(),
		});
	}

	// ----------------------------------------------------------------------------
	//
	// INLINE FORMATTING
	//
	// ----------------------------------------------------------------------------

	// Method: toggleInline
	// Toggles the inline style `tag` on the selected text or current word.
	toggleInline(tag) {
		if (!this.allowsInline(tag)) return false;
		let range = this.rangeFromCursor();
		if (!range || range.collapsed) return false;

		this._savePoint();

		const container = range.commonAncestorContainer;
		const el = container.nodeType === Node.ELEMENT_NODE
			? container
			: container.parentElement;
		const wrapper = el?.closest(tag);
		if (wrapper?.contains(range.startContainer) && wrapper.contains(range.endContainer)) {
			this.coalesceText(this.unwrapElement(wrapper));
		} else {
			const overlapping = this._overlappingTags(range, tag);
			if (overlapping.length > 0) {
				const parents = new Set();
				for (const el of overlapping) parents.add(this.unwrapElement(el));
				for (const parent of parents) this.coalesceText(parent);
				this.text.refresh();
				range = this._rangeFromSave();
				if (!range || range.collapsed) return true;
			}
			const created = this.wrapRange(range, tag);
			this._savedPoint = this._endPoint(created);
			this._savedWrapper = created;
		}

		this._restoreCursor();
		// Keep native selection aligned with the remapped structural range so a later
		// keydown does not re-import a stale pre-wrap browser range.
		try {
			this.editor.selection?.syncToNative(this.session ?? this.editor.localSession);
		} catch (_) {}
		return true;
	}

	// Method: toggleLink
	// Applies a URL to the selected text, or removes the current link.
	toggleLink(target) {
		if (!this.allowsInline("a")) return false;
		const range = this.rangeFromCursor();
		if (!range || range.collapsed) return false;
		this._savePoint();
		const container = range.commonAncestorContainer;
		const el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
		const wrapper = el?.closest("a");
		if (wrapper?.contains(range.startContainer) && wrapper.contains(range.endContainer)) {
			this.coalesceText(this.unwrapElement(wrapper));
		} else {
			const created = this.wrapRange(range, "a");
			created.href = target;
			this._savedPoint = this._endPoint(created);
			this._savedWrapper = created;
		}
		this._restoreCursor();
		try {
			this.editor.selection?.syncToNative(this.session ?? this.editor.localSession);
		} catch (_) {}
		return true;
	}

	// Method: _overlappingTags
	// Internal helper to find tags of type `tag` overlapping with the given `range`.
	_overlappingTags(range, tag) {
		const ancestor = range.commonAncestorContainer;
		const root = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
		if (!root) return [];

		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode: (node) =>
					node.tagName.toLowerCase() === tag && range.intersectsNode(node)
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_SKIP,
			},
		);

		const tags = [];
		let node;
		while (true) {
			node = walker.nextNode();
			if (!node) break;
			tags.push(node);
		}
		return tags.reverse();
	}

	// Method: _rangeFromSave
	// Internal helper to reconstruct the native DOM Range from saved start and end points.
	_rangeFromSave() {
		const startIdx = this.text.indexOfPoint(this._savedRangeStart);
		const endIdx = this.text.indexOfPoint(this._savedRangeEnd);
		if (startIdx < 0 || endIdx < 0) return null;
		const startPt = this.text.pointAt(startIdx);
		const endPt = this.text.pointAt(endIdx);
		if (!startPt || !endPt) return null;
		const r = document.createRange();
		r.setStart(startPt.node, startPt.offset);
		r.setEnd(endPt.node, endPt.offset);
		return r;
	}

	// Method: _endPoint
	// Internal helper to find the last valid text point inside element `el`.
	_endPoint(el) {
		let node = el;
		while (node.lastChild) node = node.lastChild;
		return node.nodeType === Node.TEXT_NODE && node.data.length > 0
			? { node, offset: node.data.length }
			: null;
	}

	// ----------------------------------------------------------------------------
	//
	// BLOCK FORMATTING
	//
	// ----------------------------------------------------------------------------

	// Method: toggleBlock
	// Toggles block tag style (e.g. `ul`, `ol`, `blockquote`, headings) on the current block.
	toggleBlock(tag) {
		this.editor.selection.syncFromNative(this.editor.root, this.session);
		const selected = this.editor.range.selected(this.editor.root, this.session);
		const selectedBlocks = tag === "ul" || tag === "ol" ? this._blocksInRange(selected) : [];
		if (selectedBlocks.length > 0) {
			this._savePoint();
			const allInList = selectedBlocks.every((block) =>
				block.tagName.toLowerCase() === "li" && block.closest(tag),
			);
			if (allInList) this._unwrapListItems(selectedBlocks);
			else this._toggleListBlocks(tag, selectedBlocks);
			this._restoreCursor();
			this.editor.selection.syncToNative(this.session);
			return true;
		}
		const richText = this.editor.capability?.("richtext") ?? this.editor.richText;
		const remembered = richText?.currentEditableBlock?.(
			this.session ?? this.editor.localSession,
		) ?? null;
		const block = this.findBlock(this.cursor.anchor);
		const target = block === this.editor.root && remembered ? remembered : block;
		if (target === this.editor.root) return false;
		const currentTag = target.tagName.toLowerCase();
		const isActive = tag === 'blockquote'
			? !!target.closest('blockquote')
			: tag === 'ul' || tag === 'ol'
				? !!target.closest(tag)
				: currentTag === tag;
		if (!isActive && !this.allowsBlock(tag)) return false;
		this._savePoint();

		if (tag === 'ul' || tag === 'ol') {
			this._toggleList(tag, target);
		} else if (tag === 'blockquote') {
			this._toggleBbq(target);
		} else {
			this._heading(tag, target);
		}

		this._restoreCursor();
		return true;
	}

	// ----------------------------------------------------------------------------
	//
	// RANGE & WORD UTILITIES
	//
	// ----------------------------------------------------------------------------

	// Method: rangeFromCursor
	// Returns a valid native DOM Range from the cursor position or active selection.
	rangeFromCursor() {
		this.editor.selection.syncFromNative(this.editor.root, this.session);
		const selected = this.editor.range.selected(this.editor.root, this.session);
		if (selected) return selected;
		const word = this.expandToWord();
		if (word) {
			const startPt = this.text.pointAt(word.start);
			const endPt = this.text.pointAt(word.end);
			if (startPt && endPt) {
				const r = document.createRange();
				r.setStart(startPt.node, startPt.offset);
				r.setEnd(endPt.node, endPt.offset);
				return r;
			}
		}
		return null;
	}

	// Method: expandToWord
	// Expands the current cursor offset to the boundaries of the surrounding word.
	expandToWord() {
		return wordRangeAtIndex(this.text, this.cursor.offset);
	}

	// ----------------------------------------------------------------------------
	//
	// DOM UTILITIES
	//
	// ----------------------------------------------------------------------------

	// Method: wrapRange
	// Wraps the specified DOM `range` in a new element of type `tag`.
	wrapRange(range, tag) {
		const wrapper = document.createElement(tag);
		wrapper.appendChild(range.extractContents());
		range.insertNode(wrapper);
		return wrapper;
	}

	// Method: unwrapElement
	// Unwraps the element `el`, moving all of its children to its parent.
	unwrapElement(el) {
		const parent = el.parentNode;
		while (el.firstChild) {
			parent.insertBefore(el.firstChild, el);
		}
		parent.removeChild(el);
		return parent;
	}

	// Method: coalesceText
	// Coalesces consecutive text nodes within `parent` and updates saved points.
	coalesceText(parent) {
		if (!parent) return null;
		let previous = null;
		for (const child of [...parent.childNodes]) {
			if (child.nodeType !== Node.TEXT_NODE) {
				previous = null;
				continue;
			}
			if (child.data.length === 0) {
				this._remapSavedTextPoint(child, previous ?? parent, previous ? previous.data.length : [...parent.childNodes].indexOf(child));
				child.remove();
				continue;
			}
			if (previous) {
				const offset = previous.data.length;
				this._remapSavedTextPoint(child, previous, offset);
				previous.data += child.data;
				child.remove();
				continue;
			}
			previous = child;
		}
		return parent;
	}

	// Method: _remapSavedTextPoint
	// Internal helper to remap a saved text point when nodes are coalesced.
	_remapSavedTextPoint(fromNode, toNode, offset) {
		for (const key of ["_savedPoint", "_savedRangeStart", "_savedRangeEnd"]) {
			const point = this[key];
			if (point?.node === fromNode) {
				point.node = toNode;
				point.offset += offset;
			}
		}
	}

	// Method: changeTagName
	// Replaces element `el` with a new element having the specified `tag`.
	changeTagName(el, tag) {
		const replacement = document.createElement(tag);
		while (el.firstChild) replacement.appendChild(el.firstChild);
		for (const attr of el.attributes) {
			replacement.setAttribute(attr.name, attr.value);
		}
		el.replaceWith(replacement);
		return replacement;
	}

	// Method: findBlock
	// Finds the nearest ancestor block element for the given `node`.
	findBlock(node) {
		const el = asElement(node);
		if (!el) return this.editor.root;
		const selector =
			typeof this.editor.blockSelector === "function"
				? this.editor.blockSelector()
				: DEFAULT_BLOCK_SELECTOR;
		const block = el.closest(selector);
		return block && this.editor.root.contains(block) ? block : this.editor.root;
	}

	// Method: unwrapList
	// Unwraps the specified `list` elements, turning each list item into a paragraph.
	unwrapList(list) {
		const parent = list.parentNode;
		const items = [...list.querySelectorAll(':scope > li')];
		for (const li of items) {
			const p = document.createElement('p');
			while (li.firstChild) p.appendChild(li.firstChild);
			parent.insertBefore(p, list);
			li.remove();
		}
		parent.removeChild(list);
	}

	// ----------------------------------------------------------------------------
	//
	// INTERNALS
	//
	// ----------------------------------------------------------------------------

	// Method: _savePoint
	// Internal helper to save current cursor offset and selections before mutation.
	_savePoint() {
		this._savedOffset = this.cursor.offset;
		const point = this.text.pointAt(this._savedOffset);
		this._savedPoint = point ? { node: point.node, offset: point.offset } : null;

		if (this.cursor.selectionKind === 'range') {
			const range = this.cursor.selection.normalizedRange();
			const startPt = this.text.pointAt(range.start);
			const endPt = this.text.pointAt(range.end);
			this._savedRangeStart = startPt ? { node: startPt.node, offset: startPt.offset } : null;
			this._savedRangeEnd = endPt ? { node: endPt.node, offset: endPt.offset } : null;
		}
	}

	// Method: _restoreCursor
	// Internal helper to restore cursor and selections after DOM mutation.
	_restoreCursor() {
		this.text.refresh();

		this.text.ensurePositions();
		if (this._savedWrapper) {
			const bounds = this._wrapperBounds(this._savedWrapper);
			if (bounds) {
				this._setSelection(bounds.start, bounds.end);
			}
			this._savedWrapper = null;
		} else if (this._savedRangeStart && this._savedRangeEnd) {
			const startIdx = this.text.indexOfPoint(this._savedRangeStart);
			const endIdx = this.text.indexOfPoint(this._savedRangeEnd);
			if (startIdx >= 0 && endIdx >= 0) {
				this._setSelection(startIdx, endIdx);
			}
			this._savedRangeStart = null;
			this._savedRangeEnd = null;
		} else {
			let index = -1;
			if (this._savedPoint) {
				index = this.text.indexOfPoint(this._savedPoint);
			}
			if (index < 0) {
				index = this.text.clampIndex(this._savedOffset ?? this.cursor.offset ?? 0);
			}
			this.cursor.moveTo(index);
		}

		this._savedPoint = null;
		this._savedOffset = null;
	}

	// Method: _setSelection
	// Internal helper to set range selection from `start` to `end`.
	_setSelection(start, end) {
		this.cursor.select(start, end);
	}

	// Method: _wrapperBounds
	// Internal helper to compute start and end indices of text enclosed in wrapper element.
	_wrapperBounds(wrapper) {
		if (!wrapper?.isConnected) return null;
		this.text.ensurePositions();
		// Prefer DOM points inside the wrapper over boundary-slot heuristics. Boundary
		// adjacency on the previous sibling text node can look like "inside" the mark.
		const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
		let first = null;
		let last = null;
		while (walker.nextNode()) {
			if (!first) first = walker.currentNode;
			last = walker.currentNode;
		}
		if (!first || !last) return null;
		const start = this.text.indexOfPoint({ node: first, offset: 0 });
		const end = this.text.indexOfPoint({ node: last, offset: last.data.length });
		return start >= 0 && end >= start ? { start, end } : null;
	}

	// Method: _heading
	// Internal helper to apply heading element style `tag` on target `block`.
	_heading(tag, block) {
		const currentTag = block.tagName.toLowerCase();

		if (currentTag === tag) {
			this.changeTagName(block, 'p');
			return;
		}

		if (currentTag === 'li') {
			const heading = document.createElement(tag);
			while (block.firstChild) heading.appendChild(block.firstChild);
			const list = block.parentNode;
			list.parentNode.insertBefore(heading, list);
			block.remove();
			if (list.children.length === 0) list.remove();
			return;
		}

		this.changeTagName(block, tag);
	}

	// Method: _toggleList
	// Internal helper to toggle list tag `tag` on target `block`.
	_toggleList(tag, block) {
		const list = block.closest(tag);
		const other = block.closest(tag === 'ul' ? 'ol' : 'ul');

		if (list) {
			this.unwrapList(list);
		} else if (other) {
			this.changeTagName(other, tag);
		} else {
			const li = document.createElement('li');
			const wrapper = document.createElement(tag);
			while (block.firstChild) li.appendChild(block.firstChild);
			wrapper.appendChild(li);
			block.parentNode.replaceChild(wrapper, block);
			this._mergeAdjacentLists(wrapper);
		}
	}

	// Returns leaf blocks touched by a text range, preserving document order.
	_blocksInRange(range) {
		if (!range || range.collapsed) return [];
		const blocks = [...this.editor.root.querySelectorAll(this.editor.blockSelector())].filter((block) => {
			try {
				return range.intersectsNode(block);
			} catch (_) {
				return false;
			}
		});
		return blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
	}

	// Applies a list toggle to every block touched by the active selection.
	_toggleListBlocks(tag, blocks) {
		for (const block of blocks) {
			if (!block.isConnected) continue;
			const list = block.closest("ul, ol");
			if (block.tagName.toLowerCase() === "li" && list) {
				if (list.tagName.toLowerCase() !== tag) this.changeTagName(list, tag);
				continue;
			}
			const li = document.createElement("li");
			const wrapper = document.createElement(tag);
			while (block.firstChild) li.appendChild(block.firstChild);
			wrapper.appendChild(li);
			block.parentNode.replaceChild(wrapper, block);
			this._mergeAdjacentLists(wrapper);
		}
	}

	// Removes only the selected items from their lists, preserving unselected items.
	_unwrapListItems(blocks) {
		for (const item of blocks) {
			if (!item.isConnected || item.tagName.toLowerCase() !== "li") continue;
			const list = item.parentElement;
			if (!list || !/^(ul|ol)$/.test(list.tagName.toLowerCase())) continue;
			const paragraph = document.createElement("p");
			while (item.firstChild) paragraph.appendChild(item.firstChild);
			list.parentNode.insertBefore(paragraph, list);
			item.remove();
			if (!list.querySelector(":scope > li")) list.remove();
		}
	}

	// Coalesces directly adjacent lists of the same type after a block conversion.
	_mergeAdjacentLists(list) {
		if (!list?.isConnected) return null;
		const absorb = (target, source) => {
			while (source.firstChild) target.appendChild(source.firstChild);
			source.remove();
		};
		let current = list;
		const previous = current.previousElementSibling;
		if (previous?.tagName === current.tagName) {
			absorb(previous, current);
			current = previous;
		}
		const next = current.nextElementSibling;
		if (next?.tagName === current.tagName) absorb(current, next);
		return current;
	}

	// Method: _toggleBbq
	// Internal helper to toggle blockquote element on target `block`.
	_toggleBbq(block) {
		const bq = block.closest('blockquote');
		if (bq) {
			this.unwrapElement(bq);
		} else {
			const bqEl = document.createElement('blockquote');
			block.parentNode.insertBefore(bqEl, block);
			bqEl.appendChild(block);
		}
	}
}

export { Modification };

// EOF

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: rich-text clipboard
// Owns clipboard behavior for the RichText plugin.

class RichTextClipboard {
	constructor(plugin) {
		this.plugin = plugin;
		this._clipboardChordAt = 0;
	}

	// True when clipboard events should target this editor (not a foreign input).
	ownsClipboard(event = null) {
		const plugin = this.plugin;
		if (!plugin.editor?.root?.isConnected) return false;
		const input = plugin.editor.input;
		const target = event?.target;
		const active = document.activeElement;
		if (input?._isForeignEditable?.(target)) return false;
		if (input?._isForeignEditable?.(active)) return false;
		const root = plugin.editor.root;
		const inRoot = (el) => !!el && (el === root || root.contains(el));
		if (inRoot(target) || inRoot(active)) return true;
		const session = plugin.editor.activeSession();
		if (session?.cursor?.selectionKind === "range") return true;
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

	// Plain text for the current structural (or native) selection.
	selectedPlainText(session = null) {
		const plugin = this.plugin;
		const range = plugin.editor.range.selected(plugin.editor.root, session);
		return range ? range.toString() : "";
	}

	// Rich HTML for the current selection, including block wrappers for select-all.
	selectedHTML(session = null) {
		const plugin = this.plugin;
		const range = plugin.editor.range.selected(plugin.editor.root, session);
		if (!range) return "";
		const normalized = plugin.editor.activeSession(session).cursor.selection.normalizedRange();
		const documentLength = plugin.editor.root.innerText?.length ?? plugin.editor.root.textContent?.length ?? 0;
		if (normalized.start === 0 && normalized.end >= documentLength) return plugin.editor.root.innerHTML;
		const container = document.createElement("div");
		container.appendChild(range.cloneContents());
		return container.innerHTML;
	}

	// Writes rich and plain text to the system clipboard (event payload or Clipboard API).
	writeClipboard(text, event = null, html = "") {
		if (text == null) return false;
		if (event?.clipboardData) {
			if (html) event.clipboardData.setData("text/html", html);
			event.clipboardData.setData("text/plain", text);
			return true;
		}
		if (html && globalThis.navigator?.clipboard?.write && globalThis.ClipboardItem) {
			const item = new ClipboardItem({
				"text/html": new Blob([html], { type: "text/html" }),
				"text/plain": new Blob([text], { type: "text/plain" }),
			});
			navigator.clipboard.write([item]).catch(() => {});
			return true;
		}
		if (globalThis.navigator?.clipboard?.writeText) {
			globalThis.navigator.clipboard.writeText(text).catch(() => {});
			return true;
		}
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

	// Reads plain text from a paste event or the Clipboard API (async → Promise).
	readClipboard(event = null) {
		const fromEvent = event?.clipboardData?.getData?.("text/plain");
		if (fromEvent != null && fromEvent !== "") return Promise.resolve(fromEvent);
		if (globalThis.navigator?.clipboard?.readText) return globalThis.navigator.clipboard.readText().catch(() => "");
		return Promise.resolve("");
	}

	// Keeps only tags supported by the rich-text schema before DOM insertion.
	sanitizeClipboardHTML(html) {
		if (typeof html !== "string" || !html.trim()) return null;
		const template = document.createElement("template");
		template.innerHTML = html;
		const allowed = new Set([
			"blockquote", "br", "code", "em", "h1", "h2", "h3", "li", "ol", "p", "pre", "strong", "ul",
		]);
		const clean = (node) => {
			for (const child of [...node.childNodes]) {
				if (child.nodeType === Node.COMMENT_NODE) {
					child.remove();
					continue;
				}
				if (child.nodeType !== Node.ELEMENT_NODE) continue;
				clean(child);
				if (!allowed.has(child.tagName.toLowerCase())) {
					while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
					child.remove();
				}
			}
		};
		clean(template.content);
		return template.content;
	}

	// Inserts supported clipboard HTML and lets the editor normalizer repair structure.
	pasteHTML(html, session = null, event = null) {
		const plugin = this.plugin;
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const fragment = this.sanitizeClipboardHTML(html);
		if (!fragment?.childNodes.length) return false;
		const active = plugin.editor.activeSession(session);
		const range = plugin.editor.range.current(plugin.editor.root, active);
		if (!range) return false;
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		plugin.editor.history.run("paste", () => {
			const inserted = [...fragment.childNodes];
			const normalized = active.cursor.selection.normalizedRange();
			const documentLength = plugin.editor.root.innerText?.length ?? plugin.editor.root.textContent?.length ?? 0;
			const fullDocument = normalized.start === 0 && normalized.end >= documentLength;
			const hasBlock = inserted.some((node) =>
				node.nodeType === Node.ELEMENT_NODE && plugin.editor.schema.rule(node)?.type === "block",
			);
			const block = plugin.currentEditableBlock(active);
			if (fullDocument) plugin.editor.root.replaceChildren(fragment);
			else if (hasBlock && block && plugin.isEmptyBlock(block)) block.replaceWith(...inserted);
			else {
				range.deleteContents();
				range.insertNode(fragment);
			}
			const last = inserted.at(-1);
			if (last?.parentNode) {
				range.setStartAfter(last);
				range.collapse(true);
			}
			plugin.editor.text.refresh();
			plugin.editor.setContent(undefined, {
				session: active,
				history: true,
				selection: last?.nodeType === Node.TEXT_NODE
					? { node: last, offset: last.length }
					: last
						? { node: last, position: "end" }
						: undefined,
			});
		}, active);
		return true;
	}

	// Notes a keymap-driven clipboard op so the matching document event is ignored.
	_markClipboardChord() {
		this._clipboardChordAt = performance.now();
	}

	// True when a document cut/copy/paste event is the echo of a just-handled keymap chord.
	_fromClipboardChord() {
		return performance.now() - this._clipboardChordAt < 100;
	}

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
		const ok = this.writeClipboard(text, event, this.selectedHTML());
		if (ok && event) {
			event.preventDefault();
			event.stopPropagation();
		}
		return ok;
	}

	// Copies the selection then deletes it (one history unit).
	cutSelection(event = null) {
		const plugin = this.plugin;
		if (event && this._fromClipboardChord()) {
			event.preventDefault();
			return true;
		}
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const session = plugin.editor.activeSession();
		const text = this.selectedPlainText(session);
		if (!text) return false;
		const ok = this.writeClipboard(text, event, this.selectedHTML(session));
		if (!ok) return false;
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		plugin.editor.history.run("cut", () => {
			if (session.cursor.selectionKind === "range" || session.cursor.selectionKind === "node") {
				session.cursor.backspace();
			}
			session.classes?.update();
		}, session);
		return true;
	}

	// Inserts clipboard plain text at the caret/selection.
	// Prefer the `paste` event's clipboardData — do not rely on async clipboard.readText.
	pasteText(text = null, session = null, event = null) {
		const plugin = this.plugin;
		if (event && !this.ownsClipboard(event)) return false;
		if (!event && !this.ownsClipboard()) return false;
		const active = plugin.editor.activeSession(session);
		const apply = (raw) => {
			const value = String(raw ?? "").replace(/\r\n?/g, "\n");
			if (!value) return false;
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}
			plugin.removePlaceholderInCurrentBlock(active);
			active.cursor.insertText(value);
			active.classes?.update();
			return true;
		};
		if (text != null) return apply(text);
		if (event?.clipboardData) {
			const html = event.clipboardData.getData("text/html");
			if (html && this.pasteHTML(html, session, event)) return true;
			const plain = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text") || "";
			return apply(plain);
		}
		return false;
	}

	onCopy(event) {
		const plugin = this.plugin;
		plugin.copySelection(event);
	}

	onCut(event) {
		const plugin = this.plugin;
		plugin.cutSelection(event);
	}

	onPaste(event) {
		const plugin = this.plugin;
		plugin.pasteText(null, null, event);
	}
}

export { RichTextClipboard };

// EOF

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Function: richTextClasses
// Standard CSS class selectors and states for styling focus and selections.
function richTextClasses(options = {}) {
	return {
		selector: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre", "li", "blockquote", "strong", "em", "u", "a", "code"],
		focus: "focus",
		focusWithin: "focus-within",
		selected: "selected",
		selectedWithin: "selected-within",
		...options,
	};
}

export { richTextClasses };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04


// Function: richTextKeymap
// Returns standard key binding maps for structural formatting.
function richTextKeymap(overrides = {}) {
	return editorKeymap({
		"Mod+B": { type: "toggleInline", args: { tag: "strong" } },
		"Mod+I": { type: "toggleInline", args: { tag: "em" } },
		"Mod+U": { type: "toggleInline", args: { tag: "u" } },
		"Mod+L": { type: "link" },
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

export { richTextKeymap };

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04


const richTextRules = {
	":root": {
		type: "root",
		contains: ["section", "nav", "header", "h1", "h2", "h3", "p", "pre", "ul", "ol", "blockquote"],
		default: "p",
		normalize: { empty: "fill", text: "wrap", invalidChild: "lift" },
	},
	"@inline": ["strong", "em", "u", "code", "a"],
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
	u: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	code: { type: "inline", contains: ["#text"], normalize: { empty: "unwrap", invalidChild: "lift" } },
	a: { type: "inline", contains: ["#text", "@inline"], normalize: { empty: "unwrap", invalidChild: "lift" } },
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

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-26

// Module: richtext plugin
// Installs rich-text block editing behavior.


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
			link: (_command, context) => {
				const target = window.prompt("Link URL", "https://");
				if (!target) return false;
				try {
					const url = new URL(target, document.baseURI);
					if (!["http:", "https:", "mailto:"].includes(url.protocol)) return false;
				} catch (_) {
					return false;
				}
				return new Modification(context.session, { schema: editor.schema }).toggleLink(target);
			},
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
		range.insertNode(br);
		// Position after the break without adding a zero-width character to document text.
		this.editor.setContent(undefined, { session, selection: { node: br, position: "after" } });
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

// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-06-26

// Module: richtext
// Installs rich-text schema presets, keymaps, classes, and block editing behavior.


// Short aliases for convenient default import usage:
//   import richtext from "structural"
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
