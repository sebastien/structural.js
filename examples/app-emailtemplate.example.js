import { Editor, richTextClasses, richTextKeymap, richTextSchema } from "structural/editor";
import { Modification } from "structural/modification";

const EDITABLE_SELECTOR = ".EDITABLE";
const TEXT_SELECTOR = ".TEXT, .text";

// Tracks which editable block is active and handles block-level navigation.
class BlockController {
	constructor(app) {
		this.app = app;
		this.current = null;
		this.readonly = null;
	}

	all() {
		return [...this.app.template.querySelectorAll(EDITABLE_SELECTOR)];
	}

	isRich(block) {
		return !!block && !/^H[1-6]$/.test(block.tagName);
	}

	editableFor(node) {
		const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const block = element?.closest(EDITABLE_SELECTOR);
		return block && this.app.template.contains(block) ? block : null;
	}

	textFor(node) {
		const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
		const block = element?.closest(TEXT_SELECTOR);
		return block && this.app.template.contains(block) ? block : null;
	}

	setReadonly(block) {
		this.readonly?.classList.remove("email-editor-readonly");
		this.readonly = block && !block.closest(EDITABLE_SELECTOR) ? block : null;
		this.readonly?.classList.add("email-editor-readonly");
	}

	setCurrent(block, options = {}) {
		if (this.current === block) {
			this.app.toolbarUI.update();
			return block;
		}

		this.current?.classList.remove("email-editor-current");
		this.current = block && this.app.template.contains(block) ? block : null;
		this.current?.classList.add("email-editor-current");

		this.app.editor.localSession.currentBlock = this.current;
		this.app.editor._currentBlock = this.current;
		this.setReadonly(null);

		if (this.current && options.place !== false) {
			if (options.place === "end") this.app.editor.moveCursorToBlockEnd(this.current);
			else if (options.place === "start") this.app.editor.moveCursorToBlockStart(this.current);
		}

		this.app.editor.classes?.update();
		this.app.toolbarUI.update();
		return this.current;
	}

	focusEditable(direction = 1) {
		const blocks = this.all();
		if (blocks.length === 0) return false;
		const index = this.current ? blocks.indexOf(this.current) : -1;
		const next = blocks[(index + direction + blocks.length) % blocks.length];
		this.setCurrent(next, { place: direction < 0 ? "end" : "start" });
		next.scrollIntoView({ block: "nearest", inline: "nearest" });
		return true;
	}

	normalize(block = this.current) {
		if (!block?.isConnected) return false;
		this.app.editor.normalize(block, { root: this.app.template, session: this.app.editor.localSession });
		this.app.editor.text.refresh();
		this.app.editor.classes?.update();
		this.app.toolbarUI.update();
		return true;
	}

	activeFromSelection() {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return null;
		const range = selection.getRangeAt(0);
		if (!this.app.editor.range.within(this.app.template, range)) return null;
		return this.editableFor(range.startContainer);
	}

	activeEditable() {
		return this.editableFor(this.app.editor.input.cursor.anchor) ?? this.current;
	}
}

// Translates between DOM selection and the editor's structural selection.
class SelectionController {
	constructor(app) {
		this.app = app;
	}

	moveCursorInto(block, event = null) {
		if (!block?.isConnected) return false;
		if (!event) {
			return this.app.editor.moveCursorToBlockStart(block, this.app.editor.localSession);
		}
		return this.app.editor.selection.placeCaretFromPoint(
			block,
			event.clientX,
			event.clientY,
			this.app.editor.localSession,
		);
	}

	selectCurrentEditable() {
		const block = this.app.blocks.current;
		if (!block?.isConnected) return false;

		const startNode = this.app.editor.firstTextNode(block);
		const endNode = this.app.editor.lastTextNode(block);
		const startPoint = startNode ? { node: startNode, offset: 0 } : { node: block, offset: 0 };
		const endPoint = endNode
			? { node: endNode, offset: endNode.data.length }
			: { node: block, offset: block.childNodes.length };
		const start = this.app.editor.text.indexOfPoint(startPoint);
		const end = this.app.editor.text.indexOfPoint(endPoint);
		if (start < 0 || end < 0 || start === end) return false;

		const cursor = this.app.editor.input.cursor;
		cursor.select(start, end);
		this.app.editor.classes?.update();
		this.app.toolbarUI.update();
		return true;
	}

	snapshotTextRange() {
		const block = this.app.blocks.current;
		return block?.isConnected ? this.app.editor.range.snapshot(block, this.app.editor.localSession) : null;
	}

	restoreTextRange(snapshot) {
		const block = this.app.blocks.current;
		return snapshot && block?.isConnected
			? this.app.editor.range.restore(snapshot, block, this.app.editor.localSession)
			: false;
	}

