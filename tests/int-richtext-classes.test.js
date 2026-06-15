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

async function selectNodeRange(page, selector) {
	await page.evaluate((selector) => {
		const node = document.querySelector(selector);
		if (!node) return;
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNode(node);
		selection.removeAllRanges();
		selection.addRange(range);
	}, selector);
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

test("richtext: enter and shift-enter keep block structure", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser, "/examples/app-richtext.example.html");

	let point = await pointForText(page, "#editor", "promote paragraphs", "promote".length);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const paragraphs = Array.from(document.querySelectorAll("#editor p"));
		return paragraphs.some((node, index) =>
			node.textContent.trim() === "Use the heading buttons to promote" &&
			paragraphs[index + 1]?.textContent.trim() === "paragraphs into heading levels. Create bullet lists for structured content."
		);
	});

	const splitState = await page.evaluate(() => {
		const paragraphs = Array.from(document.querySelectorAll("#editor p"));
		const index = paragraphs.findIndex(node => node.textContent.trim() === "Use the heading buttons to promote");
		return {
			first: paragraphs[index]?.textContent.trim(),
			second: paragraphs[index + 1]?.textContent.trim(),
		};
	});

	point = await pointForText(page, "#editor", "heading levels.", "heading".length);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Shift+Enter");

	await page.waitForFunction(() => {
		const paragraph = Array.from(document.querySelectorAll("#editor p")).find(node =>
			node.innerHTML.includes("<br>") && node.textContent.includes("heading levels.")
		);
		return !!paragraph;
	});

	const lineBreakState = await page.evaluate(() => {
		const paragraph = Array.from(document.querySelectorAll("#editor p")).find(node =>
			node.innerHTML.includes("<br>") && node.textContent.includes("heading levels.")
		);
		return paragraph?.innerHTML ?? null;
	});

	point = await pointForText(page, "#editor h1", "Rich Text Editor", "Rich Text Editor".length);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const heading = document.querySelector("#editor h1");
		return heading?.nextElementSibling?.tagName === "P";
	});

	const headingSplitState = await page.evaluate(() => {
		const heading = document.querySelector("#editor h1");
		const next = heading?.nextElementSibling;
		return {
			headingTag: heading?.tagName ?? null,
			nextTag: next?.tagName ?? null,
			nextText: next?.textContent.trim() ?? null,
		};
	});

	point = await pointForText(page, "blockquote p", "great", 0);
	await page.mouse.click(point.x, point.y);
	await page.click('button[data-tag="h1"]');
	point = await pointForText(page, "blockquote h1", "great", "great".length);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const heading = document.querySelector("blockquote h1");
		return heading?.nextElementSibling?.tagName === "P";
	});

	const quoteHeadingSplitState = await page.evaluate(() => {
		const heading = document.querySelector("blockquote h1");
		const next = heading?.nextElementSibling;
		return {
			headingTag: heading?.tagName ?? null,
			nextTag: next?.tagName ?? null,
			insideQuote: !!next?.closest("blockquote"),
		};
	});

	await page.close();
	await browser.close();

	expect(splitState.first).toBe("Use the heading buttons to promote");
	expect(splitState.second).toBe("paragraphs into heading levels. Create bullet lists for structured content.");
	expect(lineBreakState).toContain("<br>");
	expect(headingSplitState.headingTag).toBe("H1");
	expect(headingSplitState.nextTag).toBe("P");
	expect(headingSplitState.nextText).toBe("");
	expect(quoteHeadingSplitState.headingTag).toBe("H1");
	expect(quoteHeadingSplitState.nextTag).toBe("P");
	expect(quoteHeadingSplitState.insideQuote).toBe(true);
});

test("richtext: backspace at block start merges with previous block", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser, "/examples/app-richtext.example.html");

	await page.evaluate(() => {
		const heading = document.querySelector("#editor h1");
		const text = heading.firstChild;
		const range = document.createRange();
		range.setStart(text, "Rich Text ".length);
		range.collapse(true);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const heading = document.querySelector("#editor h1");
		const next = heading?.nextElementSibling;
		return heading?.textContent === "Rich Text " && next?.tagName === "P" && next.textContent === "Editor";
	});

	await page.keyboard.press("Backspace");

	await page.waitForFunction(() => {
		const heading = document.querySelector("#editor h1");
		return heading?.textContent === "Rich Text Editor" && heading.nextElementSibling?.textContent.startsWith("This is a");
	});

	const state = await page.evaluate(() => {
		const selection = window.getSelection();
		const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
		const heading = document.querySelector("#editor h1");
		return {
			headingText: heading?.textContent ?? null,
			nextTag: heading?.nextElementSibling?.tagName ?? null,
			selectionTextBeforeCaret: range && heading ? (() => {
				const before = document.createRange();
				before.selectNodeContents(heading);
				before.setEnd(range.startContainer, range.startOffset);
				return before.toString();
			})() : null,
		};
	});

	await page.close();
	await browser.close();

	expect(state.headingText).toBe("Rich Text Editor");
	expect(state.nextTag).toBe("P");
	expect(state.selectionTextBeforeCaret).toBe("Rich Text ");
});

