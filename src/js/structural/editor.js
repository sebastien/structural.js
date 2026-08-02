// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: editor
// Implements core editor orchestration and action dispatch.
// Sessions, schema, history, input, and keymap live in sibling modules.

import { Cursor as EditorCursor } from "./cursor.js";
import {
	asElement,
	blockSelectorFromSchema,
	firstTextNode as domFirstTextNode,
	lastTextNode as domLastTextNode,
} from "./dom.js";
import { EditorHistory } from "./history.js";
import { EditorTextInput } from "./input.js";
import { editorKeymap, HISTORY_SKIP } from "./keymap.js";
import { EditorRangeController } from "./range.js";
import { matchInputRuleKey, matchInputRuleWhen } from "./rules.js";
import {
	EditorCommand,
	EditorNormalizer,
	EditorSchema,
	EditorTransaction,
} from "./schema.js";
import { EditorSelectionController } from "./selection.js";
import { EditorClassController, EditorSession } from "./session.js";
import { TextAdapter } from "./text.js";

// Class: Editor
// Orchestrates editor state, schema normalizations, keymaps, and action dispatches.
// - root: HTMLElement - container editor element
class Editor {
	// Method: constructor
	// Initializes and configures the parent Editor environment.
	constructor(node, options = {}) {
		this.root = node;
		this.schema =
			options.schema instanceof EditorSchema
				? options.schema
				: new EditorSchema(options.schema ?? {});
		this.normalizer = options.normalizer ?? new EditorNormalizer(this.schema);
		// Custom maps override individual defaults without disabling unrelated editor keys.
		this.keymap = editorKeymap(options.keymap ?? {});
		this.actions = new Map();
		// Contextual input rules matched before the keymap (see handleInputEvent / onKeyDown).
		this.inputRules = [];
		if (Array.isArray(options.inputRules)) this.addInputRules(options.inputRules);
		this.history = new EditorHistory(this, options.history);
		this.sessions = new Map();
		this.plugins = [];
		this._active = false;
		this._currentBlock = null;
		// Optional app/plugin hook: (session) => partial context merged into contextAt().
		this._contextAt = typeof options.contextAt === "function" ? options.contextAt : null;
		// Optional scope provider (e.g. Blocks): { scopeNodes, applyScopeSelection, collapseScopeSelection }.
		this.scopeProvider = options.scopeProvider ?? null;
		this.text = new TextAdapter(node, options.text).attach();
		this.text._schema = this.schema;
		const topC = options.caret !== undefined ? options.caret : options.cursor?.caret;
		const topS = options.selection !== undefined ? options.selection : options.cursor?.selection;
		const wantTopNative =
			topC === "native" ||
			(topC && topC.mode === "native") ||
			topS === "native" ||
			(topS && topS.mode === "native");
		const sessionOpts = {
			actor: "local",
			nativeSelection: options.nativeSelection ?? (wantTopNative ? "sync" : "none"),
			classes: options.classes,
			cursor: options.cursor,
		};
		const topCaret = options.caret !== undefined ? options.caret : options.cursor?.caret;
		if (topCaret !== undefined) {
			let c = topCaret;
			if (typeof c === "string") c = { mode: c };
			if (c && typeof c === "object" && c.mode !== "native" && c.focused == null) {
				c = { ...c, focused: true };
			}
			sessionOpts.caret = c;
		}
		const topSel = options.selection !== undefined ? options.selection : options.cursor?.selection;
		if (topSel !== undefined) {
			sessionOpts.selection = topSel;
		}
		this.localSession = this.session("local", sessionOpts);
		this.range = new EditorRangeController(this);
		this.selection = new EditorSelectionController(this);
		this.input = new EditorTextInput(this, { ...options, session: this.localSession });
		this.configureActions({
			moveCursor: (command, { session }) => {
				const cursor = session.cursor;
				const extend = command.args.extend === true;
				switch (command.args.direction) {
					case "left":
						if (command.args.word) cursor.wordLeft(extend);
						else cursor.left(extend);
						break;
					case "right":
						if (command.args.word) cursor.wordRight(extend);
						else cursor.right(extend);
						break;
					case "up":
						cursor.up(extend);
						break;
					case "down":
						cursor.down(extend);
						break;
					default:
						return false;
				}
				return true;
			},
			selectAll: (_command, { session }) => {
				const end = this.text.clampIndex(0x7fffffff);
				return session.cursor.select(0, end);
			},
			selectStructuralScope: (command, { session }) =>
				this.selectStructuralScope(command.args.mode, session),
			moveStructural: (command, { session }) =>
				this.moveStructural(command.args.direction, command.args.extend === true, session),
			moveTraversal: (command, { session }) => this.moveTraversal(command.args.direction, session),
			collapseSelection: (_command, { session }) => {
				const cursor = session.cursor;
				cursor.moveTo(cursor.selection.isActive ? cursor.selection.focusOffset : cursor.offset);
				return true;
			},
			deleteBackward: (_command, { session }) => {
				session.cursor.backspace();
				return true;
			},
			deleteForward: (_command, { session }) => {
				session.cursor.delete();
				return true;
			},
			undo: () => this.undo(),
			redo: () => this.redo(),
		});
		this.installPlugins(options.plugins ?? []);
		this.classes = this.localSession.classes;
		// Do not force an initial cursor position here; callers (or first interaction)
		// should place the caret at a valid/visible slot. A previous moveTo(8) was a
		// debug leftover that caused bad initial state on small/empty documents.
	}