	syncNativeToStructural() {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return false;
		const range = selection.getRangeAt(0);
		const block = this.app.blocks.editableFor(range.startContainer);
		if (!block || !block.contains(range.endContainer)) return false;
		this.app.blocks.setCurrent(block, { place: false });
		const synced = this.app.editor.selection.syncFromNative(block, this.app.editor.localSession);
		if (synced) this.app.toolbarUI.update();
		return synced;
	}

	rangeWithinCurrentSlot() {
		const block = this.app.blocks.current;
		return block?.isConnected ? this.app.editor.range.current(block, this.app.editor.localSession) : null;
	}

	rangeAtSlotEdge(range, edge) {
		const block = this.app.blocks.current;
		return edge === "start"
			? this.app.editor.range.atBlockStart(range, block)
			: this.app.editor.range.atBlockEnd(range, block);
	}
}

// Keeps the floating toolbar in sync with the active block and formatting state.
class ToolbarController {
	constructor(app) {
		this.app = app;
	}

	update() {
		const block = this.app.blocks.current;
		if (!block?.isConnected) {
			this.app.toolbar.hidden = true;
			return;
		}

		const rich = this.app.blocks.isRich(block);
		const rect = block.getBoundingClientRect();
		this.app.toolbar.hidden = false;
		this.app.toolbar.style.left = `${Math.max(92, rect.left + rect.width / 2)}px`;
		this.app.toolbar.style.top = `${Math.max(56, rect.top)}px`;
		this.app.modeLabel.textContent = rich ? "Rich text" : "Text only";

		const state = this.app.mod.formats();
		for (const button of this.app.toolbar.querySelectorAll("button[data-tag]")) {
			button.disabled = !rich;
			button.classList.toggle("active", rich && !!state[button.dataset.tag]);
		}
	}

	onMouseDown(event) {
		this.app.selection.syncNativeToStructural();
		event.preventDefault();
		event.stopPropagation();
	}

	onClick(event) {
		const button = event.target.closest("button[data-tag]");
		if (!button || button.disabled) return;
		this.app.editor.action(`toggleInline:${button.dataset.tag}`);
		this.update();
	}
}

// Composes the example: editor setup, actions, and DOM event wiring.
class EmailTemplateApp {
	constructor(template, toolbar, modeLabel) {
		this.template = template;
		this.toolbar = toolbar;
		this.modeLabel = modeLabel;

		this.editor = this.createEditor();
		this.mod = new Modification(this.editor);
		this.blocks = new BlockController(this);
		this.selection = new SelectionController(this);
		this.toolbarUI = new ToolbarController(this);

		this.bindEvents();
		this.initialize();
	}

	createEditor() {
		const editor = new Editor(this.template, {
			schema: richTextSchema(),
			keymap: richTextKeymap({
				"Mod+A": { type: "selectCurrentEditable" },
				Enter: { type: "slotEnter" },
				"Shift+Enter": { type: "slotLineBreak" },
				Backspace: { type: "slotDeleteSmart", args: { key: "Backspace" } },
				Delete: { type: "slotDeleteSmart", args: { key: "Delete" } },
				Tab: { type: "focusEditable", args: { direction: 1 } },
				"Shift+Tab": { type: "focusEditable", args: { direction: -1 } },
			}),
			classes: richTextClasses({
				selector: EDITABLE_SELECTOR,
				focus: "focus",
				focusWithin: "focus-within",
				selected: "selected",
				selectedWithin: "selected-within",
			}),
		});

		editor.configureActions({
			toggleInline: command => this.toggleInline(command),
			slotEnter: () => this.slotEnter(),
			slotLineBreak: () => this.slotLineBreak(),
			slotDeleteSmart: command => this.slotDeleteSmart(command.args.key),
			selectCurrentEditable: () => this.selection.selectCurrentEditable(),
			focusEditable: command => this.blocks.focusEditable(command.args.direction ?? 1),
		});

		return editor;
	}

	initialize() {
		this.editor.text.refresh();
		this.blocks.setCurrent(this.blocks.all()[0] ?? null, { place: "start" });
	}

	toggleInline(command) {
		if (!this.blocks.isRich(this.blocks.current)) return false;
		const selection = this.selection.snapshotTextRange();
		this.mod.toggleInline(command.args.tag ?? command.args.value);
		this.blocks.normalize(this.blocks.current);
		this.selection.restoreTextRange(selection);
		return true;
	}

