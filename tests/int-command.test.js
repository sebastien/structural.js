import { test, expect } from "bun:test";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

async function loadPage(browser) {
	const page = await browser.newPage();
	await page.route("**/*", route => {
		const url = new URL(route.request().url());
		const fp = join(root, url.pathname);
		if (existsSync(fp)) {
			const ext = fp.split(".").pop();
			const mime = ext === "js" ? "application/javascript" : ext === "html" ? "text/html" : "text/plain";
			route.fulfill({ body: readFileSync(fp, "utf-8"), contentType: mime });
		} else {
			route.continue();
		}
	});
	await page.goto("http://localhost/tests/int-command.test.html");
	await page.waitForFunction(() => window.__result !== undefined);
	return page;
}

test("command: serializable command and transaction objects", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser);
	const result = await page.evaluate(() => window.__result);
	await page.close();
	await browser.close();

	expect(result).toEqual({
		stringCommand: {
			type: "toggleInline",
			actor: "agent",
			args: { value: "strong" },
			selection: { offset: 12, selectionKind: "caret" },
			mode: null,
			meta: {},
		},
		objectCommand: {
			type: "toggleBlock",
			actor: "local",
			args: { tag: "h2" },
			selection: null,
			mode: "insert",
			meta: { source: "keymap" },
		},
		transaction: {
			handled: true,
			json: {
				command: {
					type: "splitBlock",
					actor: "local",
					args: {},
					selection: null,
					mode: null,
					meta: {},
				},
				steps: [{ type: "splitNode", path: [0], offset: 3 }],
				inverse: [{ type: "mergeNode", path: [0] }],
				selectionBefore: { offset: 3 },
				selectionAfter: { offset: 4 },
				result: true,
			},
		},
		keys: {
			ctrlR: false,
			f5: false,
			ctrlB: true,
		},
	});
});