	// Method: blockSelector
	// CSS selector for navigable/editable blocks (schema-driven; plugins may override).
	blockSelector() {
		return blockSelectorFromSchema(this.schema);
	}

	// Method: blockFor
	// Nearest ancestor block element for `node`, or null if outside the editor.
	blockFor(node) {
		const el = asElement(node);
		const block = el?.closest(this.blockSelector());
		return block && this.root.contains(block) ? block : null;
	}

	// Method: firstTextNode / lastTextNode
	// DOM text-node helpers (shared with plugins; kept on Editor for app convenience).
	firstTextNode(node) {
		return domFirstTextNode(node);
	}

	lastTextNode(node) {
		return domLastTextNode(node);
	}

	// Method: structuralScopeNodes
	// Resolves the nearest declared block (or root child without block rules) and its ancestors.
	structuralScopeNodes(session = null) {
		const active = this.activeSession(session);
		const anchor = active.cursor.anchor;
		let element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		if (!element || !this.root.contains(element)) element = this.root;

		const blockTags = this.schema.tagsOfType("block");
		let scope = null;
		if (blockTags.length) {
			const selector = blockTags.join(", ");
			scope = element.closest(selector);
			if (!scope || !this.root.contains(scope)) scope = null;
		} else {
			while (element !== this.root && element.parentElement && element.parentElement !== this.root)
				element = element.parentElement;
			scope = element === this.root ? this.root : element;
		}
		if (!scope) scope = this.root;

		const scopes = [];
		for (let current = scope; current?.isConnected; current = current.parentElement) {
			scopes.push(current);
			if (current === this.root) break;
		}
		return scopes;
	}

	// Method: scopeNodes
	// Ladder for selectStructuralScope. Delegates to scopeProvider when set.
	scopeNodes(session = null) {
		const active = this.activeSession(session);
		const provider = this.scopeProvider;
		if (provider && typeof provider.scopeNodes === "function") {
			const nodes = provider.scopeNodes(active);
			if (Array.isArray(nodes)) return nodes;
		}
		return this.structuralScopeNodes(active);
	}

	// Method: applyScopeSelection
	// Selects a scope ladder node. Default: text range. Provider may node-select.
	applyScopeSelection(node, session = null, options = {}) {
		const active = this.activeSession(session);
		const provider = this.scopeProvider;
		if (provider && typeof provider.applyScopeSelection === "function") {
			const result = provider.applyScopeSelection(node, active, options);
			if (result !== undefined) return result;
		}
		const range = this.structuralRangeFor(node);
		if (!range || range.end <= range.start) return false;
		this.selection.select(range.start, range.end, active);
		return this.selection.syncToNative(active);
	}

