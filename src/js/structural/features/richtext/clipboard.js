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