	insertSlotLineBreak() {
		const range = this.selection.rangeWithinCurrentSlot();
		if (!range) return false;

		if (!range.collapsed) {
			range.deleteContents();
			range.collapse(true);
		}

		const br = document.createElement("br");
		const tail = document.createTextNode("\u200b");
		range.insertNode(tail);
		range.insertNode(br);
		this.editor.text.refresh();
		this.editor.selection.setCaret(tail, tail.data.length, this.editor.localSession);
		this.editor.classes?.update();
		this.blocks.setCurrent(this.blocks.current, { place: false });
		this.toolbarUI.update();
		return true;
	}

	slotEnter() {
		if (!this.blocks.isRich(this.blocks.current)) return false;
		return this.insertSlotLineBreak();
	}

	slotLineBreak() {
		if (!this.blocks.isRich(this.blocks.current)) return false;
		return this.insertSlotLineBreak();
	}

	slotDeleteSmart(key) {
		const slot = this.blocks.current;
		if (!slot?.isConnected) return false;

		const range = this.selection.rangeWithinCurrentSlot();
		if (!range) return false;
		if (key === "Backspace" && this.selection.rangeAtSlotEdge(range, "start")) return true;
		if (key === "Delete" && this.selection.rangeAtSlotEdge(range, "end")) return true;

		if (key === "Delete") this.editor.input.cursor.delete();
		else this.editor.input.cursor.backspace();

		if (!this.blocks.editableFor(this.editor.input.cursor.anchor)) {
			if (key === "Delete") this.editor.moveCursorToBlockEnd(slot, this.editor.localSession);
			else this.editor.moveCursorToBlockStart(slot, this.editor.localSession);
		}

		this.blocks.normalize(slot);
		this.blocks.setCurrent(slot, { place: false });
		return true;
	}

	allowStructuralInput(event) {
		if (this.toolbar.contains(event.target)) return false;
		if (event.metaKey || event.ctrlKey) {
			const formattingKey = ["b", "i", "`"].includes(event.key.toLowerCase());
			if (!formattingKey) return true;
		}
		if (event.altKey) return true;

		const editingKey = event.key.length === 1 || [
			"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
			"Backspace", "Delete", "Enter", "Return", "Tab",
		].includes(event.key);
		if (!editingKey) return true;
		if (event.key === "Tab") return true;

		const targetBlock = this.blocks.editableFor(event.target);
		const block = targetBlock ?? (this.blocks.current ? this.blocks.activeEditable() : null);
		const allowed = !!block?.isConnected;
		if (allowed && block !== this.blocks.current) this.blocks.setCurrent(block, { place: false });
		return allowed;
	}

	onDocumentKeyDown(event) {
		if (this.allowStructuralInput(event)) return;
		event.stopImmediatePropagation();
	}

	onDocumentMouseDown(event) {
		if (!this.template.contains(event.target) || this.blocks.editableFor(event.target)) return;
		const text = this.blocks.textFor(event.target);
		this.blocks.setCurrent(null, { place: false });
		if (text) this.blocks.setReadonly(text);
		window.getSelection()?.removeAllRanges();
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	onTemplateMouseDown(event) {
		const editable = this.blocks.editableFor(event.target);
		if (editable) {
			this.blocks.setCurrent(editable, { place: false });
			event.preventDefault();
			event.stopPropagation();
			this.selection.moveCursorInto(editable, event);
			return;
		}

		const text = this.blocks.textFor(event.target);
		this.blocks.setCurrent(null, { place: false });
		if (text) this.blocks.setReadonly(text);
		event.preventDefault();
		event.stopPropagation();
	}

	onTemplateClick(event) {
		if (this.template.contains(event.target)) event.preventDefault();
	}

	onCursorMove() {
		const block = this.blocks.editableFor(this.editor.input.cursor.anchor);
		if (block) this.blocks.setCurrent(block, { place: false });
		else if (!this.blocks.activeFromSelection()) this.blocks.setCurrent(null, { place: false });
	}

	bindEvents() {
		document.addEventListener("keydown", event => this.onDocumentKeyDown(event), true);
		document.addEventListener("mousedown", event => this.onDocumentMouseDown(event), true);

		this.template.addEventListener("mousedown", event => this.onTemplateMouseDown(event), true);
		this.template.addEventListener("click", event => this.onTemplateClick(event));
		this.template.addEventListener("mouseup", () => {
			this.selection.syncNativeToStructural();
		});

		this.toolbar.addEventListener("mousedown", event => this.toolbarUI.onMouseDown(event));
		this.toolbar.addEventListener("click", event => this.toolbarUI.onClick(event));

		this.editor.root.addEventListener("CursorMove", () => this.onCursorMove());

		window.addEventListener("scroll", () => this.toolbarUI.update(), { passive: true });
		window.addEventListener("resize", () => this.toolbarUI.update());
	}
}

new EmailTemplateApp(
	document.querySelector(".template"),
	document.getElementById("email-template-toolbar"),
	document.getElementById("email-template-toolbar-mode"),
);