	// Method: collapseScopeSelection
	// Exits the scope ladder to a caret (or provider-specific inner focus).
	collapseScopeSelection(session = null) {
		const active = this.activeSession(session);
		const provider = this.scopeProvider;
		if (provider && typeof provider.collapseScopeSelection === "function") {
			const result = provider.collapseScopeSelection(active);
			if (result !== undefined) return result;
		}
		const cursor = active.cursor;
		cursor.moveTo(cursor.selection?.focusOffset ?? cursor.offset ?? 0);
		return this.selection.syncToNative(active);
	}

	// Method: structuralRangeFor
	// Converts an element's text contents to the editor's logical selection range.
	structuralRangeFor(node) {
		if (!node?.isConnected) return null;
		// Prefer content text nodes. Formatting-only whitespace between blocks is not
		// always present in the position index, so a raw TreeWalker end can miss.
		const acceptContentText = {
			acceptNode: (n) => {
				if (!n?.data || !n.data.replace(/\u200b/g, "").trim()) {
					return NodeFilter.FILTER_REJECT;
				}
				if (this.text.isSkipped?.(n.parentElement) || this.text.isSkipped?.(n)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		};
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, acceptContentText);
		let first = null;
		let last = null;
		while (walker.nextNode()) {
			if (!first) first = walker.currentNode;
			last = walker.currentNode;
		}
		const startPoint = first
			? { node: first, offset: 0 }
			: this.text.pointAtOffsetWithin(node, 0, "forward");
		const endPoint = last
			? { node: last, offset: last.data.length }
			: this.text.pointAtOffsetWithin(
					node,
					Math.max(0, this.text.offsetWithin(node, { node, offset: node.childNodes.length })),
					"backward",
				);
		// indexOfPoint expands the lazy window as needed for far nodes.
		const start = startPoint ? this.text.indexOfPoint(startPoint) : -1;
		const end = endPoint ? this.text.indexOfPoint(endPoint) : -1;
		return start >= 0 && end >= start ? { start, end } : null;
	}

	// Method: structuralScopes
	// Gets selectable structural ranges from innermost scope through the editor root.
	structuralScopes(session = null) {
		const scopes = [];
		for (const node of this.structuralScopeNodes(session)) {
			const range = this.structuralRangeFor(node);
			if (
				range &&
				range.end > range.start &&
				!scopes.some((scope) => scope.start === range.start && scope.end === range.end)
			) {
				scopes.push(range);
			}
		}
		return scopes;
	}

	// Method: selectStructuralScope
	// Expands/contracts along scopeNodes(). First expand selects the innermost
	// scope; further expands walk outward. Contract steps in, then collapses.
	// scopeProvider (e.g. Blocks) supplies the ladder and selection style.
	selectStructuralScope(mode = "expand", session = null) {
		const active = this.activeSession(session);
		const cursor = active.cursor;
		const fresh = this.scopeNodes(active);
		if (!fresh.length) return false;

		const stored = cursor._structuralScopePath?.filter((node) => node?.isConnected);
		const path =
			stored?.length && stored.some((n) => fresh.includes(n)) ? stored : fresh;

		let currentIdx = path.indexOf(cursor._structuralScopeNode);
		if (currentIdx < 0 && cursor.selectedNode) {
			currentIdx = path.indexOf(cursor.selectedNode);
		}

		if (mode === "contract") {
			if (currentIdx <= 0) {
				cursor._structuralScopeNode = null;
				cursor._structuralScopePath = null;
				return this.collapseScopeSelection(active);
			}
			currentIdx -= 1;
		} else {
			// First press: innermost (0). Later presses: step outward.
			currentIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, path.length - 1);
		}

		// Walk until apply succeeds (range unresolvable / node detached).
		for (
			let i = currentIdx;
			mode === "expand" ? i < path.length : i >= 0;
			i += mode === "expand" ? 1 : -1
		) {
			const target = path[i];
			if (!target?.isConnected) continue;
			if (this.applyScopeSelection(target, active, { mode }) !== false) {
				cursor._structuralScopeNode = target;
				cursor._structuralScopePath = path;
				return true;
			}
		}
		// Still handled: swallow browser Ctrl+A even if we cannot grow further.
		return cursor.selectionKind === "range" || cursor.selectionKind === "node";
	}

