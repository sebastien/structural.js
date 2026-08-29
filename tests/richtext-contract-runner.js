const EDITOR_CLASSES = new Set([
	"focus",
	"selected",
	"focus-within",
	"selected-within",
	"test-caret",
]);

const STRUCTURAL_CLASS = new Set([
	"atom",
	"atomic",
	"container",
	"C",
	"skip",
	"skipped",
	"S",
]);

const EMPTY_BLOCK = new Set(["p", "h1", "h2", "h3", "li", "pre", "blockquote"]);

const MOVE_OPS = ["left", "right", "up", "down", "wordLeft", "wordRight"];

export function createContractApi({ editor, mod, root }) {
	function loadMarked(html) {
		root.innerHTML = html;
		const marks = extractAndStripMarkers(root);
		editor.text.refresh();
		const cur = editor.input.cursor;
		const anchor = indexOfPoint(marks.anchor);
		const head = indexOfPoint(marks.head);
		const caret = indexOfPoint(marks.caret);
		if (anchor != null && head != null && anchor !== head) {
			cur.select(anchor, head);
			return;
		}
		cur.moveTo(caret ?? anchor ?? head ?? 0, { skipBoundaryCollapse: true });
	}

	function extractAndStripMarkers(host) {
		let caret = null;
		let anchor = null;
		let head = null;
		const texts = [];
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) texts.push(node);
		for (const text of texts) {
			const orig = text.data;
			let data = "";
			for (let i = 0; i < orig.length; i += 1) {
				const ch = orig[i];
				if (ch === "|") caret = { node: text, offset: data.length };
				else if (ch === "{") anchor = { node: text, offset: data.length };
				else if (ch === "}") head = { node: text, offset: data.length };
				else data += ch;
			}
			text.data = data;
		}
		const retarget = (point) => {
			if (!point) return null;
			if (point.node.data.length > 0) return point;
			const parent = point.node.parentNode;
			if (!parent) return point;
			const offset = Array.prototype.indexOf.call(parent.childNodes, point.node);
			return { node: parent, offset: Math.max(0, offset), empty: true };
		};
		caret = retarget(caret);
		anchor = retarget(anchor);
		head = retarget(head);
		for (const text of texts) {
			if (text.data.length === 0) text.remove();
		}
		return { caret, anchor, head };
	}

	function indexOfPoint(point) {
		if (!point) return null;
		editor.text.ensurePositions();
		if (point.empty) {
			const positions = editor.text.positions();
			for (let i = 0; i < positions.length; i += 1) {
				const pt = positions[i]?.point;
				if (!pt?.node) continue;
				if (pt.node === point.node || point.node.contains?.(pt.node)) return i;
			}
		}
		const index = editor.text.indexOfPoint({
			node: point.node,
			offset: point.offset,
		});
		return index >= 0 ? index : null;
	}

	function dumpMarked() {
		editor.text.ensurePositions();
		const cur = editor.input.cursor;
		if (cur.selectionKind === "node" && cur.selectedNode) {
			return {
				html: serialize(root, { kind: "node" }),
				selection: {
					kind: "node",
					match: matchFor(root, cur.selectedNode),
				},
			};
		}
		const kind = cur.selectionKind === "range" && !cur.selection?.isCollapsed ? "range" : "caret";
		const caretPt = editor.text.pointAt(cur.offset);
		let anchorPt = caretPt;
		let headPt = caretPt;
		if (kind === "range") {
			anchorPt = editor.text.pointAt(cur.selection.anchorOffset);
			headPt = editor.text.pointAt(cur.selection.focusOffset);
		}
		return {
			html: serialize(root, {
				kind,
				caret: caretPt,
				anchor: anchorPt,
				head: headPt,
			}),
			selection: { kind },
		};
	}

	function apply(op) {
		if (op == null) return;
		if (Array.isArray(op)) {
			for (const item of op) apply(item);
			return;
		}
		const cur = editor.input.cursor;
		if (op.insert != null) {
			insertText(String(op.insert));
			return;
		}
		if (op.backspace != null) {
			repeat(count(op.backspace), () => press("Backspace"));
			return;
		}
		if (op.delete != null) {
			repeat(count(op.delete), () => press("Delete"));
			return;
		}
		if (op.enter) {
			press("Enter");
			return;
		}
		if (op.shiftEnter) {
			press("Shift+Enter");
			return;
		}
		if (op.tab) {
			press("Tab");
			return;
		}
		if (op.shiftTab) {
			press("Shift+Tab");
			return;
		}
		if (op.toggleInline) {
			mod.toggleInline(op.toggleInline);
			return;
		}
		if (op.toggleBlock) {
			mod.toggleBlock(op.toggleBlock);
			return;
		}
		if (op.key) {
			press(op.key);
			return;
		}
		for (const name of MOVE_OPS) {
			if (op[name] == null) continue;
			repeat(count(op[name]), () => cur[name](!!op.extend));
			return;
		}
	}

	function insertText(text) {
		const rt = editor.richText;
		rt?.removePlaceholderInCurrentBlock?.();
		if (text === " " && rt?.shouldInsertText?.(" ") === false) {
			const cur = editor.input.cursor;
			if (cur.selectionKind === "caret") {
				const ctx = cur.getContext?.();
				if (/\s/.test(ctx?.char?.after ?? "")) cur.right();
			}
			return;
		}
		editor.input.cursor.insertText(text);
	}

	function press(combo) {
		const parts = String(combo).split("+");
		const keyName = parts.pop();
		const key =
			keyName === "Space"
				? " "
				: keyName.length === 1
					? keyName.toLowerCase()
					: keyName;
		const event = new KeyboardEvent("keydown", {
			key,
			ctrlKey: parts.includes("Mod"),
			metaKey: false,
			shiftKey: parts.includes("Shift"),
			altKey: parts.includes("Alt"),
			cancelable: true,
			bubbles: true,
		});
		editor.handleKeyEvent(event);
	}

	function runOne(c) {
		try {
			loadMarked(c.from);
			apply(c.do ?? []);
			editor.text.ensurePositions();
			const dumped = dumpMarked();
			const cur = editor.input.cursor;
			return compare(c, dumped, cur.selectedNode);
		} catch (err) {
			return {
				name: c.name,
				actual: `error: ${err?.message ?? err}`,
				expected: formatExpected(c),
			};
		}
	}

	function compare(c, dumped, selectedNode) {
		const expected = formatExpected(c);
		if (c.selection?.kind === "node") {
			const node = root.querySelector(c.selection.match);
			const nodeOk =
				dumped.selection?.kind === "node" &&
				selectedNode != null &&
				node != null &&
				selectedNode === node;
			const actual = nodeOk
				? `${dumped.html}\n@node:${c.selection.match}`
				: `${dumped.html}\n@node:${dumped.selection?.match ?? "none"}`;
			return { name: c.name, actual, expected };
		}
		return { name: c.name, actual: dumped.html, expected };
	}

	function formatExpected(c) {
		if (c.selection?.kind === "node") return `${c.to}\n@node:${c.selection.match}`;
		return c.to;
	}

	return { loadMarked, dumpMarked, apply, runOne };
}

