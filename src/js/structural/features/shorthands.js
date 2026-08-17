// Project: structural.js
// Configurable inline shorthands such as #tags, @mentions, +tasks, and dates.

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shorthandEvent(editor, type, detail) {
	editor.root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
}

function normalizeDefinition(input, index) {
	const definition = { ...input };
	if (!definition.trigger || String(definition.trigger).length !== 1) {
		throw new TypeError("A shorthand trigger must be one character");
	}
	return {
		id: definition.id ?? `shorthand-${index}`,
		trigger: String(definition.trigger),
		pattern: definition.pattern ?? null,
		queryPattern: definition.queryPattern ?? /^[^\s#@+!]*$/u,
		boundary: definition.boundary ?? /(?:^|\s)$/u,
		element: definition.element ?? "span",
		className: definition.className ?? "atom shorthand",
		label: definition.label,
		source: definition.source,
		match: definition.match,
		commit: definition.commit,
		auto: definition.auto ?? false,
		create: definition.create,
		...definition,
	};
}

// Class: Shorthands
// Detects configured shorthand queries and replaces committed values with atoms.
class Shorthands {
	static pluginName = "shorthands";

	constructor(options = {}) {
		this.options = options;
		this.definitions = (options.definitions ?? []).map(normalizeDefinition);
		this.editor = null;
		this.active = null;
		this._rule = null;
		this._onCursorMove = this._onCursorMove.bind(this);
	}

	attach(editor) {
		this.editor = editor;
		editor.shorthands = this;
		this._rule = { match: /.*/, do: (args) => this._input(args) };
		editor.addInputRules([this._rule], { prepend: true });
		editor.root.addEventListener("CursorMove", this._onCursorMove);
		return this;
	}

	detach() {
		if (!this.editor) return this;
		this.dismiss("detach");
		this.editor.removeInputRules([this._rule]);
		this._rule = null;
		this.editor.root.removeEventListener("CursorMove", this._onCursorMove);
		if (this.editor.shorthands === this) delete this.editor.shorthands;
		this.editor = null;
		return this;
	}

	_definitionFor(trigger, query, context, automatic = false) {
		return this.definitions.find((definition) => {
			if (definition.trigger !== trigger) return false;
			if (automatic && !definition.auto) return false;
			if (definition.pattern && !definition.pattern.test(query)) return false;
			if (definition.queryPattern && !definition.queryPattern.test(query)) return false;
			return definition.match ? definition.match(query, context) !== false : true;
		}) ?? null;
	}

	_queryAt(context) {
		const end = context.offset;
		const text = this.editor.text.textBetween(Math.max(0, end - 160), end);
		let found = null;
		for (const definition of this.definitions) {
			const re = new RegExp(`(?:^|\\s)(${escapeRegExp(definition.trigger)})([^\\s#@+!]*$)`, "u");
			const match = re.exec(text);
			if (!match) continue;
			const triggerIndex = match.index + match[0].indexOf(match[1]);
			const before = text.slice(0, triggerIndex);
			if (typeof definition.boundary === "function") {
				if (!definition.boundary(before, context)) continue;
			} else if (definition.boundary instanceof RegExp) {
				definition.boundary.lastIndex = 0;
				if (!definition.boundary.test(before)) continue;
			}
			const prefixLength = match[0].length - match[1].length - match[2].length;
			const start = end - match[0].length + prefixLength;
			const query = match[2];
			if (!this._definitionFor(definition.trigger, query, context)) continue;
			if (!found || start > found.start) found = { definition, trigger: match[1], query, start, end };
		}
		return found;
	}

	_input(args) {
		const event = args.event;
		const session = args.session ?? this.editor.activeSession();
		const context = args.context ?? this.editor.contextAt(session);
		const current = this._queryAt(context);
		if (this.active && event.key === "Escape") {
			this.dismiss("escape");
			return true;
		}
		if (this.active && (event.key === "Enter" || event.key === "Tab")) {
			if (this.active.items?.length) {
				this.active.item = this.active.items[0];
				this.commit(this.active, { session });
				return true;
			}
		}
		const delimiter = typeof event.key === "string" && /^[\s.,;:!?)]$/u.test(event.key);
		if (current && delimiter) {
			const automatic = this._definitionFor(current.trigger, current.query, context, true);
			if (automatic) {
				this.commit({ ...current, definition: automatic }, { session, delimiter: event.key });
				session.cursor.insertText(event.key);
				return true;
			}
		}
		queueMicrotask(() => this.update(session));
		return false;
	}

	async update(session = null) {
		if (!this.editor) return null;
		const activeSession = this.editor.activeSession(session);
		const next = this._queryAt(this.editor.contextAt(activeSession));
		if (!next) {
			if (this.active) this.dismiss("query-ended");
			return null;
		}
		const same = this.active && this.active.start === next.start && this.active.definition.id === next.definition.id;
		this.active = next;
		if (!same) shorthandEvent(this.editor, "ShorthandOpen", { ...next, items: [], session: activeSession });
		let items = [];
		if (typeof next.definition.source === "function") {
			items = (await next.definition.source(next.query, { editor: this.editor, session: activeSession, shorthand: next })) ?? [];
		} else if (Array.isArray(next.definition.items)) {
			items = next.definition.items;
		}
		if (this.active !== next) return next;
		this.active.items = items;
		shorthandEvent(this.editor, "ShorthandChange", {
			...next,
			items,
			session: activeSession,
		});
		return next;
	}

	commit(shorthand = this.active, options = {}) {
		if (!this.editor || !shorthand?.definition) return false;
		const { definition, start, end, query, trigger } = shorthand;
		const session = options.session ?? this.editor.activeSession();
		const value = typeof definition.create === "function"
			? definition.create(shorthand.item ?? shorthand, { editor: this.editor, session })
			: shorthand.item ?? { id: query, label: query };
		const label = typeof definition.label === "function"
			? definition.label(value, shorthand)
			: definition.label ?? value.label ?? value.name ?? query;
		const atom = document.createElement(definition.element);
		atom.className = definition.className;
		atom.dataset.shorthand = definition.id;
		if (value && typeof value === "object") {
			if (value.id != null) atom.dataset.id = String(value.id);
			if (value.value != null) atom.dataset.value = String(value.value);
		}
		atom.textContent = `${trigger}${label}`;
		this.editor.history.run("shorthand", () => {
			this.editor.text.refresh();
			const range = document.createRange();
			const from = this.editor.text.pointAt(start);
			const to = this.editor.text.pointAt(end);
			if (!from?.node || !to?.node) return;
			range.setStart(from.node, from.offset);
			range.setEnd(to.node, to.offset);
			range.deleteContents();
			range.insertNode(atom);
			range.detach?.();
			this.editor.text.refresh();
			session.cursor.moveAfterNode(atom);
		});
		const detail = { ...shorthand, value, label, element: atom, session };
		this.active = null;
		shorthandEvent(this.editor, "ShorthandCommit", detail);
		shorthandEvent(this.editor, "DocumentChange", { kind: "shorthand-commit", ...detail });
		return true;
	}

	// Method: pick
	// Commits an item selected by an application-owned popup.
	pick(item, shorthand = this.active, session = null) {
		if (!shorthand) return false;
		return this.commit({ ...shorthand, item }, { session });
	}

	dismiss(reason = "dismiss") {
		if (!this.editor || !this.active) return false;
		const detail = { ...this.active, reason };
		this.active = null;
		shorthandEvent(this.editor, "ShorthandDismiss", detail);
		return true;
	}

	_onCursorMove(event) {
		if (!this.active) {
			queueMicrotask(() => this.update(event.detail?.session ?? null));
			return;
		}
		const offset = event.detail.current?.offset;
		if (offset == null || offset < this.active.start || offset > this.active.end) this.dismiss("cursor-move");
	}
}

export { Shorthands, normalizeDefinition };
export default Shorthands;