	// Method: structuralBlocks
	// Returns navigable leaf blocks in document order, falling back to root children.
	structuralBlocks() {
		const tags = this.schema.tagsOfType("block");
		if (!tags.length) {
			const children = [...this.root.children];
			return children.length ? children : [this.root];
		}
		const selector = tags.join(", ");
		const all = [...this.root.querySelectorAll(selector)];
		return all.filter((node) => !node.querySelector(selector));
	}

	// Method: moveStructural
	// Moves to a block boundary; extension retains the active selection anchor.
	moveStructural(direction, extend = false, session = null) {
		const active = this.activeSession(session);
		const blocks = this.structuralBlocks();
		if (!blocks.length) return false;
		const offset = active.cursor.offset ?? 0;
		const scopes = this.structuralScopeNodes(active);
		let index = blocks.findIndex((block) => scopes.includes(block));
		if (index < 0) {
			const containing = blocks.findIndex((block) =>
				block.contains(this.text.pointAt(offset)?.node),
			);
			index = containing >= 0 ? containing : 0;
		}
		const backwards = direction === "left" || direction === "up";
		let range = this.structuralRangeFor(blocks[index]);
		if (!range) return false;
		if (backwards && offset <= range.start && index > 0)
			range = this.structuralRangeFor(blocks[--index]);
		if (!backwards && offset >= range.end && index < blocks.length - 1)
			range = this.structuralRangeFor(blocks[++index]);
		if (!range) return false;
		const target = backwards ? range.start : range.end;
		if (extend) {
			const anchor = active.cursor.selection.isActive
				? active.cursor.selection.anchorOffset
				: offset;
			this.selection.select(anchor, target, active);
		} else {
			active.cursor.moveTo(target);
		}
		return this.selection.syncToNative(active);
	}