function count(value) {
	if (value === true) return 1;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

function repeat(n, fn) {
	for (let i = 0; i < n; i += 1) fn();
}

function matchFor(root, node) {
	if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
	const tag = node.tagName.toLowerCase();
	const cls = [...node.classList].find((name) => STRUCTURAL_CLASS.has(name));
	const selector = cls ? `${tag}.${cls}` : tag;
	const matches = [...root.querySelectorAll(selector)];
	if (matches.length === 1 && matches[0] === node) return selector;
	return cssPath(root, node);
}

function cssPath(root, node) {
	const parts = [];
	let current = node;
	while (current && current !== root && current.nodeType === Node.ELEMENT_NODE) {
		const tag = current.tagName.toLowerCase();
		const parent = current.parentNode;
		const same = [...parent.children].filter((el) => el.tagName === current.tagName);
		const index = same.indexOf(current) + 1;
		parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
		current = parent;
	}
	return parts.join(">");
}

function isEmptyBlock(el) {
	if (!EMPTY_BLOCK.has(el.tagName.toLowerCase())) return false;
	for (const child of el.childNodes) {
		if (child.nodeType === Node.TEXT_NODE && child.data.length > 0) return false;
		if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== "BR") return false;
	}
	return true;
}

function pointAt(ctx, node, offset) {
	if (!ctx || ctx.kind === "node") return "";
	const hit = (point) => point && point.node === node && point.offset === offset;
	if (ctx.kind === "caret") return hit(ctx.caret) ? "|" : "";
	const isAnchor = hit(ctx.anchor);
	const isHead = hit(ctx.head);
	if (isAnchor && isHead) return "|";
	let mark = "";
	if (isAnchor) mark += "{";
	if (isHead) mark += "}";
	return mark;
}

function pointIn(el, point) {
	if (!point?.node) return false;
	if (point.node === el) return true;
	return !!el.contains?.(point.node);
}

function emptyMark(el, ctx) {
	if (!ctx || ctx.kind === "node") return "";
	if (ctx.kind === "caret") return pointIn(el, ctx.caret) ? "|" : "";
	const a = pointIn(el, ctx.anchor);
	const h = pointIn(el, ctx.head);
	if (a && h) return "|";
	let mark = "";
	if (a) mark += "{";
	if (h) mark += "}";
	return mark;
}

function attrs(el) {
	let out = "";
	const classes = [...el.classList].filter((name) => !EDITOR_CLASSES.has(name));
	if (classes.length) out += ` class="${classes.join(" ")}"`;
	if (el.tagName === "A") {
		const href = el.getAttribute("href");
		if (href) out += ` href="${href}"`;
	}
	return out;
}

function escapeText(ch) {
	if (ch === "&") return "&amp;";
	if (ch === "<") return "&lt;";
	if (ch === ">") return "&gt;";
	return ch;
}

function serializeText(node, ctx) {
	const data = node.data;
	let out = "";
	for (let i = 0; i <= data.length; i += 1) {
		out += pointAt(ctx, node, i);
		if (i < data.length) out += escapeText(data[i]);
	}
	return out;
}

function serializeElement(el, ctx) {
	const tag = el.tagName.toLowerCase();
	if (tag === "br") return `${pointAt(ctx, el, 0)}<br>${pointAt(ctx, el, 1)}`;
	if (isEmptyBlock(el)) return `<${tag}${attrs(el)}>${emptyMark(el, ctx)}</${tag}>`;
	let inner = pointAt(ctx, el, 0);
	let i = 0;
	for (const child of el.childNodes) {
		inner += serializeNode(child, ctx);
		i += 1;
		inner += pointAt(ctx, el, i);
	}
	return `<${tag}${attrs(el)}>${inner}</${tag}>`;
}

function serializeNode(node, ctx) {
	if (node.nodeType === Node.TEXT_NODE) return serializeText(node, ctx);
	if (node.nodeType === Node.ELEMENT_NODE) return serializeElement(node, ctx);
	return "";
}

function serialize(root, ctx) {
	let out = "";
	for (const child of root.childNodes) out += serializeNode(child, ctx);
	return out;
}
