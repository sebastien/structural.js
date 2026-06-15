import { TextAdapter } from "structural/text";
import { Cursor } from "structural/cursor";

class Schema {}

class Adapter {}

class TextInput {
	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	constructor(editor, options = {}) {
		this._onKeyUp = this.onKeyUp.bind(this);
		this._onKeyDown = this.onKeyDown.bind(this);
		this._onMouseDown = this.onMouseDown.bind(this);
		// A text input wraps a cursor
		this.cursor = new Cursor(this, options.cursor);
		this.editor = null;
		this.bind(editor);
	}

	bind(editor) {
		if (this.editor !== editor) {
			this.unbind();
			const node = document;
			node.addEventListener("keyup", this._onKeyUp);
			node.addEventListener("keydown", this._onKeyDown);
			node.addEventListener("mousedown", this._onMouseDown);
			this.editor = editor;
		}
		return this;
	}

	unbind(_editor = this.editor) {
		const node = document; // editor?.root;
		if (node) {
			node.removeEventListener("keyup", this._onKeyUp);
			node.removeEventListener("keydown", this._onKeyDown);
			node.removeEventListener("mousedown", this._onMouseDown);
		}
		this.editor = null;
		return this;
	}

	// ========================================================================
	// EVENTS
	// ========================================================================

	onKeyUp(_event) {
		// Text input is handled during keydown so control keys can be
		// swallowed before they perform browser-default actions.
	}

	onKeyDown(event) {
		event.preventDefault();
		switch (event.key) {
			case "ArrowLeft":
				this.cursor.left(event.shiftKey);
				break;
			case "ArrowRight":
				this.cursor.right(event.shiftKey);
				break;
			case "ArrowUp":
				this.cursor.up(event.shiftKey);
				break;
			case "ArrowDown":
				this.cursor.down(event.shiftKey);
				break;
			case "Backspace":
				this.cursor.backspace();
				break;
			case "Delete":
				this.cursor.delete();
				break;
			case "Enter":
			case "Return":
				// Swallow newline insertion for now.
				break;
			default:
				if (
					event.key.length === 1 &&
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey
				) {
					this.cursor.insertText(event.key);
				}
				break;
		}
	}

	onMouseDown(event) {
		const targetElement = event.target?.nodeType === Node.ELEMENT_NODE
			? event.target
			: event.target?.parentElement;
		const atom = targetElement?.closest(".atom, .atomic");
		if (atom && this.editor?.text.isAtom(atom)) {
			this.cursor._desiredX = null;
			const rect = atom.getBoundingClientRect();
			const side = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
			this.cursor.selectAtom(atom, side);
			return;
		}
		const container = targetElement?.closest(".container, .C");
		if (container && this.editor?.text.isContainer(container)) {
			const skipped = targetElement?.closest(".skipped, .skip, .S");
			if (skipped && container.contains(skipped)) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side =
					event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
				return;
			}
			const offset = this.cursor.offsetFromPoint(event.clientX, event.clientY);
			const position = this.editor.text.positionSlotAt(offset);
			if (
				!this.editor.text.acceptsText(position) ||
				!this.cursor._isWithinNode(container, position?.point?.node)
			) {
				this.cursor._desiredX = null;
				const rect = container.getBoundingClientRect();
				const side =
					event.clientX > rect.left + rect.width / 2 ? "after" : "before";
				this.cursor.selectContainer(container, side);
				return;
			}
			this.cursor._desiredX = null;
			this.cursor.moveTo(offset);
			return;
		}
		// FIXME: Not great to have this here
		this.cursor._desiredX = null;
		this.cursor.moveTo(
			this.cursor.offsetFromPoint(event.clientX, event.clientY),
		);
	}
}

class Editor {
	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	constructor(node, options = {}) {
		this.root = node;
		this.text = new TextAdapter(node, options.text).attach();
		this.input = new TextInput(this, options);
		this.input.cursor.moveTo(8);
	}

	destroy() {
		this.input.unbind();
		this.text.detach();
	}
}

export { Schema, Adapter, Cursor, Editor };
// EOF
