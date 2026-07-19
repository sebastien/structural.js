import { expect, test } from "bun:test";
import {
	closePage,
	installBrowserLifecycle,
	loadPath,
	loadResult,
} from "./playwright-harness.js";

installBrowserLifecycle();

function normalizeHtml(html) {
	return html.replace(/ class="[^"]*"/g, "");
}

async function pointForText(page, text, offset) {
	return page.evaluate(
		({ text, offset }) => window.__test.pointForText(text, offset),
		{ text, offset },
	);
}

test("static: overlapping inline across existing <em>", async () => {
	const result = await loadResult("/tests/int-mod-static.test.html");
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});

test("navigate: simulate keystroke selection after toggle", async () => {
	const result = await loadResult("/tests/int-mod-navigate.test.html");
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});

test("ui: native selection across existing <em>", async () => {
	const page = await loadPath("/tests/int-mod-ui.test.html");
	try {
		const some = await pointForText(page, "some", 1);
		await page.mouse.click(some.x, some.y);
		await page.click('button[data-tag="em"]');

		const start = await pointForText(page, "Select ", 4);
		await page.mouse.click(start.x, start.y);
		await page.evaluate(() =>
			window.__test.selectRange("Select ", 4, " text", 3),
		);

		const selectedText = await page.evaluate(() => window.__test.selectionText());
		const beforeHtml = normalizeHtml(
			await page.evaluate(() => window.__test.html()),
		);
		await page.click('button[data-tag="em"]');
		const afterHtml = normalizeHtml(
			await page.evaluate(() => window.__test.html()),
		);
		await page.click('button[data-tag="em"]');
		const unwrappedState = await page.evaluate(() => {
			const paragraph = document.querySelector("#editor p");
			const children = Array.from(paragraph.childNodes).map((node) => ({
				type: node.nodeType,
				text: node.textContent,
			}));
			return {
				html: paragraph.innerHTML,
				children,
				hasAdjacentText: Array.from(paragraph.childNodes).some(
					(node, index, nodes) =>
						node.nodeType === Node.TEXT_NODE &&
						nodes[index + 1]?.nodeType === Node.TEXT_NODE,
				),
			};
		});

		expect(selectedText).toBe("ct some te");
		expect(beforeHtml).toBe("Select <em>some</em> text");
		expect(afterHtml).toBe("Sele<em>ct some te</em>xt");
		expect(unwrappedState.html).toBe("Select some text");
		expect(unwrappedState.children).toEqual([
			{ type: 3, text: "Select some text" },
		]);
		expect(unwrappedState.hasAdjacentText).toBe(false);
	} finally {
		await closePage(page);
	}
});

test("blockquote toggle unwraps heading when schema forbids nested blockquote", async () => {
	const page = await loadPath("/tests/int-mod-blockquote-toggle.test.html");
	try {
		const point = await pointForText(page, "Collaborative", 1);
		await page.mouse.click(point.x, point.y);
		await page.click('button[data-tag="blockquote"]');
		await page.click('button[data-tag="blockquote"]');
		const html = normalizeHtml(await page.evaluate(() => window.__test.html()));
		expect(html).toBe("<h1>Collaborative document</h1><p>Body</p>");
	} finally {
		await closePage(page);
	}
});

test("blockquote toggle reuses remembered block when native selection is lost", async () => {
	const page = await loadPath("/tests/int-mod-blockquote-toggle.test.html");
	try {
		const point = await pointForText(page, "Collaborative", 1);
		await page.mouse.click(point.x, point.y);
		await page.click('button[data-tag="blockquote"]');
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		await page.click('button[data-tag="blockquote"]');
		const html = normalizeHtml(await page.evaluate(() => window.__test.html()));
		expect(html).toBe("<h1>Collaborative document</h1><p>Body</p>");
	} finally {
		await closePage(page);
	}
});
