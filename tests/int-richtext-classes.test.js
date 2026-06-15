import { test, expect } from "bun:test";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

async function loadPage(browser, pagePath) {
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
	await page.goto(`http://localhost${pagePath}`);
	return page;
}

async function pointForText(page, selector, text, offset) {
	return page.evaluate(({ selector, text, offset }) => {
		const root = document.querySelector(selector);
		if (!root) return null;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const index = node.data.indexOf(text);
			if (index < 0) continue;
			const range = document.createRange();
			const start = index + offset;
			range.setStart(node, start);
			range.setEnd(node, Math.min(node.data.length, start + 1));
			const rect = range.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		}
		return null;
	}, { selector, text, offset });
}

test("richtext: block and inline focus and selection classes", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser, "/examples/app-richtext.example.html");

	const point = await pointForText(page, "blockquote p", "great", 1);
	await page.mouse.click(point.x, point.y);

	await page.waitForFunction(() => {
		const paragraph = document.querySelector("blockquote p");
		const quote = document.querySelector("blockquote");
		return paragraph?.classList.contains("focus") && quote?.classList.contains("focus-within");
	});

	await page.evaluate(() => {
		const paragraph = document.querySelector("blockquote p");
		const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
		let startNode = null;
		let endNode = null;
		let node;
		while ((node = walker.nextNode())) {
			if (!startNode) {
				const startIndex = node.data.indexOf("great");
				if (startIndex >= 0) {
					startNode = { node, offset: startIndex };
				}
			}
			if (!endNode) {
				const endIndex = node.data.indexOf("highlighting");
				if (endIndex >= 0) {
					endNode = { node, offset: endIndex + "highlighting".length };
				}
			}
		}
		const range = document.createRange();
		range.setStart(startNode.node, startNode.offset);
		range.setEnd(endNode.node, endNode.offset);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});

	await page.waitForFunction(() => {
		const paragraph = document.querySelector("blockquote p");
		const quote = document.querySelector("blockquote");
		return paragraph?.classList.contains("selected") && quote?.classList.contains("selected-within");
	});

	const blockState = await page.evaluate(() => {
		const paragraph = document.querySelector("blockquote p");
		const quote = document.querySelector("blockquote");
		return {
			paragraph: Array.from(paragraph.classList).sort(),
			quote: Array.from(quote.classList).sort(),
		};
	});

	await page.evaluate(() => {
		const paragraph = Array.from(document.querySelectorAll("#editor p")).find(node =>
			node.textContent.includes("Keyboard shortcuts work too")
		);
		const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
		let startNode = null;
		let endNode = null;
		let node;
		while ((node = walker.nextNode())) {
			if (!startNode) {
				const startIndex = node.data.indexOf("Ctrl+B");
				if (startIndex >= 0) {
					startNode = { node, offset: startIndex + 2 };
				}
			}
			if (!endNode) {
				const endIndex = node.data.indexOf("Ctrl+I");
				if (endIndex >= 0) {
					endNode = { node, offset: endIndex + "Ctrl+I".length - 2 };
				}
			}
		}
		const range = document.createRange();
		range.setStart(startNode.node, startNode.offset);
		range.setEnd(endNode.node, endNode.offset);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});

	await page.waitForFunction(() => {
		const paragraph = Array.from(document.querySelectorAll("#editor p")).find(node =>
			node.textContent.includes("Keyboard shortcuts work too")
		);
		const codes = paragraph ? Array.from(paragraph.querySelectorAll("code")) : [];
		return (
			paragraph?.classList.contains("selected-within") &&
			codes[0]?.classList.contains("selected") &&
			codes[1]?.classList.contains("selected")
		);
	});

	const inlineState = await page.evaluate(() => {
		const paragraph = Array.from(document.querySelectorAll("#editor p")).find(node =>
			node.textContent.includes("Keyboard shortcuts work too")
		);
		const codes = Array.from(paragraph.querySelectorAll("code"));
		return {
			paragraph: Array.from(paragraph.classList).sort(),
			code0: Array.from(codes[0].classList).sort(),
			code1: Array.from(codes[1].classList).sort(),
			code2: Array.from(codes[2].classList).sort(),
		};
	});

	await page.close();
	await browser.close();

	expect(blockState.paragraph).toContain("focus");
	expect(blockState.paragraph).toContain("selected");
	expect(blockState.paragraph).not.toContain("focus-within");
	expect(blockState.paragraph).not.toContain("selected-within");
	expect(blockState.quote).toContain("focus-within");
	expect(blockState.quote).toContain("selected-within");
	expect(blockState.quote).not.toContain("focus");
	expect(blockState.quote).not.toContain("selected");

	expect(inlineState.paragraph).toContain("selected-within");
	expect(inlineState.paragraph).not.toContain("selected");
	expect(inlineState.code0).toContain("selected");
	expect(inlineState.code1).toContain("selected");
	expect(inlineState.code2).not.toContain("selected");
	expect(inlineState.code0).not.toContain("selected-within");
	expect(inlineState.code1).not.toContain("selected-within");
});
