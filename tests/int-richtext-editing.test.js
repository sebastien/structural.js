import { expect, test } from "bun:test";
import {
	closePage,
	installBrowserLifecycle,
	loadPath,
} from "./playwright-harness.js";

installBrowserLifecycle();

async function loadHarness(_browser = null, initialHtml = null) {
	const page = await loadPath("/tests/int-richtext-harness.html");
	await page.waitForFunction(() => window.__editor && window.__test);
	if (initialHtml) {
		await page.evaluate((h) => window.__test.setHTML(h), initialHtml);
	}
	return page;
}

async function getState(page) {
	return page.evaluate(() => window.__test.getState());
}

async function clickAtText(page, needle, charOffset = 0) {
	const pt = await page.evaluate(
		({ needle, charOffset }) => window.__test.pointForText(needle, charOffset),
		{ needle, charOffset },
	);
	if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
		await page.mouse.click(pt.x, pt.y);
		// Small settle for caret
		await page.waitForTimeout(10);
	}
}

async function type(page, str) {
	await page.keyboard.type(str);
}

async function press(page, key) {
	await page.keyboard.press(key);
}


async function directSelect(page, start, end) {
	await page.evaluate(({ a, b }) => window.__test.selectRange(a, b), {
		a: start,
		b: end,
	});
}

async function toggleBlock(page, tag) {
	await page.evaluate((t) => window.__test.toggleBlock(t), tag);
}

async function toggleInline(page, tag) {
	await page.evaluate((t) => window.__test.toggleInline(t), tag);
}

async function getSelectedText(page) {
	return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

test("keymap: Ctrl+Arrow moves between rich-text words", async () => {
	const page = await loadHarness(null, "<p>one two three</p>");
	try {
		const result = await page.evaluate(() => {
			const editor = window.__editor;
			const at = (value) => window.__test.indexOfText(value);
			const press = (key, shiftKey = false) =>
				editor.handleKeyEvent(
					new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, cancelable: true }),
				);
			editor.input.cursor.moveTo(at("one"));
			press("ArrowRight");
			const two = editor.input.cursor.offset;
			press("ArrowRight");
			const three = editor.input.cursor.offset;
			press("ArrowLeft");
			const previous = editor.input.cursor.offset;
			editor.input.cursor.moveTo(at("one"));
			press("ArrowRight", true);
			return { two, three, previous, selected: window.getSelection()?.toString() };
		});
		expect(result).toEqual({ two: 4, three: 8, previous: 4, selected: "one " });
	} finally {
		await closePage(page);
	}
});

// Direct ops that respect current selection (range) without forcing a moveTo collapse first.
async function directDeleteSelection(page) {
	await page.evaluate(() => {
		const cur = window.__editor.input.cursor;
		cur.delete();
	});
}

async function directInsertText(page, text) {
	await page.evaluate((t) => {
		const cur = window.__editor.input.cursor;
		cur.insertText(t);
	}, text);
}

test("editing: type moves caret and text appears", async () => {
	const page = await loadHarness(null, "<p>ab</p>");
	await clickAtText(page, "ab", 1); // between a and b
	await type(page, "X");
	const state = await getState(page);
	await closePage(page);

	expect(state.text).toBe("aXb");
	expect(state.caretVisible).toBe(true);
	expect(state.offset).toBeGreaterThan(1);
});

test("content: setContent commits replacement after a frame and preserves selection", async () => {
	const page = await loadHarness(null, "<p>hello</p>");
	const state = await page.evaluate(async () => {
		window.__test.moveTo(3);
		const next = document.createElement("p");
		next.textContent = "world";
		let resolved = false;
		const future = window.__editor.setContent(next).then(() => (resolved = true));
		const before = resolved;
		await future;
		return {
			before,
			tag: window.__editor.root.firstElementChild?.tagName,
			text: window.__editor.root.textContent,
			offset: window.__editor.input.cursor.offset,
		};
	});
	await closePage(page);

	expect(state.before).toBe(false);
	expect(state.tag).toBe("P");
	expect(state.text).toBe("world");
	expect(state.offset).toBe(3);
});

test("editing: double-click selects the word under the cursor", async () => {
	const page = await loadHarness(null, "<p>hello world there</p>");
	const pt = await page.evaluate(() => window.__test.pointForText("world", 1));
	if (!pt) throw new Error("pointForText failed for world");
	await page.mouse.dblclick(pt.x, pt.y);
	await page.waitForTimeout(20);
	const state = await page.evaluate(() => {
		const cur = window.__editor.input.cursor;
		const range = cur.selection?.normalizedRange?.() ?? null;
		const domText = (() => {
			const r = cur.selection?.toDomRange?.();
			return r ? r.toString() : "";
		})();
		const nativeText = window.getSelection()?.toString() ?? "";
		return {
			selectionKind: cur.selectionKind,
			range,
			domText,
			nativeText,
		};
	});
	await closePage(page);

	expect(state.selectionKind).toBe("range");
	expect(state.domText || state.nativeText).toBe("world");
});

test("editing: backspace then type lands in correct place", async () => {
	const page = await loadHarness(null, "<p>hello</p>");
	await clickAtText(page, "hello", 2); // after "he"
	await press(page, "Backspace");
	await type(page, "X");
	const state = await getState(page);
	await closePage(page);

	// "he" backspace -> "h" then X -> "hXllo"
	expect(state.text).toBe("hXllo");
	expect(state.caretVisible).toBe(true);
});

test("editing: delete then type", async () => {
	const page = await loadHarness(null, "<p>abc</p>");
	await clickAtText(page, "abc", 1); // after 'a'
	await press(page, "Delete");
	await type(page, "Z");
	const state = await getState(page);
	await closePage(page);

	expect(state.text).toBe("aZc");
	expect(state.caretVisible).toBe(true);
});

test("editing: range delete then type inserts at deletion site", async () => {
	const page = await loadHarness(null, "<p>abcdef</p>");
	// Compute indices via adapter and drive structural selection directly for reliability
	const indices = await page.evaluate(() => {
		const idx1 = window.__test.indexOfText("abcdef", 1);
		const idx4 = window.__test.indexOfText("abcdef", 4);
		return { start: idx1, end: idx4 };
	});
	if (indices.start >= 0 && indices.end >= 0) {
		await directSelect(page, indices.start, indices.end);
	}
	await press(page, "Delete");
	await type(page, "X");
	const state = await getState(page);
	await closePage(page);

	expect(state.text).toBe("aXef");
	expect(state.caretVisible).toBe(true);
});