	// Method: traversalTargets
	// Lists editable atoms and terminal elements in document traversal order.
	traversalTargets() {
		const targets = [];
		const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_ELEMENT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (this.text.isSkipped(node) || node.contentEditable === "false") continue;
			if (this.text.isAtom(node) || node.children.length === 0) targets.push(node);
		}
		return targets;
	}

	// Method: moveTraversal
	// Selects the next/previous editable atom or moves to a terminal element's edge.
	moveTraversal(direction = "forward", session = null) {
		const active = this.activeSession(session);
		const targets = this.traversalTargets();
		if (!targets.length) return false;
		const backwards = direction === "backward";
		const point = this.text.pointAt(active.cursor.offset ?? 0);
		let element =
			active.cursor.selectedNode ??
			(point?.node?.nodeType === Node.ELEMENT_NODE ? point.node : point?.node?.parentElement);
		if (!element && active.cursor.anchor) {
			element =
				active.cursor.anchor.nodeType === Node.ELEMENT_NODE
					? active.cursor.anchor
					: active.cursor.anchor.parentElement;
		}
		// Robust lookup: walk up from element to find a traversal target, or find a target contained in element.
		let index = -1;
		if (element) {
			let node = element;
			while (node && this.root.contains(node)) {
				const i = targets.indexOf(node);
				if (i >= 0) {
					index = i;
					break;
				}
				node = node.parentElement;
			}
		}
		if (index < 0 && element) {
			for (let i = 0; i < targets.length; i++) {
				if (element.contains(targets[i]) || targets[i].contains(element)) {
					index = i;
					break;
				}
			}
		}
		if (index < 0) {
			index = backwards ? targets.length - 1 : 0;
		} else if (index >= 0) {
			index += backwards ? -1 : 1;
		}
		if (index < 0 || index >= targets.length) {
			index = backwards ? targets.length - 1 : 0;
		}

		const target = targets[index];
		if (this.text.isAtom(target)) {
			active.cursor.selectAtom(target, backwards ? "after" : "before");
		} else {
			// Prefer an explicit position at the target element itself. This ensures
			// we land on a distinct slot even for empty placeholders/slots (structuralRangeFor
			// can return collapsed ranges when there's no text content inside).
			this.text.refresh();
			let pos = this.text.indexOfPoint({ node: target, offset: 0 });
			if (pos < 0 && target.childNodes.length > 0) {
				pos = this.text.indexOfPoint({ node: target, offset: target.childNodes.length });
			}
			const moveOpts = { skipBoundaryCollapse: true };
			if (pos >= 0) {
				active.cursor.moveTo(pos, moveOpts);
			} else {
				const range = this.structuralRangeFor(target);
				if (!range) return false;
				active.cursor.moveTo(backwards ? range.end : range.start, moveOpts);
			}
			// Ensure visual caret is at the target for empty terminals (0-text slots).
			// Force using target's BCR; fall back to a positive height so caret shows
			// even if target has no intrinsic size yet (empty placeholder before styles/content).
			const cr = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
		if (cr && active.cursor?.caret?.node) {
				const c = active.cursor.caret;
				const h = cr.height > 0 ? cr.height : 18;
				const parent = c.node.offsetParent;
				const local = parent
					? {
						x: cr.left - parent.getBoundingClientRect().left + parent.scrollLeft,
						y: cr.top - parent.getBoundingClientRect().top + parent.scrollTop,
					}
					: { x: cr.left + window.scrollX, y: cr.top + window.scrollY };
				c._showAt(local.x, local.y, h);
			}
		}
		return this.selection.syncToNative(active);
	}

	// Method: destroy
	// Tears down sessions, normalizers, input events, and adapters.
	destroy() {
		for (const plugin of this.plugins) plugin.detach?.(this);
		for (const session of this.sessions.values()) session.destroy();
		this.input.unbind();
		this.text.detach();
	}

	// Method: session
	// Creates or retrieves a collaborative or local editing session by `id`.
	session(id = "local", options = {}) {
		if (id instanceof EditorSession) return id;
		if (!this.sessions.has(id)) {
			this.sessions.set(id, new EditorSession(this, id, options));
		}
		return this.sessions.get(id);
	}

	// Method: activeSession
	// Resolves current active or fallback session.
	activeSession(session = null) {
		return this.session(session ?? this.localSession ?? "local");
	}

	// Method: configureActions
	// Registers execution callbacks for command types.
	configureActions(actions = {}) {
		for (const [name, action] of Object.entries(actions)) this.actions.set(name, action);
		return this;
	}

	// Method: addInputRules
	// Appends (or prepends) contextual input rules matched by handleInputEvent.
	addInputRules(rules = [], options = {}) {
		if (!Array.isArray(rules) || !rules.length) return this;
		if (options.prepend) this.inputRules.unshift(...rules);
		else this.inputRules.push(...rules);
		return this;
	}

	// Method: contextAt
	// Builds a cursor/selection context object. Plugins may enrich via enrichContext().
	contextAt(session = null) {
		const active = this.activeSession(session);
		const cursor = active.cursor;
		const anchor = cursor.anchor;
		const selected = cursor.selectionKind === "node" ? cursor.selectedNode : null;
		const point = this.text.pointAt(cursor.offset ?? 0);
		const ctx = {
			session: active,
			cursor,
			offset: cursor.offset ?? 0,
			selectionKind: cursor.selectionKind,
			selected,
			anchor,
			point,
			root: this.root,
		};
		if (typeof this._contextAt === "function") {
			Object.assign(ctx, this._contextAt.call(this, active, ctx) ?? {});
		}
		for (const plugin of this.plugins) {
			plugin.enrichContext?.(ctx, active);
		}
		return ctx;
	}

	// Method: matchInputRule
	// Returns the first input rule matching event + context, or null.
	matchInputRule(event, context = null) {
		if (!event || !this.inputRules?.length) return null;
		const ctx = context ?? this.contextAt();
		for (const rule of this.inputRules) {
			if (!rule || rule.enabled === false) continue;
			if (!matchInputRuleWhen(rule.when, ctx, event)) continue;
			if (!matchInputRuleKey(rule, event)) continue;
			return rule;
		}
		return null;
	}

	// Method: handleInputEvent
	// Runs matching input rules in order. Returns true when a rule claims the event.
	// A handler may return false to decline and let the next matching rule try.
	handleInputEvent(event, session = null) {
		if (!event || !this.inputRules?.length) return false;
		const active = this.activeSession(session);
		const ctx = this.contextAt(active);
		for (const rule of this.inputRules) {
			if (!rule || rule.enabled === false) continue;
			if (!matchInputRuleWhen(rule.when, ctx, event)) continue;
			if (!matchInputRuleKey(rule, event)) continue;

			const args = {
				...(typeof rule.args === "function" ? rule.args(ctx, event) : (rule.args ?? {})),
			};
			if (args.key === undefined) args.key = event.key;
			if (args.event === undefined) args.event = event;
			if (args.context === undefined) args.context = ctx;

			let result;
			if (typeof rule.do === "function") {
				result = rule.do(args, { editor: this, session: active, event, context: ctx, rule });
			} else if (typeof rule.do === "string") {
				result = this.action(
					{ type: rule.do, args: { ...args, ...(rule.actionArgs ?? {}) } },
					{ event, session: active },
				);
			} else if (rule.do && typeof rule.do === "object") {
				const spec = rule.do.type
					? {
							...rule.do,
							args: {
								...(rule.do.args ?? {}),
								...args,
							},
						}
					: rule.do;
				result = this.action(spec, { event, session: active });
			} else {
				continue;
			}
			if (result === false) continue;
			event.preventDefault();
			event.stopPropagation();
			return true;
		}
		return false;
	}

	// Method: installPlugins
	// Installs editor plugins or plugin factories.
	installPlugins(plugins = []) {
		for (const plugin of plugins) this.installPlugin(plugin);
		return this;
	}

	// Method: installPlugin
	// Installs a single editor plugin instance, class, or factory.
	installPlugin(plugin) {
		if (!plugin) return null;
		const instance =
			typeof plugin === "function"
				? plugin.prototype?.attach
					? new plugin()
					: plugin(this)
				: plugin;
		instance?.attach?.(this);
		if (instance) this.plugins.push(instance);
		return instance ?? null;
	}

	// Method: plugin
	// Resolves an installed plugin by constructor, name, or exact instance.
	plugin(type) {
		if (!type) return null;
		for (const plugin of this.plugins) {
			if (plugin === type) return plugin;
			if (typeof type === "string") {
				if (plugin.constructor?.pluginName === type || plugin.constructor?.name === type)
					return plugin;
			} else if (plugin instanceof type) {
				return plugin;
			}
		}
		return null;
	}

	// Method: action
	// Dispatches command and returns success flag.
	action(spec, options = {}) {
		if (!spec) return false;
		return this.dispatch(spec, options).handled;
	}

	// Method: undo
	// Restores the previous document snapshot.
	undo() {
		return this.history.undo();
	}

	// Method: redo
	// Re-applies a previously undone snapshot.
	redo() {
		return this.history.redo();
	}

	// Method: noteEdit
	// Records a before-change history snapshot (used by cursor text ops).
	noteEdit(kind = "edit") {
		this.history.record(kind);
		return this;
	}

	// Method: dispatch
	// Direct execution engine routing commands to registered actions and recording history.
	dispatch(value, options = {}) {
		const session = this.activeSession(options.session);
		if (typeof value === "function") {
			const result = value(this, options.event, session);
			return new EditorTransaction(null, { result });
		}
		const command = session.command(value);
		if (!command?.type) return new EditorTransaction(command, { result: false });
		const fn = this.actions.get(command.type);
		if (!fn) return new EditorTransaction(command, { result: false });
		// Text ops record inside Cursor; deleteSmart records via history.run;
		// undo/redo must not snapshot themselves.
		const skipRecord =
			HISTORY_SKIP.has(command.type) ||
			options.history === false ||
			command.type === "deleteBackward" ||
			command.type === "deleteForward" ||
			command.type === "deleteSmart" ||
			command.type === "cut" ||
			command.type === "paste";
		if (!skipRecord) {
			const kind =
				command.type === "splitBlock" || command.type === "insertLineBreak"
					? "input"
					: command.type;
			this.history.record(kind);
		}
		const selectionBefore = session.snapshotSelection();
		const result = fn(command, { editor: this, session, event: options.event });
		const transaction =
			result instanceof EditorTransaction
				? result
				: new EditorTransaction(command, {
						result,
						selectionBefore,
						selectionAfter: session.snapshotSelection(),
					});
		return transaction;
	}

	// Method: keyCombo
	// Decodes KeyboardEvent details into standard hotkey strings (e.g. Mod+B).
	keyCombo(event) {
		const parts = [];
		if (event.ctrlKey || event.metaKey) parts.push("Mod");
		if (event.altKey) parts.push("Alt");
		if (event.shiftKey) parts.push("Shift");
		let key = event.key === " " ? "Space" : event.key;
		if (key.length === 1 && key !== "`") key = key.toUpperCase();
		parts.push(key);
		return parts.join("+");
	}

	// Method: handleKeyEvent
	// Evaluates keyboard combinations against configured hotkeys.
	// Matched bindings always swallow the event so browser chords (Ctrl+B bookmark,
	// Ctrl+I info panel, …) cannot fire even when the action is a no-op.
	handleKeyEvent(event, session = null) {
		const spec = this.keymap?.[this.keyCombo(event)] ?? this.keymap?.[event.key];
		if (!spec) return false;
		this.action(spec, { event, session });
		event.preventDefault();
		event.stopPropagation();
		return true;
	}

	// Method: normalize
	// Performs incremental DOM sanitizations on designated targets.
	normalize(target = this.root, context = {}) {
		return (
			this.normalizer?.normalize(target, {
				editor: this,
				root: this.root,
				schema: this.schema,
				...context,
			}) ?? new EditorTransaction(new EditorCommand("normalize"), { result: false })
		);
	}

	/* Replaces or commits editor content and resolves after paint. */
	setContent(content = undefined, options = {}) {
		const active = this.activeSession(options.session);
		const range = active.cursor.selection.normalizedRange();
		const selection = options.selection ?? {
			start: range.start ?? active.cursor.offset ?? 0,
			end: range.end ?? active.cursor.offset ?? 0,
		};
		// External content replace resets history; internal refresh keeps it.
		if (content !== undefined && content !== this.root && options.history !== true) {
			this.history.clear();
		}
		if (content !== undefined && content !== this.root) this.root.replaceChildren(content);
		this.lastNormalization = this.normalize(this.root, { session: active });
		this.text.refresh();
		if (selection.node?.isConnected) {
			if (selection.position) this.selection._setEdgeCaret(selection.node, selection.position, active);
			else this.selection.setCaret(selection.node, selection.offset ?? 0, active);
		} else if (typeof selection.start === "number" && typeof selection.end === "number") {
			this.selection.select(this.text.clampIndex(selection.start), this.text.clampIndex(selection.end), active);
		} else {
			this.selection._setEdgeCaret(this.root, "start", active);
		}
		active.classes?.update();
		return new Promise((resolve) => {
			const frame = globalThis.requestAnimationFrame ?? ((callback) => queueMicrotask(callback));
			frame(() => resolve(this.lastNormalization));
		});
	}
}

export {
	Editor,
	EditorTextInput,
	EditorClassController,
	EditorCommand,
	EditorCursor,
	EditorHistory,
	EditorNormalizer,
	EditorRangeController,
	EditorSchema,
	EditorSelectionController,
	EditorSession,
	EditorTransaction,
	editorKeymap,
};

// EOF
