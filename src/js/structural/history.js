// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: history
// Snapshot-based undo/redo for an Editor (html + selection).

// Class: EditorHistory
// Snapshot-based undo/redo stack (html + selection). Typing/deletes coalesce.
class EditorHistory {
	constructor(editor, options = {}) {
		this.editor = editor;
		this.limit = options.limit ?? 100;
		this.coalesceMs = options.coalesceMs ?? 800;
		this.undoStack = [];
		this.redoStack = [];
		this._restoring = false;
		this._nestedDepth = 0;
		this._lastKind = null;
		this._lastAt = 0;
	}

	// Method: snapshot
	// Captures document HTML and caret/range selection.
	snapshot(session = this.editor.localSession) {
		const cursor = session?.cursor;
		const sel = cursor?.selection;
		let selection;
		if (cursor?.selectionKind === "range" && sel?.isActive) {
			const n = sel.normalizedRange?.() ?? null;
			selection = {
				kind: "range",
				start: n?.start ?? sel.anchorOffset ?? 0,
				end: n?.end ?? sel.focusOffset ?? 0,
			};
		} else {
			selection = { kind: "caret", offset: cursor?.offset ?? 0 };
		}
		return { html: this.editor.root.innerHTML, selection };
	}

	// Method: restore
	// Replaces root contents and repositions the caret/selection.
	restore(entry, session = this.editor.localSession) {
		if (!entry || !this.editor?.root) return false;
		this._restoring = true;
		try {
			this.editor.root.innerHTML = entry.html;
			this.editor.text.refresh();
			const s = entry.selection;
			if (s?.kind === "range" && typeof s.start === "number" && typeof s.end === "number") {
				this.editor.selection.select(
					this.editor.text.clampIndex(s.start),
					this.editor.text.clampIndex(s.end),
					session,
				);
			} else {
				session.cursor.moveTo(this.editor.text.clampIndex(s?.offset ?? 0));
			}
			this.editor.selection?.syncToNative?.(session);
			session.classes?.update?.();
			return true;
		} finally {
			this._restoring = false;
		}
	}

	// Method: record
	// Pushes a before-change snapshot. Same-kind input/delete within coalesceMs merge.
	// Nested records (e.g. deleteSmart → cursor.backspace) are ignored.
	record(kind = "edit", session = this.editor.localSession) {
		if (this._restoring || this._nestedDepth > 0 || !this.editor?.root?.isConnected) return this;
		const now = performance.now();
		const coalesce =
			kind === this._lastKind &&
			(kind === "input" || kind === "delete") &&
			now - this._lastAt < this.coalesceMs &&
			this.undoStack.length > 0;
		if (coalesce) {
			this._lastAt = now;
			return this;
		}
		this.undoStack.push(this.snapshot(session));
		while (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack.length = 0;
		this._lastKind = kind;
		this._lastAt = now;
		return this;
	}

	// Method: run
	// Runs `fn` while suppressing nested history records (one undo unit).
	run(kind, fn, session = this.editor.localSession) {
		this.record(kind, session);
		this._nestedDepth += 1;
		try {
			return fn();
		} finally {
			this._nestedDepth = Math.max(0, this._nestedDepth - 1);
		}
	}

	// Method: clear
	// Drops all undo/redo entries (e.g. after external setContent).
	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._lastKind = null;
		this._lastAt = 0;
		return this;
	}

	// Method: undo
	// Restores the previous snapshot.
	undo(session = this.editor.localSession) {
		if (!this.undoStack.length) return false;
		const current = this.snapshot(session);
		const prev = this.undoStack.pop();
		this.redoStack.push(current);
		this._lastKind = null;
		return this.restore(prev, session);
	}

	// Method: redo
	// Re-applies a previously undone snapshot.
	redo(session = this.editor.localSession) {
		if (!this.redoStack.length) return false;
		const current = this.snapshot(session);
		const next = this.redoStack.pop();
		this.undoStack.push(current);
		this._lastKind = null;
		return this.restore(next, session);
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}

	get canRedo() {
		return this.redoStack.length > 0;
	}
}

export { EditorHistory };