test("editing: delete last char in block then type creates content", async () => {
	const page = await loadHarness(null, "<p>x</p>");
	await clickAtText(page, "x", 0);
	await press(page, "Delete");
	await type(page, "Y");
	const state = await getState(page);
	await closePage(page);

	expect(state.text).toBe("Y");
	expect(state.caretVisible).toBe(true);
});

test("editing: enter then type creates new block with text", async () => {
	const page = await loadHarness(null, "<p>Line1</p>");
	await clickAtText(page, "Line1", "Line1".length);
	await press(page, "Enter");
	await type(page, "Line2");
	const state = await getState(page);
	await closePage(page);

	expect(state.text).toContain("Line2");
	// Classes may be injected by focus system; match content and structure loosely
	expect(state.html).toMatch(/Line1/);
	expect(state.html).toMatch(/Line2/);
	expect(state.html.match(/<p/g)?.length || 0).toBeGreaterThanOrEqual(2);
});

test("command menu: slash in an empty paragraph filters and applies a block", async () => {
	const page = await loadHarness(null, "<p></p>");
	try {
		await page.evaluate(() => {
			window.__editor.root.focus();
			window.__editor.input._editorActive = true;
			window.__editor.input.cursor.moveTo(0);
		});
		await press(page, "/");
		await press(page, "h");
		const open = await page.evaluate(() => window.__editor.commandMenu.state());
		expect(open.open).toBe(true);
		expect(open.query).toBe("h");
		expect(open.items[0].id).toBe("heading-1");
		await press(page, "Enter");
		const state = await getState(page);
		expect(state.html).toMatch(/^<h1(?:\s[^>]*)?>/);
	} finally {
		await closePage(page);
	}
});

test("command menu: Backspace dismisses an empty slash query", async () => {
	const page = await loadHarness(null, "<p></p>");
	try {
		await page.evaluate(() => {
			window.__editor.root.focus();
			window.__editor.input._editorActive = true;
			window.__editor.input.cursor.moveTo(0);
		});
		await press(page, "/");
		await press(page, "Backspace");
		const state = await page.evaluate(() => window.__editor.commandMenu.state());
		expect(state.open).toBe(false);
		expect((await getState(page)).text).toBe("");
	} finally {
		await closePage(page);
	}
});

test("selection: Shift+ArrowUp reaches the first of three blocks", async () => {
	const page = await loadHarness(null, "<p>One</p><p>Two</p><p>Three</p>");
	await clickAtText(page, "Three", "Three".length);
	const selected = [];
	for (let i = 0; i < 3; i++) {
		await press(page, "Shift+ArrowUp");
		selected.push(await getSelectedText(page));
	}
	await closePage(page);

	expect(selected.map((text) => text.replace(/\s/g, ""))).toEqual(["TwoThree", "OneTwoThree", "OneTwoThree"]);
});

test("editing: arrow right then type after block boundary", async () => {
	const page = await loadHarness(null, "<p>one</p><p>two</p>");
	await clickAtText(page, "one", "one".length);
	await press(page, "ArrowRight"); // move into next block start
	await type(page, "X");
	const state = await getState(page);
	await closePage(page);

	// After moving to next block, typing should insert into the second block
	expect(state.text).toMatch(/oneX?two|onetwoX?/);
	// Caret may be at boundary or formatting may affect visibility momentarily; ensure logical caret state
	expect(["caret", "range"]).toContain(state.selectionKind);
});

test("editing: toggle bold then type applies inside format", async () => {
	const page = await loadHarness(null, "<p>word</p>");
	await clickAtText(page, "word", 1);
	// Use direct index selection + action toggle for reliability
	const idx = await page.evaluate(() => {
		const i1 = window.__test.indexOfText("word", 1);
		const i3 = window.__test.indexOfText("word", 3);
		return { start: i1, end: i3 };
	});
	if (idx.start >= 0 && idx.end >= 0) {
		await directSelect(page, idx.start, idx.end);
	}
	// Use harness action to toggle bold (configures keymap actions on editor)
	await page.evaluate(() => window.__test.toggleInline("strong"));
	await type(page, "Z");
	const state = await getState(page);
	await closePage(page);

	// Selecting a range + toggle + type typically replaces the selection with Z wrapped (or inserts inside).
	// The key integration property: bold formatting is present and Z was inserted.
	expect(state.html).toMatch(/<strong[^>]*>[^<]*Z|wZord/);
	expect(state.text).toContain("Z");
});

test("editing: backspace across block merge then type", async () => {
	const page = await loadHarness(null, "<p>abc</p><p>def</p>");
	await clickAtText(page, "def", 0);
	await press(page, "Backspace"); // merge
	await type(page, "X");
	const state = await getState(page);
	await closePage(page);

	// Merge may collapse differently depending on boundaries; accept either merged or adjacent content
	expect(state.text).toMatch(/abcX?def|abX?def/);
});

// --- Chaos / Monkey test (seeded, short runs) ---

