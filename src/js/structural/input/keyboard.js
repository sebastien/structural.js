// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-08-04

// Module: input/keyboard
// Keyboard listener translating raw user input to structural cursor ops.

// Class: EditorKeyboardInput
// Handles keyboard input for an EditorTextInput controller.
class EditorKeyboardInput {
	constructor(input) {
		this.input = input;
	}

	// Method: onKeyDown
	// Handles key presses translating arrows, deletes, letters to cursor calls.
	onKeyDown(event) {
		const input = this.input;
		const root = input.editor?.root;
		if (!root?.isConnected) return;
		const documentEvent = event.target === document && !input._isForeignEditable(document.activeElement);
		if (!input._eventInRoot(event) && !input._editorActive && !documentEvent) {
			return;
		}
		// Ignore keys meant for other form controls (chat fields, search, ...).
		if (input._isForeignEditable(event.target) || input._isForeignEditable(document.activeElement)) {
			return;
		}
		// Sync before keymap actions (Ctrl+A, Enter, ...) so programmatic/native carets win.
		// Do not overwrite an existing structural range (format ops remap it carefully).
		const kind = input.cursor?.selectionKind;
		if (kind !== "range" && kind !== "node") {
			input._syncNativeSelection({ allowCollapsed: true });
		}
		// Contextual input rules run before the keymap so domain handlers (blocks, menus)
		// can claim keys like Enter/ArrowDown without fighting global bindings.
		if (input.editor?.handleInputEvent?.(event, input.session)) {
			input._guardNativeSync(() => {
				input.editor.selection?.syncToNative(input.session);
			});
			return;
		}

		if (input.editor?.handleKeyEvent(event, input.session)) {
			// Keymap handlers (arrows, deleteSmart, ...) move the structural caret;
			// re-assert native so the next insert does not re-import a stale range.
			input._guardNativeSync(() => {
				input.editor.selection?.syncToNative(input.session);
			});
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;

		let handled = true;
		switch (event.key) {
			case "ArrowLeft":
				input.cursor.left(event.shiftKey);
				break;
			case "ArrowRight":
				input.cursor.right(event.shiftKey);
				break;
			case "ArrowUp":
				input.cursor.up(event.shiftKey);
				break;
			case "ArrowDown":
				input.cursor.down(event.shiftKey);
				break;
			case "Backspace":
				input.cursor.backspace();
				break;
			case "Delete":
				input.cursor.delete();
				break;
			case "Enter":
			case "Return":
				// Swallow newline insertion for now.
				break;
			case " ":
				{
					const rt = input.editor.capability?.("richtext") ?? input.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, input.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(input.session);
						input.cursor.insertText(event.key);
					} else if (input.cursor?.selectionKind === "caret") {
						const ctx = input.cursor.getContext?.();
						const pointNode = ctx?.point?.node;
						if (
							!input.editor?.text?.isWhitespacePreserved?.(pointNode) &&
							/\s/.test(ctx?.char?.after ?? "")
						) {
							// Advance caret past the existing space instead of a silent no-op (no double space inserted).
							input.cursor.right();
						}
						// If caret is already after the space, swallow — position is already post-space.
					}
				}
				break;
			default:
				if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
					const rt = input.editor.capability?.("richtext") ?? input.editor.richText;
					const shouldInsert = rt?.shouldInsertText?.(event.key, input.session) !== false;
					if (shouldInsert) {
						rt?.removePlaceholderInCurrentBlock?.(input.session);
						input.cursor.insertText(event.key);
					}
				} else {
					handled = false;
				}
				break;
		}
		if (handled) event.preventDefault();
	}
}

export { EditorKeyboardInput };
