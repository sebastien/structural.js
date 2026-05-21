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
	await page.waitForFunction(() => window.__result !== undefined);
	const result = await page.evaluate(() => window.__result);
	await page.close();
	return result;
}

test("static: overlapping inline across existing <em>", async () => {
	const browser = await chromium.launch();
	const result = await loadTest(browser, "/tests/int-mod-static.test.html");
	await browser.close();
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});

test("navigate: simulate keystroke selection after toggle", async () => {
	const browser = await chromium.launch();
	const result = await loadTest(browser, "/tests/int-mod-navigate.test.html");
	await browser.close();
	if (result.error) throw new Error(result.error);
	expect(result.pass).toBe(true);
});
