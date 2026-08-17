import { expect, test } from "bun:test";
import { closePage, installBrowserLifecycle, loadPath } from "./playwright-harness.js";

installBrowserLifecycle();

test("shorthands automatically commit dates on a delimiter", async () => {
	const page = await loadPath("/tests/int-richtext-harness.html");
	try {
		const result = await page.evaluate(async () => {
			const { Shorthands } = await import("/src/js/structural/index.js");
			const editor = window.__editor;
			window.__test.setHTML("<p></p>");
			const events = [];
			editor.root.addEventListener("ShorthandCommit", (event) => events.push(event.type));
			editor.installPlugin(new Shorthands({
				definitions: [
					{
						id: "date",
						trigger: "@",
						pattern: /^\d{4}-\d{2}-\d{2}$/,
						auto: "delimiter",
						element: "structural-date",
					},
				],
			}));
			editor.input.cursor.moveTo(0);
			editor.input._editorActive = true;
			for (const key of ["@", "2", "0", "2", "6", "-", "0", "8", "-", "2", "3", " "]) {
				editor.input.onKeyDown(new KeyboardEvent("keydown", { key, cancelable: true, target: editor.root }));
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { html: editor.root.innerHTML, events };
		});
		expect(result.html).toContain('<structural-date class="atom shorthand" data-shorthand="date"');
		expect(result.html).toContain(">@2026-08-23</structural-date>");
		expect(result.html).toContain("</structural-date> ");
		expect(result.events).toEqual(["ShorthandCommit"]);
	} finally {
		await closePage(page);
	}
});

test("shorthands emit popup changes and replace picked items", async () => {
	const page = await loadPath("/tests/int-richtext-harness.html");
	try {
		const result = await page.evaluate(async () => {
			const { Shorthands } = await import("/src/js/structural/index.js");
			const editor = window.__editor;
			window.__test.setHTML("<p></p>");
			const events = [];
			editor.root.addEventListener("ShorthandOpen", () => events.push("open"));
			editor.root.addEventListener("ShorthandChange", () => events.push("change"));
			const plugin = editor.installPlugin(new Shorthands({
				definitions: [{ id: "mention", trigger: "@", source: () => [{ id: "alice", label: "alice" }] }],
			}));
			editor.input.cursor.moveTo(0);
			editor.input._editorActive = true;
			for (const key of ["@", "a"]) editor.input.onKeyDown(new KeyboardEvent("keydown", { key, cancelable: true }));
			await new Promise((resolve) => setTimeout(resolve, 10));
			plugin.pick({ id: "alice", label: "alice" });
			return { html: editor.root.innerHTML, events };
		});
		expect(result.html).toContain('data-shorthand="mention"');
		expect(result.html).toContain("@alice");
		expect(result.events).toContain("change");
	} finally {
		await closePage(page);
	}
});

test("shorthand example keeps virtual overlays and input active", async () => {
	const page = await loadPath("/examples/app-shorthands.example.html");
	try {
		await page.locator("#editor").click();
		await page.keyboard.type(" #");
		await page.waitForTimeout(20);
		const state = await page.evaluate(() => ({
			html: document.querySelector("#editor")?.innerHTML,
			menu: document.querySelector("#suggestions")?.className,
			caret: getComputedStyle(document.querySelector("#caret")).visibility,
			selection: getComputedStyle(document.querySelector("#selection")).visibility,
		}));
		expect(state.html).toContain("#");
		expect(state.menu).toContain("open");
		expect(state.caret).toBe("visible");
		expect(state.selection).toBe("hidden");
	} finally {
		await closePage(page);
	}
});

test("shorthands detach removes its input rule", async () => {
	const page = await loadPath("/tests/int-richtext-harness.html");
	try {
		const result = await page.evaluate(async () => {
			const { Shorthands } = await import("/src/js/structural/index.js");
			const editor = window.__editor;
			const plugin = editor.installPlugin(new Shorthands({
				definitions: [{ id: "tag", trigger: "#" }],
			}));
			const rule = plugin._rule;
			const installed = editor.inputRules.includes(rule);
			plugin.detach();
			return { installed, removed: !editor.inputRules.includes(rule) };
		});
		expect(result).toEqual({ installed: true, removed: true });
	} finally {
		await closePage(page);
	}
});
