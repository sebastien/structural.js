// Project: structural.js
// Configurable inline shorthands such as #tags, @mentions, +tasks, and dates.

const QUERY_BODY = "[^\\s#@+!.,;:!?)]*";
const TRAILING_DELIM = "[.,;:!?)]*";
const DELIMITER_KEY = /^[\s.,;:!?)]$/u;
const TOKEN_AFTER = /[\s.,;:!?)]|$/;
const DEFAULT_QUERY_PATTERN = /^[^\s#@+!.,;:!?)]*$/u;

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shorthandEvent(editor, type, detail) {
	editor.root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
}

function patternBody(pattern) {
	if (!pattern) return null;
	let source = pattern.source;
	if (source.startsWith("^")) source = source.slice(1);
	if (source.endsWith("$")) source = source.slice(0, -1);
	return source || null;
}

function itemLabel(item) {
	if (item == null) return "";
	if (typeof item === "string") return item;
	return String(item.label ?? item.name ?? item.id ?? "");
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
		queryPattern: definition.queryPattern ?? DEFAULT_QUERY_PATTERN,
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
		queryPattern: definition.queryPattern ?? DEFAULT_QUERY_PATTERN,
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
		this.hydrate();
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

	_matches(definition, query, context, automatic = false) {
		if (automatic && !definition.auto) return false;
		if (definition.pattern && !definition.pattern.test(query)) return false;
		if (definition.queryPattern && !definition.queryPattern.test(query)) return false;
		return definition.match ? definition.match(query, context) !== false : true;
	}

	_definitionFor(trigger, query, context, automatic = false) {
		return this.definitions.find((definition) => {
			if (definition.trigger !== trigger) return false;
			return this._matches(definition, query, context, automatic);
		}) ?? null;
	}

	_sourceItemsSync(definition, query) {
		if (typeof definition.source === "function") {
			const result = definition.source(query, { editor: this.editor });
			if (result != null && typeof result.then === "function") return null;
			return Array.isArray(result) ? result : [];
		}
		return Array.isArray(definition.items) ? definition.items : [];
	}

	_exactItem(definition, query) {
		const items = this._sourceItemsSync(definition, query);
		if (!items) return null;
		const needle = String(query);
		return items.find((item) => itemLabel(item) === needle) ?? null;
	}

	_betterQuery(candidate, found) {
		if (!found) return true;
		if (candidate.start > found.start) return true;
		if (candidate.start < found.start) return false;
		return Boolean(candidate.definition.pattern) && !found.definition.pattern;
	}

	_queryAt(context) {
		const caret = context.offset;
		const text = this.editor.text.textBetween(Math.max(0, caret - 160), caret);
		let found = null;
		for (const definition of this.definitions) {
			const re = new RegExp(`(?:^|\\s)(${escapeRegExp(definition.trigger)})(${QUERY_BODY})(${TRAILING_DELIM})$`, "u");
			const match = re.exec(text);
			if (!match) continue;
			const query = match[2];
			const trailing = match[3] ?? "";
			if (!query && trailing) continue;
			if (!this._matches(definition, query, context)) continue;
			const triggerIndex = match.index + match[0].indexOf(match[1]);
			const before = text.slice(0, triggerIndex);
			if (typeof definition.boundary === "function") {
				if (!definition.boundary(before, context)) continue;
			} else if (definition.boundary instanceof RegExp) {
				definition.boundary.lastIndex = 0;
				if (!definition.boundary.test(before)) continue;
			}
			const prefixLength = match[0].length - match[1].length - query.length - trailing.length;
			const start = caret - match[0].length + prefixLength;
			const end = start + match[1].length + query.length;
			const candidate = {
				definition,
				trigger: match[1],
				query,
				start,
				end,
				limit: caret,
			};
			if (this._betterQuery(candidate, found)) found = candidate;
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
		const delimiter = typeof event.key === "string" && DELIMITER_KEY.test(event.key);
		if (current && delimiter) {
			const automatic = this._definitionFor(current.trigger, current.query, context, true);
			const exact = automatic ? null : this._exactItem(current.definition, current.query);
			if (automatic) {
				this.commit({ ...current, definition: automatic }, { session, delimiter: event.key });
				session.cursor.insertText(event.key);
				return true;
			}
			if (exact) {
				this.commit({ ...current, item: exact }, { session, delimiter: event.key });
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

	// Method: hydrate
	// Commits exact catalog/pattern tokens already present in the document.
	hydrate() {
		if (!this.editor) return this;
		let guard = 0;
		while (guard++ < 100 && this._hydrateOnce()) {}
		return this;
	}

	_hydrateOnce() {
		const found = this._findHydrateMatch();
		if (!found) return false;
		return this.commit(found);
	}

	_findHydrateMatch() {
		let best = null;
		for (const p of this.editor.text.iwalk(this.editor.root, { mode: "text" })) {
			if (p.node?.nodeType !== Node.TEXT_NODE) continue;
			for (const candidate of this._candidatesInText(p.node.data)) {
				const start = this.editor.text.indexOfPoint({ node: p.node, offset: candidate.from });
				const end = this.editor.text.indexOfPoint({ node: p.node, offset: candidate.to });
				if (start < 0 || end < 0) continue;
				if (!best || start > best.start) {
					best = {
						definition: candidate.definition,
						trigger: candidate.trigger,
						query: candidate.query,
						start,
						end,
						item: candidate.item,
					};
				}
			}
		}
		return best;
	}

	_candidatesInText(data) {
		const out = [];
		for (const definition of this.definitions) {
			const items = this._sourceItemsSync(definition, "") ?? [];
			const labels = items
				.map((item) => ({ item, label: itemLabel(item) }))
				.filter((entry) => entry.label)
				.sort((a, b) => b.label.length - a.label.length);
			for (const { item, label } of labels) {
				const re = new RegExp(`(?:^|\\s)(${escapeRegExp(definition.trigger)})(${escapeRegExp(label)})(?=${TOKEN_AFTER.source})`, "gu");
				let match = re.exec(data);
				while (match) {
					const trigger = match[1];
					const query = match[2];
					const from = match.index + match[0].indexOf(trigger);
					out.push({
						definition,
						trigger,
						query,
						from,
						to: from + trigger.length + query.length,
						item,
					});
					match = re.exec(data);
				}
			}
			const body = patternBody(definition.pattern);
			if (!body) continue;
			const re = new RegExp(`(?:^|\\s)(${escapeRegExp(definition.trigger)})(${body})(?=${TOKEN_AFTER.source})`, "gu");
			let match = re.exec(data);
			while (match) {
				const trigger = match[1];
				const query = match[2];
				const from = match.index + match[0].indexOf(trigger);
				out.push({
					definition,
					trigger,
					query,
					from,
					to: from + trigger.length + query.length,
					item: { id: query, label: query },
				});
				match = re.exec(data);
			}
		}
		return out;
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
		const limit = this.active.limit ?? this.active.end;
		if (offset == null || offset < this.active.start || offset > limit) this.dismiss("cursor-move");
	}
}

export { Shorthands, normalizeDefinition };
export default Shorthands;