test("richtext: tab, shift-tab, and delete operate on blocks", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser, "/examples/app-richtext.example.html");

	const point = await pointForText(page, "#editor", "Use the heading buttons", 1);
	await page.mouse.click(point.x, point.y);
	await page.click('button[data-tag="ul"]');
	const endPoint = await pointForText(page, "#editor", "structured content", "structured content".length);
	await page.mouse.click(endPoint.x, endPoint.y);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => document.querySelectorAll("#editor ul > li").length === 2);
	await page.keyboard.press("Delete");
	await page.waitForFunction(() => document.querySelectorAll("#editor ul > li").length === 1);
	await page.keyboard.press("Enter");
	await page.keyboard.type("Nested item");
	await page.keyboard.press("Tab");

	await page.waitForFunction(() => {
		const list = document.querySelector("#editor ul");
		const first = list?.querySelector(":scope > li");
		const nested = first?.querySelector("ul > li");
		return nested?.textContent.trim() === "Nested item";
	});

	await page.keyboard.press("Shift+Tab");

	await page.waitForFunction(() => {
		const list = document.querySelector("#editor ul");
		const items = Array.from(list?.querySelectorAll(":scope > li") ?? []);
		return items.length === 2 && items[1]?.textContent.trim() === "Nested item";
	});

	await selectNodeRange(page, "#editor h3");
	await page.keyboard.press("Delete");

	await page.waitForFunction(() => !document.querySelector("#editor h3"));

	const state = await page.evaluate(() => {
		const list = document.querySelector("#editor ul");
		const items = Array.from(list?.querySelectorAll(":scope > li") ?? []).map(node => node.textContent.trim());
		return {
			items,
			hasHeading: !!document.querySelector("#editor h3"),
		};
	});

	await page.close();
	await browser.close();

	expect(state.items).toEqual([
		"Use the heading buttons to promote paragraphs into heading levels. Create bullet lists for structured content.",
		"Nested item",
	]);
	expect(state.hasHeading).toBe(false);
});

test("richtext: enter on empty blocks exits their container", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser, "/examples/app-richtext.example.html");

	let point = await pointForText(page, "blockquote p", "remove.", "remove.".length);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.querySelectorAll("blockquote p").length === 2);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const quote = document.querySelector("blockquote");
		const next = quote?.nextElementSibling;
		return quote?.querySelectorAll("p").length === 1 && next?.tagName === "P" && next.textContent.trim() === "";
	});

	await page.locator("blockquote + p").click();
	await page.keyboard.type("Outside quote");
	await page.waitForFunction(() => document.querySelector("blockquote + p")?.textContent === "Outside quote");

	let state = await page.evaluate(() => {
		const quote = document.querySelector("blockquote");
		const next = quote?.nextElementSibling;
		return {
			quoteParagraphs: quote ? quote.querySelectorAll("p").length : 0,
			nextTag: next?.tagName ?? null,
			nextText: next?.textContent ?? null,
			nextChildNodes: next ? Array.from(next.childNodes).map(node => ({
				type: node.nodeType,
				text: node.textContent,
			})) : [],
		};
	});

	point = await pointForText(page, "#editor", "Use the heading buttons", 1);
	await page.mouse.click(point.x, point.y);
	await page.click('button[data-tag="ul"]');
	const endPoint = await pointForText(page, "#editor", "structured content", "structured content".length);
	await page.mouse.click(endPoint.x, endPoint.y);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.querySelectorAll("#editor ul > li").length === 2);
	await page.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const list = document.querySelector("#editor ul");
		const next = list?.nextElementSibling;
		return list?.querySelectorAll(":scope > li").length === 1 && next?.tagName === "P" && next.textContent.trim() === "";
	});

	await page.locator("#editor ul + p").click();
	await page.keyboard.type("After list");
	await page.waitForFunction(() => document.querySelector("#editor ul + p")?.textContent === "After list");

	const listState = await page.evaluate(() => {
		const list = document.querySelector("#editor ul");
		const next = list?.nextElementSibling;
		return {
			items: list ? list.querySelectorAll(":scope > li").length : 0,
			nextTag: next?.tagName ?? null,
			nextText: next?.textContent ?? null,
			nextChildNodes: next ? Array.from(next.childNodes).map(node => ({
				type: node.nodeType,
				text: node.textContent,
			})) : [],
		};
	});

	await page.close();
	await browser.close();

	expect(state.quoteParagraphs).toBe(1);
	expect(state.nextTag).toBe("P");
	expect(state.nextText).toBe("Outside quote");
	expect(state.nextChildNodes).toEqual([{ type: 3, text: "Outside quote" }]);
	expect(listState.items).toBe(1);
	expect(listState.nextTag).toBe("P");
	expect(listState.nextText).toBe("After list");
	expect(listState.nextChildNodes).toEqual([{ type: 3, text: "After list" }]);
});
