import { test, expect } from "bun:test";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

async function loadTest(browser, pagePath) {
	const page = await browser.newPage();
	await page.route("**/*", (route) => {
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
	await page.goto(`http://localhost${pagePath}`);
	return page;
}

async function loadResult(browser, pagePath) {
	const page = await loadTest(browser, pagePath);
	await page.waitForFunction(() => window.__result !== undefined);
	const result = await page.evaluate(() => window.__result);
	await page.close();
	return result;
}

function normalizeHtml(html) {
	return html.replace(/ class="[^"]*"/g, "");
}

async function pointForText(page, text, offset) {
	return page.evaluate(({ text, offset }) => window.__test.pointForText(text, offset), { text, offset });
}

test("static: overlapping inline across existing <em>", async () => {
	const browser = await chromium.launch();
	const result = await loadResult(browser, "/tests/int-mod-static.test.html");
	await browser.close();
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});

test("navigate: simulate keystroke selection after toggle", async () => {
	const browser = await chromium.launch();
	const result = await loadResult(browser, "/tests/int-mod-navigate.test.html");
	await browser.close();
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});

test("ui: native selection across existing <em>", async () => {
	const browser = await chromium.launch();
	const page = await loadTest(browser, "/tests/int-mod-ui.test.html");

	const some = await pointForText(page, "some", 1);
	await page.mouse.click(some.x, some.y);
	await page.click('button[data-tag="em"]');

	const start = await pointForText(page, "Select ", 4);
	await page.mouse.click(start.x, start.y);
	await page.evaluate(() => window.__test.selectRange("Select ", 4, " text", 3));

	const selectedText = await page.evaluate(() => window.__test.selectionText());
	const beforeHtml = normalizeHtml(await page.evaluate(() => window.__test.html()));
	await page.click('button[data-tag="em"]');
	const afterHtml = normalizeHtml(await page.evaluate(() => window.__test.html()));
	await page.click('button[data-tag="em"]');
	const unwrappedState = await page.evaluate(() => {
		const paragraph = document.querySelector("#editor p");
		const children = Array.from(paragraph.childNodes).map(node => ({
			type: node.nodeType,
			text: node.textContent,
		}));
		return {
			html: paragraph.innerHTML,
			children,
			hasAdjacentText: Array.from(paragraph.childNodes).some((node, index, nodes) =>
				node.nodeType === Node.TEXT_NODE && nodes[index + 1]?.nodeType === Node.TEXT_NODE
			),
		};
	});

	await page.close();
	await browser.close();

	expect(selectedText).toBe("ct some te");
	expect(beforeHtml).toBe("Select <em>some</em> text");
	expect(afterHtml).toBe("Sele<em>ct some te</em>xt");
	expect(unwrappedState.html).toBe("Select some text");
	expect(unwrappedState.children).toEqual([{ type: 3, text: "Select some text" }]);
	expect(unwrappedState.hasAdjacentText).toBe(false);
});