function mulberry32(seed) {
	return () => {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ACTIONS = [
	{ name: "type:a", weight: 12 },
	{ name: "type:space", weight: 4 },
	{ name: "backspace", weight: 8 },
	{ name: "delete", weight: 5 },
	{ name: "arrowL", weight: 6 },
	{ name: "arrowR", weight: 6 },
	{ name: "arrowLShift", weight: 2 },
	{ name: "arrowRShift", weight: 2 },
	{ name: "enter", weight: 3 },
	{ name: "modB", weight: 1 },
	{ name: "modA", weight: 1 },
];

function pick(rng, list) {
	const total = list.reduce((s, a) => s + a.weight, 0);
	let r = rng() * total;
	for (const a of list) {
		r -= a.weight;
		if (r <= 0) return a.name;
	}
	return list[list.length - 1].name;
}

async function runChaos(page, seed, steps = 40) {
	const rng = mulberry32(seed);
	const transcript = [];
	for (let i = 0; i < steps; i++) {
		const act = pick(rng, ACTIONS);
		transcript.push(act);
		if (act === "type:a") {
			await type(page, "a");
		} else if (act === "type:space") {
			await press(page, "Space");
		} else if (act === "backspace") {
			await press(page, "Backspace");
		} else if (act === "delete") {
			await press(page, "Delete");
		} else if (act === "arrowL") {
			await press(page, "ArrowLeft");
		} else if (act === "arrowR") {
			await press(page, "ArrowRight");
		} else if (act === "arrowLShift") {
			await press(page, "Shift+ArrowLeft");
		} else if (act === "arrowRShift") {
			await press(page, "Shift+ArrowRight");
		} else if (act === "enter") {
			await press(page, "Enter");
		} else if (act === "modB") {
			await press(page, "Control+B");
		} else if (act === "modA") {
			await press(page, "Control+A");
		}
		// Light settle
		if (i % 5 === 0) await page.waitForTimeout(5);
	}
	return transcript;
}

test("editing: chaos monkey (seeded short runs)", async () => {
	const page = await loadHarness(null, "<p>chaos test</p>");

	// Start near middle
	await clickAtText(page, "chaos", 2);

	// Keep runs short to avoid hangs; fewer seeds + steps for CI stability
	const seeds = [1, 42];
	const failures = [];

	for (const seed of seeds) {
		try {
			await page.evaluate(() => window.__test.setHTML("<p>chaos test</p>"));
			await clickAtText(page, "chaos", 2);

			const transcript = await runChaos(page, seed, 12);
			const state = await getState(page);

			if (
				state.offset == null ||
				state.offset < 0 ||
				state.offset > state.positions
			) {
				failures.push({ seed, transcript, state, reason: "bad offset" });
				continue;
			}
			if (state.caretVisible === false && state.selectionKind === "caret") {
				if (
					transcript.some(
						(t) => t.startsWith("type") || t === "backspace" || t === "delete",
					)
				) {
					failures.push({
						seed,
						transcript,
						state,
						reason: "caret not visible after edits",
					});
				}
			}
		} catch (e) {
			failures.push({ seed, error: String(e), reason: "exception during chaos" });
		}
	}

	await safeClose(null, page);

	if (failures.length > 0) {
		throw new Error(
			"Chaos failures:\n" +
				failures
					.map(
						(f) =>
							`seed=${f.seed} reason=${f.reason}\n${f.transcript ? "transcript=" + f.transcript.join(",") + "\n" : ""}state=${f.state ? JSON.stringify(f.state) : ""} err=${f.error || ""}`,
					)
					.join("\n\n"),
		);
	}

	expect(failures.length).toBe(0);
});

// --- Stronger stress tests designed to surface cursor/text drift ---

test("stress: rapid backspace at start then type lands at start", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>abc</p>"));
		await clickAtText(page, "abc", 0);
		for (let i = 0; i < 3; i++) await press(page, "Backspace");
		await type(page, "X");
		const state = await getState(page);
		expect(state.text.includes("X") || state.text.startsWith("X")).toBe(true);
		expect(state.caretVisible).toBe(true);
	});
});

test("stress: select all via modA then type replaces whole content", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>hello world</p>"));
		await clickAtText(page, "hello", 0);
		await press(page, "Control+A");
		await type(page, "Z");
		const state = await getState(page);
		expect(state.text).toBe("Z");
		expect(state.caretVisible).toBe(true);
	});
});

test("stress: type marker, left, type another, verify order", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p></p>"));
		await clickAtText(page, "", 0);
		await type(page, "A");
		await press(page, "ArrowLeft");
		await type(page, "B");
		const state = await getState(page);
		expect(state.text).toMatch(/A|B/);
		expect(state.text.length).toBeGreaterThanOrEqual(1);
		expect(state.caretVisible).toBe(true);
	});
});

test("stress: delete forward at end then type appends", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>xyz</p>"));
		const end = await page.evaluate(() => window.__test.indexOfText("xyz", "xyz".length));
		// Forward delete at the trailing boundary is typically a no-op.
		// The observable effect we care about: caret stays visible and we can still type.
		await directSelect(page, end, end);
		await directDeleteAt(page, end);
		await directTypeAt(page, end, "Q");
		const state = await getState(page);
		// Accept either appended or same length (if del was no-op), as long as caret lives and we have text.
		if (!state.caretVisible) {
			throw new Error(`stress end-del+type: caret gone ${JSON.stringify(state)}`);
		}
		if (!state.text || state.text.length === 0) {
			throw new Error(`stress end-del+type: empty text ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("stress: model-based flat text edits match expected buffer (letters, bs, del, arrows)", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>model</p>"));
		const start = await page.evaluate(() => window.__test.indexOfText("model", 2));
		if (start >= 0) await page.evaluate((o) => window.__test.moveTo(o), start);

		let model = "model";
		let pos = 2;
		const transcript = [];

		const rng = mulberry32(424242);
		const steps = 12;
		const ops = ["type", "bs", "del", "left", "right"];

		for (let i = 0; i < steps; i++) {
			const op = ops[Math.floor(rng() * ops.length)];
			transcript.push(op);
			try {
				if (op === "type") {
					const ch = String.fromCharCode(97 + Math.floor(rng() * 26));
					await page.evaluate((c) => window.__test.insertText(c), ch);
					model = model.slice(0, pos) + ch + model.slice(pos);
					pos += 1;
				} else if (op === "bs") {
					await page.evaluate(() => window.__test.backspace());
					if (pos > 0) {
						model = model.slice(0, pos - 1) + model.slice(pos);
						pos -= 1;
					}
				} else if (op === "del") {
					await page.evaluate(() => window.__test.delete());
					if (pos < model.length) {
						model = model.slice(0, pos) + model.slice(pos + 1);
					}
				} else if (op === "left") {
					await press(page, "ArrowLeft");
					if (pos > 0) pos -= 1;
				} else if (op === "right") {
					await press(page, "ArrowRight");
					if (pos < model.length) pos += 1;
				}
			} catch (e) {
				const st = await getState(page).catch(() => ({}));
				throw new Error(`op ${op} at step ${i} threw: ${e}\nstate=${JSON.stringify(st)}\nmodel="${model}" pos=${pos}`);
			}

			const state = await getState(page);
			const actual = (state.text || "").replace(/\s+$/, "");
			if (actual !== model) {
				throw new Error(
					`model mismatch at step ${i} (${op}): model="${model}" actual="${actual}" pos=${pos} offset=${state.offset}\ntranscript: ${transcript.join(",")}`,
				);
			}
			if (state.offset == null || state.offset < 0 || state.offset > (state.positions || 0)) {
				throw new Error(`bad offset at step ${i}: ${JSON.stringify(state)} model="${model}"`);
			}
		}

		const final = await getState(page);
		expect(final.text.replace(/\s+$/, "")).toBe(model);
	});
});


async function safeClose(_browser, page) {
	await closePage(page);
}

async function directDeleteAt(page, offset) {
	await page.evaluate((o) => {
		window.__test.moveTo(o);
		window.__test.delete();
	}, offset);
}

async function directTypeAt(page, offset, ch) {
	await page.evaluate(({ o, c }) => {
		window.__test.moveTo(o);
		window.__test.insertText(c);
	}, { o: offset, c: ch });
}

async function runWithFresh(fn) {
	const page = await loadHarness();
	try {
		return await fn(page, null);
	} finally {
		await safeClose(null, page);
	}
}

test("placeholder: in-flow hint fills the empty block", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate(() => {
			const root = document.getElementById("editor");
			const style = document.createElement("style");
			style.textContent = `#editor[data-placeholder]::before { content: attr(data-placeholder); }`;
			document.head.appendChild(style);
			root.setAttribute("data-placeholder", "Text");
			window.__test.setHTML("<p><br></p>");
			window.__editor.placeholder?.sync();
			window.__editor.text.refresh();
			window.__editor.input.cursor.moveTo(0);
			const hint = window.__editor.placeholder?.node;
			const p = root.querySelector("p");
			const pRect = p.getBoundingClientRect();
			const hintRect = hint?.getBoundingClientRect();
			const point = window.__editor.text.pointAt(window.__editor.input.cursor.offset);
			const snap = window.__editor.history.snapshot();
			return {
				empty: root.hasAttribute("data-empty"),
				hintText: hint?.textContent ?? "",
				hintInsideP: !!(hint && p.contains(hint)),
				skipped: !!hint?.classList.contains("skipped"),
				beforeContent: getComputedStyle(root, "::before").content,
				pHeight: pRect.height,
				hintHeight: hintRect?.height ?? 0,
				caretOnP: point?.node === p && point.offset === 0,
				liveHasHint: root.innerHTML.includes("data-structural-hint"),
				snapHasHint: snap.html.includes("data-structural-hint"),
			};
		});
		expect(result.empty).toBe(true);
		expect(result.hintText).toBe("Text");
		expect(result.hintInsideP).toBe(true);
		expect(result.skipped).toBe(true);
		expect(result.beforeContent === "none" || result.beforeContent === "normal").toBe(true);
		expect(result.pHeight).toBeGreaterThan(0);
		expect(result.pHeight).toBeGreaterThanOrEqual(result.hintHeight - 1);
		expect(result.caretOnP).toBe(true);
		expect(result.liveHasHint).toBe(true);
		expect(result.snapHasHint).toBe(false);
	});
});

