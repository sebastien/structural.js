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
				strong: false, em: false, code: false,
				h1: false, h2: false, h3: false,
				ul: false, ol: false, blockquote: false,
			};
		}
		return {
			strong:     !!el.closest('strong, b'),
			em:         !!el.closest('em, i'),
			code:       !!el.closest('code'),
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
		if (!this.allowsInline(tag)) return;
		let range = this.rangeFromCursor();
		if (!range || range.collapsed) return;

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
				if (!range || range.collapsed) return;
			}
			const created = this.wrapRange(range, tag);
			this._savedPoint = this._endPoint(created);
			this._savedWrapper = created;
		}

		this._restoreCursor();
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
		while ((node = walker.nextNode())) tags.push(node);
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
		if (!this.allowsBlock(tag)) return;
		const block = this.findBlock(this.cursor.anchor);
		if (block === this.editor.root) return;
		this._savePoint();

		if (tag === 'ul' || tag === 'ol') {
			this._toggleList(tag, block);
		} else if (tag === 'blockquote') {
			this._toggleBbq(block);
		} else {
			this._heading(tag, block);
		}

		this._restoreCursor();
	}

	// ----------------------------------------------------------------------------
	//
	// RANGE & WORD UTILITIES
	//
	// ----------------------------------------------------------------------------

	// Method: _syncNativeSelection
	// Synchronizes the native browser selection with the cursor's internal text selection.
	_syncNativeSelection() {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			return null;
		}

		const range = selection.getRangeAt(0);
		if (!this._containsPoint(range.startContainer) || !this._containsPoint(range.endContainer)) {
			return null;
		}

		const start = this.text.indexOfPoint({
			node: range.startContainer,
			offset: range.startOffset,
		});
		const end = this.text.indexOfPoint({
			node: range.endContainer,
			offset: range.endOffset,
		});
		if (start < 0 || end < 0 || start === end) {
			return null;
		}

		this.cursor.selection.set(start, end);
		this.cursor.selectionKind = 'range';
		this.cursor.offset = end;
		this.cursor.anchor = this.text.focusNodeAt(end) || this.cursor.anchor;
		this.cursor.caret.setVirtual(null);
		return range;
	}

	// Method: _containsPoint
	// Verifies if the specified `node` lies within the editor's root element.
	_containsPoint(node) {
		if (!node) return false;
		const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		return !!element && this.editor.root.contains(element);
	}

	// Method: rangeFromCursor
	// Returns a valid native DOM Range from the cursor position or active selection.
	rangeFromCursor() {
		const nativeRange = this._syncNativeSelection();
		if (nativeRange) {
			return nativeRange;
		}
		if (this.cursor.selectionKind === 'range') {
			return this.cursor.selection.toDomRange();
		}
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
		const point = this.text.pointAt(this.cursor.offset);
		if (!point || point.node?.nodeType !== Node.TEXT_NODE) return null;

		const data = point.node.data;
		let start = point.offset;
		let end = point.offset;

		while (start > 0 && /\w/.test(data[start - 1])) start -= 1;
		while (end < data.length && /\w/.test(data[end])) end += 1;

		if (start === end) return null;

		const startIndex = this.text.indexOfPoint({ node: point.node, offset: start });
		const endIndex = this.text.indexOfPoint({ node: point.node, offset: end });

		if (startIndex < 0 || endIndex < 0) return null;
		return { start: startIndex, end: endIndex };
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
		const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
		if (!el) return this.editor.root;
		const block = el.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, div');
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
		this.cursor.selection.clear();
		this.cursor.selection.set(start, end);
		this.cursor.selectionKind = 'range';
		this.cursor.offset = end;
		this.cursor.anchor = this.text.focusNodeAt(end) || this.cursor.anchor;
		this.cursor.caret.setVirtual(null);
		this.cursor.selection.apply();
		this.editor.root.dispatchEvent(new CustomEvent('CursorMove', {
			detail: {
				previous: { anchor: null },
				current: { anchor: this.cursor.anchor },
			},
		}));
	}

	// Method: _wrapperBounds
	// Internal helper to compute start and end indices of text enclosed in wrapper element.
	_wrapperBounds(wrapper) {
		const positions = this.text.positions();
		let outerStart = -1;
		let outerEnd = -1;
		for (let i = 0; i < positions.length; i += 1) {
			const slot = positions[i];
			if (outerStart < 0 && slot.boundary?.rightNode === wrapper) outerStart = i;
			if (outerStart >= 0 && slot.boundary?.leftNode === wrapper && slot.boundary?.rightNode !== wrapper) {
				outerEnd = i;
				break;
			}
		}
		if (outerStart < 0 || outerEnd < 0) return null;

		let start = -1;
		for (let i = outerStart + 1; i < outerEnd; i += 1) {
			if (positions[i].point?.node?.nodeType === Node.TEXT_NODE) {
				start = i;
				break;
			}
		}
		let end = -1;
		for (let i = outerEnd - 1; i > outerStart; i -= 1) {
			if (positions[i].point?.node?.nodeType === Node.TEXT_NODE) {
				end = i + 1;
				break;
			}
		}
		return start >= 0 && end >= 0 ? { start, end } : null;
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
		}
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