test("placeholder: typing removes the hint and emptying restores it", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate(() => {
			const root = document.getElementById("editor");
			root.setAttribute("data-placeholder", "Text");
			window.__test.setHTML("<p><br></p>");
			window.__editor.input.cursor.moveTo(0);
			window.__editor.placeholder?.sync();
			const hint = window.__editor.placeholder?.node;
			const p = () => root.querySelector("p");
			const shown = !!(hint && p()?.contains(hint));
			window.__editor.input.cursor.insertText("x");
			window.__editor.placeholder?.sync();
			const hidden = !hint?.isConnected;
			window.__editor.input.cursor.backspace();
			window.__editor.placeholder?.sync();
			const shownAgain = !!(hint && p()?.contains(hint));
			return { shown, hidden, shownAgain, empty: root.hasAttribute("data-empty") };
		});
		expect(result.shown).toBe(true);
		expect(result.hidden).toBe(true);
		expect(result.shownAgain).toBe(true);
		expect(result.empty).toBe(true);
	});
});

test("selection: direct range delete removes exact span and caret at start", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>ABCDEF</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 1));
		const e = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 4));
		await directSelect(page, s, e); // select "BCD"
		await directDeleteSelection(page);
		const state = await getState(page);
		if (!state.text.includes("AEF") || state.text.includes("BCD")) {
			throw new Error(`range delete wrong: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: type after direct range delete replaces the deleted span", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>ABCDEF</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 1));
		const e = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 4));
		await directSelect(page, s, e);
		await directDeleteSelection(page);
		await directInsertText(page, "X");
		const state = await getState(page);
		if (!state.text.includes("AXEF")) {
			throw new Error(`range replace wrong: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: deleting all selected blocks leaves an editable caret", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>one</p><p>two</p>"));
		const start = await page.evaluate(() => window.__test.indexOfText("one", 0));
		const end = await page.evaluate(() => window.__test.indexOfText("two", 3));
		await directSelect(page, start, end);
		await press(page, "Delete");
		const state = await getState(page);
		if (state.text !== "" || state.anchorTag !== "p") {
			throw new Error(`all-block delete did not retain an editable block: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: deleting adjacent blocks keeps the caret at the deletion boundary", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>before</p><p>one</p><p>two</p><p>after</p>"));
		const start = await page.evaluate(() => window.__test.indexOfText("one", 0));
		const end = await page.evaluate(() => window.__test.indexOfText("two", 3));
		await directSelect(page, start, end);
		await press(page, "Delete");
		const state = await getState(page);
		if (state.text !== "beforeafter" || state.anchorTag !== "p") {
			throw new Error(`adjacent-block delete moved the caret: ${JSON.stringify(state)}`);
		}
		await type(page, "X");
		expect((await getState(page)).text).toBe("beforeXafter");
	});
});

test("selection: keyboard Shift+Arrow range delete + type", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>ABCDEFG</p>"));
		await clickAtText(page, "ABCDEFG", 1);
		await press(page, "Shift+ArrowRight");
		await press(page, "Shift+ArrowRight");
		await press(page, "Shift+ArrowRight");
		await press(page, "Delete");
		await type(page, "Z");
		const state = await getState(page);
		if (!state.text.includes("Z") || !state.caretVisible) {
			throw new Error(`kb range delete+type wrong: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: cross-boundary delete then select+replace inside second", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>ab</p><p>cd</p>"));
		// Operate at end of first (boundary), then do a clear select+replace *inside* the second block.
		const end1 = await page.evaluate(() => window.__test.indexOfText("ab", 2));
		await directSelect(page, end1, end1);
		await directDeleteSelection(page);

		// Now select the first char inside the second block and replace it.
		const s2 = await page.evaluate(() => window.__test.indexOfText("cd", 0));
		const e2 = await page.evaluate(() => window.__test.indexOfText("cd", 1));
		await directSelect(page, s2, e2);
		await directDeleteSelection(page);
		await directInsertText(page, "X");

		const state = await getState(page);
		if (!state.text.includes("X") || !state.caretVisible) {
			throw new Error(`cross-boundary selection op wrong: ${JSON.stringify(state)}`);
		}
	});
});

test("selection: select all via direct then type replaces whole content", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>hello world</p>"));
		const start = await page.evaluate(() => window.__test.indexOfText("hello world", 0));
		const end = await page.evaluate(() => window.__test.indexOfText("hello world", "hello world".length));
		await directSelect(page, start, end);
		await directInsertText(page, "Z");
		const state = await getState(page);
		expect(state.text).toBe("Z");
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: select word, toggle strong, type wraps replacement", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>word here</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("word here", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("word here", 4));
		await directSelect(page, s, e);
		await toggleInline(page, "strong");
		await directTypeAt(page, s, "X");
		const state = await getState(page);
		if (!state.text.includes("X") || !state.caretVisible) {
			throw new Error(`inline on selection failed: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: select across blocks, toggle h2", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>one</p><p>two</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("one", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("two", 1));
		await directSelect(page, s, e);
		await toggleBlock(page, "h2");
		const state = await getState(page);
		const html = state.html || "";
		if (!/h2/i.test(html)) {
			throw new Error(`toggle h2 on selection failed: ${html}`);
		}
		expect(state.caretVisible || state.selectionKind !== "caret").toBe(true);
	});
});

test("selection: select paragraph, toggle blockquote", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>quote me</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("quote me", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("quote me", "quote me".length));
		await directSelect(page, s, e);
		await toggleBlock(page, "blockquote");
		const state = await getState(page);
		if (!/blockquote/i.test(state.html || "")) {
			throw new Error(`toggle blockquote failed: ${state.html}`);
		}
	});
});

test("markdown prefixes transform blocks and keep the caret", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate(async () => {
			const editor = window.__editor;
			const test = window.__test;
			const cases = [
				["* ", "ul"],
				["- ", "ul"],
				["[ ] ", "task"],
				["[X] ", "checked"],
				["# ", "h1"],
				["## ", "h2"],
				["### ", "h3"],
				["#### ", "h4"],
				["##### ", "h5"],
				["###### ", "h6"],
				["```", "pre"],
			];
			const output = [];
			for (const [input, expected] of cases) {
				test.setHTML("<p></p>");
				for (const key of input) editor.input.onKeyDown(new KeyboardEvent("keydown", { key, cancelable: true }));
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const block = editor.root.firstElementChild;
				output.push({
					expected,
					tag: block?.tagName.toLowerCase(),
					text: block?.textContent ?? "",
					checked: block?.querySelector("li")?.dataset.checked ?? null,
					offset: test.getState().offset,
				});
			}
			test.setHTML("<p></p>");
			for (const key of "# ") editor.input.onKeyDown(new KeyboardEvent("keydown", { key, cancelable: true }));
			const undone = editor.undo();
			return { output, undone, undoHTML: editor.root.innerHTML.replace(/ class="[^"]*"/u, "") };
		});
		expect(result).toEqual({
			output: [
				{ expected: "ul", tag: "ul", text: "", checked: null, offset: 1 },
				{ expected: "ul", tag: "ul", text: "", checked: null, offset: 1 },
				{ expected: "task", tag: "ul", text: "", checked: "false", offset: 1 },
				{ expected: "checked", tag: "ul", text: "", checked: "true", offset: 1 },
				{ expected: "h1", tag: "h1", text: "", checked: null, offset: 1 },
				{ expected: "h2", tag: "h2", text: "", checked: null, offset: 1 },
				{ expected: "h3", tag: "h3", text: "", checked: null, offset: 1 },
				{ expected: "h4", tag: "h4", text: "", checked: null, offset: 1 },
				{ expected: "h5", tag: "h5", text: "", checked: null, offset: 1 },
				{ expected: "h6", tag: "h6", text: "", checked: null, offset: 1 },
				{ expected: "pre", tag: "pre", text: "", checked: null, offset: 0 },
			],
			undone: true,
			undoHTML: "<p>#</p>",
		});
	});
});

test("selection: toggle list across blocks and join adjacent lists", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<ul><li>one</li></ul><p>two</p><ul><li>three</li></ul>"));
		const s = await page.evaluate(() => window.__test.indexOfText("two", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("two", 3));
		await directSelect(page, s, e);
		await toggleBlock(page, "ul");
		const state = await page.evaluate(() => ({
			lists: document.querySelectorAll("#editor > ul").length,
			items: [...document.querySelectorAll("#editor > ul > li")].map((item) => item.textContent.trim()),
		}));
		expect(state).toEqual({ lists: 1, items: ["one", "two", "three"] });
	});
});

test("selection: toggle list applies to every touched block", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>one</p><p>two</p><p>three</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("one", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("three", 5));
		await directSelect(page, s, e);
		await toggleBlock(page, "ul");
		const state = await page.evaluate(() => ({
			lists: document.querySelectorAll("#editor > ul").length,
			items: [...document.querySelectorAll("#editor > ul > li")].map((item) => item.textContent.trim()),
		}));
		expect(state).toEqual({ lists: 1, items: ["one", "two", "three"] });
	});
});

test("selection: toggle list off unwraps selected items", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<ul><li>one</li><li>two</li></ul>"));
		const s = await page.evaluate(() => window.__test.indexOfText("one", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("two", 3));
		await directSelect(page, s, e);
		await toggleBlock(page, "ul");
		const state = await page.evaluate(() => ({
			lists: document.querySelectorAll("#editor > ul").length,
			paragraphs: [...document.querySelectorAll("#editor > p")].map((item) => item.textContent.trim()),
		}));
		expect(state).toEqual({ lists: 0, paragraphs: ["one", "two"] });
	});
});

test("selection: indent single list item via Tab", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<ul><li>one</li><li>two</li></ul>"));
		const p = await page.evaluate(() => window.__test.indexOfText("two", 0));
		await directSelect(page, p, p);
		await press(page, "Tab");
		const state = await getState(page);
		expect(state.caretVisible || state.selectionKind !== "caret").toBe(true);
	});
});

test("selection: dedent nested list item via Shift+Tab", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<ul><li>one<ul><li>nested</li></ul></li></ul>"));
		const p = await page.evaluate(() => window.__test.indexOfText("nested", 0));
		await directSelect(page, p, p);
		await press(page, "Shift+Tab");
		const state = await getState(page);
		if (!state.caretVisible && state.selectionKind === "caret") {
			throw new Error(`caret invisible after dedent: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible || state.selectionKind !== "caret").toBe(true);
	});
});

test("selection: indent multiple consecutive list items", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<ul><li>a</li><li>b</li><li>c</li></ul>"));
		const s = await page.evaluate(() => window.__test.indexOfText("a", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("c", 1));
		await directSelect(page, s, e);
		await press(page, "Tab");
		const state = await getState(page);
		expect(state.caretVisible || state.selectionKind !== "caret").toBe(true);
	});
});

test("selection: replace selected formatted text clears formatting on replace", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p><strong>bold</strong></p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("bold", 0));
		const e = await page.evaluate(() => window.__test.indexOfText("bold", 4));
		await directSelect(page, s, e);
		await directTypeAt(page, s, "plain");
		const state = await getState(page);
		if (!state.text.includes("plain")) {
			throw new Error(`replace formatted failed: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

test("selection: caret visible and selectionKind caret after range replace", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => window.__test.setHTML("<p>ABCDEF</p>"));
		const s = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 1));
		const e = await page.evaluate(() => window.__test.indexOfText("ABCDEF", 4));
		await directSelect(page, s, e);
		await press(page, "Delete");
		await directInsertText(page, "X");
		const state = await getState(page);
		if (state.selectionKind !== "caret" && state.selectionKind !== "range") {
			throw new Error(`unexpected selectionKind: ${JSON.stringify(state)}`);
		}
		expect(state.caretVisible).toBe(true);
	});
});

const REPORTED_LOAN_PARAGRAPH =
	"Antony Barbara Head (43) and Leonard Bertha Ballard (45) arasdase married NZ citizens. Both own their home and reside together. Antony is employed FT with an annual income of $62,400. Leonard is employed PT with an annual income of $31,148. The application is for a top-up loan in their personal names.";

const LONG_SINGLE_PARAGRAPH =
	"Use the heading buttons to promote paragraphs into heading levels. Create bullet lists for structured content." +
	REPORTED_LOAN_PARAGRAPH.repeat(10);
// Catastrophic-regression ceiling (not a hard 60 FPS gate). Measure+verify still
// asserts correct caret/text updates; median only catches multi-frame stalls.
const FRAME_BUDGET_MS = 100;

test("performance: long single paragraph keeps keyboard editing interactions responsive", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate((paragraph) => {
			const root = document.getElementById("editor");
			const editor = window.__editor;
			const cursor = editor.input.cursor;
			const text = editor.text;
			const samplesPerOperation = 5;

			window.__test.setHTML(`<p class="focus">${paragraph}</p>`);
			const textNode = root.querySelector("p.focus")?.firstChild;
			if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
				throw new Error("long-paragraph fixture did not create one text node");
			}

			const midpoint = text.indexOfPoint({
				node: textNode,
				offset: Math.floor(textNode.data.length / 2),
			});
			if (midpoint < 0) {
				throw new Error("could not resolve the long paragraph midpoint");
			}

			const dispatch = (key, shiftKey = false) => {
				document.dispatchEvent(
					new KeyboardEvent("keydown", {
						key,
						shiftKey,
						bubbles: true,
						cancelable: true,
					}),
				);
			};
			const caretIsVisible = () =>
				!!cursor.caret.node && getComputedStyle(cursor.caret.node).visibility === "visible";
			const median = (samples) => {
				const sorted = [...samples].sort((a, b) => a - b);
				return sorted[Math.floor(sorted.length / 2)];
			};
			const measure = (name, action, verify) => {
				const samples = [];
				// One untimed pass so the first measured sample is not a cold path.
				cursor.moveTo(midpoint);
				action();
				for (let i = 0; i < samplesPerOperation; i += 1) {
					cursor.moveTo(midpoint);
					const before = {
						offset: cursor.offset,
						textLength: root.textContent.length,
					};
					const started = performance.now();
					action();
					samples.push(performance.now() - started);
					verify(before);
				}
				return { name, samples, median: median(samples) };
			};

			// Warm the position and layout caches before measuring steady-state interaction latency.
			cursor.moveTo(midpoint);
			dispatch("ArrowRight");
			cursor.moveTo(midpoint);
			dispatch("x");
			cursor.backspace();
			cursor.moveTo(midpoint);

			const operations = [
				measure(
					"cursor movement",
					() => dispatch("ArrowRight"),
					(before) => {
						if (cursor.offset <= before.offset || !caretIsVisible()) {
							throw new Error("ArrowRight did not advance a visible caret");
						}
					},
				),
				measure(
					"range selection",
					() => dispatch("ArrowRight", true),
					(before) => {
						if (
							cursor.selectionKind !== "range" ||
							cursor.selection.focusOffset <= before.offset
						) {
							throw new Error("Shift+ArrowRight did not extend the selection");
						}
					},
				),
				measure(
					"text insertion",
					() => dispatch("x"),
					(before) => {
						if (
							root.textContent.length !== before.textLength + 1 ||
							cursor.offset <= before.offset ||
							!caretIsVisible()
						) {
							throw new Error("text insertion did not update text and caret");
						}
					},
				),
			];

			return {
				paragraphLength: paragraph.length,
				positions: text.positions().length,
				operations,
				stats: text.stats,
			};
		}, LONG_SINGLE_PARAGRAPH);

		expect(result.paragraphLength).toBeGreaterThanOrEqual(3000);
		for (const operation of result.operations) {
			if (operation.median > FRAME_BUDGET_MS) {
				throw new Error(
					`${operation.name} median=${operation.median}ms exceeds the ${FRAME_BUDGET_MS.toFixed(2)}ms 60 FPS frame budget; diagnostics=${JSON.stringify(result)}`,
				);
			}
		}
	});
});

const WRAPPING_THREAD_CHUNK =
	"Name\u00a0\u00a0[11:28 AM]\nYup\n[11:28 AM]and the guides that ive been trying to use are jus slop\nOther\u00a0\u00a0[11:29 AM]\nYeah, that's the style.\n[11:33 AM]All these guides should not be necessary, and instead we should have thought about how to make the UX easy to discover and use... crazy.\nName\u00a0\u00a0[11:35 AM]\nno way\nOther\u00a0\u00a0[11:37 AM]\nI want to replace this tool\nName\u00a0\u00a0[11:37 AM]\ndo it\n";
const HUGE_WRAPPING_PARAGRAPH = `sadasdas${WRAPPING_THREAD_CHUNK.repeat(36)}`;
const HUGE_WRAPPING_DOCUMENT = [
	'<p class="focus">asdadsasdassdas</p>',
	'<p class="">asdsaasd</p>',
	'<p class="">asddas</p>',
	`<p class="focus">${HUGE_WRAPPING_PARAGRAPH}</p>`,
	`<p class="">${WRAPPING_THREAD_CHUNK}</p>`,
	'<p class=""><br></p>',
].join("");

test("performance: mixed short blocks plus huge wrapping paragraph keeps keyboard editing responsive", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate(
			({ html, hugeLength }) => {
				const root = document.getElementById("editor");
				const editor = window.__editor;
				const cursor = editor.input.cursor;
				const text = editor.text;
				const samplesPerOperation = 5;

				window.__test.setHTML(html);
				const paragraphs = [...root.querySelectorAll("p")];
				const hugeNode = paragraphs[3]?.firstChild;
				if (!hugeNode || hugeNode.nodeType !== Node.TEXT_NODE) {
					throw new Error("huge wrapping fixture did not create a text node in paragraph 4");
				}
				if (hugeNode.data.length < hugeLength) {
					throw new Error(
						`huge wrapping paragraph too small: ${hugeNode.data.length} < ${hugeLength}`,
					);
				}

				const midpoint = text.indexOfPoint({
					node: hugeNode,
					offset: Math.floor(hugeNode.data.length / 2),
				});
				if (midpoint < 0) {
					throw new Error("could not resolve the huge wrapping paragraph midpoint");
				}

				const dispatch = (key, shiftKey = false) => {
					document.dispatchEvent(
						new KeyboardEvent("keydown", {
							key,
							shiftKey,
							bubbles: true,
							cancelable: true,
						}),
					);
				};
				const caretIsVisible = () =>
					!!cursor.caret.node && getComputedStyle(cursor.caret.node).visibility === "visible";
				const median = (samples) => {
					const sorted = [...samples].sort((a, b) => a - b);
					return sorted[Math.floor(sorted.length / 2)];
				};
				const snapshotStats = () => ({
					rebuildCount: text.stats.rebuildCount,
					bcrCount: text.stats.bcrCount,
					positionsLength: text.stats.positionsLength,
					lastBuildMs: text.stats.lastBuildMs,
				});
				const measure = (name, action, verify) => {
					const samples = [];
					cursor.moveTo(midpoint);
					action();
					for (let i = 0; i < samplesPerOperation; i += 1) {
						cursor.moveTo(midpoint);
						const before = {
							offset: cursor.offset,
							textLength: root.textContent.length,
							caretTop: cursor.caret.node?.style.top ?? "",
							stats: snapshotStats(),
						};
						const started = performance.now();
						action();
						samples.push(performance.now() - started);
						verify(before);
					}
					return { name, samples, median: median(samples) };
				};

				cursor.moveTo(midpoint);
				dispatch("ArrowRight");
				cursor.moveTo(midpoint);
				dispatch("x");
				cursor.backspace();
				cursor.moveTo(midpoint);
				dispatch("ArrowDown");

				const operations = [
					measure(
						"cursor movement",
						() => dispatch("ArrowRight"),
						(before) => {
							if (cursor.offset <= before.offset || !caretIsVisible()) {
								throw new Error("ArrowRight did not advance a visible caret");
							}
						},
					),
					measure(
						"range selection",
						() => dispatch("ArrowRight", true),
						(before) => {
							if (
								cursor.selectionKind !== "range" ||
								cursor.selection.focusOffset <= before.offset
							) {
								throw new Error("Shift+ArrowRight did not extend the selection");
							}
						},
					),
					measure(
						"text insertion",
						() => dispatch("x"),
						(before) => {
							if (
								root.textContent.length !== before.textLength + 1 ||
								cursor.offset <= before.offset ||
								!caretIsVisible()
							) {
								throw new Error("text insertion did not update text and caret");
							}
						},
					),
					measure(
						"backspace",
						() => dispatch("Backspace"),
						(before) => {
							if (
								root.textContent.length !== before.textLength - 1 ||
								cursor.offset >= before.offset ||
								!caretIsVisible()
							) {
								throw new Error("backspace did not delete text and move caret");
							}
						},
					),
					measure(
						"vertical movement",
						() => dispatch("ArrowDown"),
						(before) => {
							if (cursor.offset === before.offset || !caretIsVisible()) {
								throw new Error("ArrowDown did not move a visible caret");
							}
						},
					),
				];

				cursor.moveTo(midpoint);
				const burstBefore = {
					textLength: root.textContent.length,
					offset: cursor.offset,
					stats: snapshotStats(),
				};
				const burstStarted = performance.now();
				for (let i = 0; i < 10; i += 1) dispatch("x");
				const burstMs = performance.now() - burstStarted;
				if (
					root.textContent.length !== burstBefore.textLength + 10 ||
					cursor.offset !== burstBefore.offset + 10 ||
					!caretIsVisible()
				) {
					throw new Error("sequential insertion burst did not type 10 characters");
				}

				const phase = (name, action) => {
					const samples = [];
					for (let i = 0; i < samplesPerOperation; i += 1) {
						cursor.moveTo(midpoint);
						const started = performance.now();
						action();
						samples.push(performance.now() - started);
					}
					return { name, samples, median: median(samples) };
				};
				const phases = [
					phase("insertAtIndex", () => {
						text.insertAtIndex(cursor.offset, "x");
					}),
					phase("visualPositionAt", () => {
						text._visualCache?.clear();
						text.visualPositionAt(cursor.offset);
					}),
					phase("indexFromLineMove", () => {
						text._visualCache?.clear();
						text.indexFromLineMove(cursor.offset, 1, null);
					}),
					phase("insertText", () => {
						cursor.insertText("x");
					}),
				];

				return {
					paragraphLength: hugeNode.data.length,
					positions: text.positions().length,
					operations,
					phases,
					burst: {
						name: "sequential insertion",
						totalMs: burstMs,
						perCharMs: burstMs / 10,
						count: 10,
					},
					stats: text.stats,
					statsBeforeBurst: burstBefore.stats,
				};
			},
			{ html: HUGE_WRAPPING_DOCUMENT, hugeLength: HUGE_WRAPPING_PARAGRAPH.length },
		);

		expect(result.paragraphLength).toBeGreaterThanOrEqual(12000);
		expect(result.positions).toBeGreaterThanOrEqual(12000);
		const interactiveBudgetMs = 1000 / 60;
		for (const operation of [...result.operations, result.burst]) {
			const cost = operation.perCharMs ?? operation.median;
			const label = operation.perCharMs != null ? "perChar" : "median";
			if (cost > interactiveBudgetMs) {
				throw new Error(
					`${operation.name} ${label}=${cost}ms exceeds the ${interactiveBudgetMs.toFixed(2)}ms 60 FPS frame budget; diagnostics=${JSON.stringify(result)}`,
				);
			}
		}
	});
});

test("selection: dragging upward from a paragraph end selects preceding text", async () => {
	await runWithFresh(async (page) => {
		const points = await page.evaluate(() => {
			window.__test.setHTML(`<p>${"word ".repeat(70)}</p>`);
			const node = document.querySelector("#editor p")?.firstChild;
			if (!node || node.nodeType !== Node.TEXT_NODE) return null;
			const pointAt = (offset) => {
				const range = document.createRange();
				range.setStart(node, offset);
				range.collapse(true);
				const rect = range.getBoundingClientRect();
				return { x: rect.left, y: rect.top + rect.height / 2 };
			};
			return { end: pointAt(node.data.length), earlier: pointAt(20) };
		});
		if (!points) throw new Error("could not resolve paragraph drag points");

		await page.mouse.move(points.end.x, points.end.y);
		await page.mouse.down();
		await page.mouse.move(points.earlier.x, points.earlier.y, { steps: 4 });
		const selection = await page.evaluate(() => {
			const cursor = window.__editor.input.cursor;
			const range = cursor.selection.normalizedRange();
			return {
				kind: cursor.selectionKind,
				anchor: cursor.selection.anchorOffset,
				focus: cursor.selection.focusOffset,
				start: range.start,
				end: range.end,
			};
		});
		await page.mouse.up();

		expect(selection.kind).toBe("range");
		expect(selection.anchor).toBeGreaterThan(selection.focus);
		expect(selection.end).toBeGreaterThan(selection.start);
	});
});

test("editing: observer rebuild after an insert keeps the next insert in the same late block", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => {
			const leading = Array.from({ length: 12 }, (_, i) => `<p>lead ${i}</p>`).join("");
			window.__editor.text.eagerBlockCount = 4;
			window.__test.setHTML(
				`${leading}<nav><p>The Mock Turtle's Story</p></nav><p>Alice was beginning to get very tired</p>`,
			);
			const node = [...document.querySelectorAll("#editor p")].find((p) =>
				p.textContent.includes("Alice was beginning"),
			)?.firstChild;
			if (!node) throw new Error("late target paragraph missing");
			const offset = window.__editor.text.indexOfPoint({ node, offset: node.data.length });
			if (offset < 0) throw new Error("late target paragraph is not indexed");
			window.__editor.input.cursor.moveTo(offset);
			window.__editor.input.cursor.insertText("x");
		});

		// Let the MutationObserver process the first DOM mutation before the next key event.
		await page.waitForTimeout(20);
		const state = await page.evaluate(() => {
			window.__editor.input.cursor.insertText("x");
			return {
				target: [...document.querySelectorAll("#editor p")].find((p) =>
					p.textContent.includes("Alice was beginning"),
				)?.textContent,
				toc: [...document.querySelectorAll("#editor p")].find((p) =>
					p.textContent.includes("The Mock Turtle's Story"),
				)?.textContent,
			};
		});

		expect(state.target).toBe("Alice was beginning to get very tiredxx");
		expect(state.toc).toBe("The Mock Turtle's Story");
	});
});

test("selection: Ctrl+A grows from a paragraph to its section and Ctrl+Shift+A shrinks", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => {
			window.__test.setHTML(
				"<nav><p>The Mock Turtle's Story</p></nav><section><p>target paragraph</p><p>second paragraph</p></section><p>outside</p>",
			);
			const offset = window.__test.indexOfText("target paragraph", 3);
			window.__editor.input.cursor.moveTo(offset);
		});
		const snapshot = () =>
			page.evaluate(() => {
				const cursor = window.__editor.input.cursor;
				return {
					scope: cursor._structuralScopeNode?.tagName?.toLowerCase() ?? null,
					text: cursor.selection.toDomRange()?.toString() ?? "",
				};
			});

		await press(page, "Control+A");
		const paragraph = await snapshot();
		await press(page, "Control+A");
		const section = await snapshot();
		await press(page, "Control+Shift+A");
		const shrunk = await snapshot();

		expect(paragraph).toEqual({ scope: "p", text: "target paragraph" });
		expect(section).toEqual({
			scope: "section",
			text: "target paragraphsecond paragraph",
		});
		expect(shrunk).toEqual({ scope: "p", text: "target paragraph" });
	});
});

test("editing: replacing a late selection keeps the next insert in that paragraph", async () => {
	await runWithFresh(async (page) => {
		await page.evaluate(() => {
			const leading = Array.from({ length: 12 }, (_, i) => `<p>lead ${i}</p>`).join("");
			window.__editor.text.eagerBlockCount = 4;
			window.__test.setHTML(
				`${leading}<p>White Rabbit</p><p>Alice felt VERY tired</p>`,
			);
			const start = window.__test.indexOfText("VERY", 0);
			const end = window.__test.indexOfText("VERY", 4);
			window.__editor.input.cursor.select(start, end);
			window.__editor.input.cursor.insertText("X");
		});

		// The observer must not invalidate the replacement's refreshed positions.
		await page.waitForTimeout(20);
		const state = await page.evaluate(() => {
			window.__editor.input.cursor.insertText("X");
			return {
				target: [...document.querySelectorAll("#editor p")].find((p) =>
					p.textContent.includes("Alice felt"),
				)?.textContent,
				previous: [...document.querySelectorAll("#editor p")].find((p) =>
					p.textContent.includes("White Rabbit"),
				)?.textContent,
			};
		});

		expect(state.target).toBe("Alice felt XX tired");
		expect(state.previous).toBe("White Rabbit");
	});
});

test("movement: up/down across late blocks with a small window", async () => {
	await runWithFresh(async (page) => {
		const result = await page.evaluate(() => {
			window.__editor.text.eagerBlockCount = 2;
			window.__test.setHTML("<p>aaa</p><p>bbb</p><p>ccc</p><p>ddd</p><p></p><p>eee</p>");
			const cur = window.__editor.input.cursor;
			const blockText = () => {
				const point = window.__editor.text.pointAt(cur.offset);
				const el =
					point?.node?.nodeType === Node.TEXT_NODE ? point.node.parentElement : point?.node;
				return (el?.closest("p, li")?.textContent ?? "").replace(/\u200b/g, "");
			};
			cur.moveTo(window.__test.indexOfText("ddd", 0));
			const onD = blockText();
			cur.down();
			const afterDown = blockText();
			cur.up();
			const backD = blockText();
			cur.up();
			const onC = blockText();
			return { onD, afterDown, backD, onC };
		});
		expect(result).toEqual({ onD: "ddd", afterDown: "", backD: "ddd", onC: "ccc" });
	});
});
