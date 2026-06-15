import { test, expect } from "bun:test";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

async function loadResult(browser) {
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
	await page.goto("http://localhost/tests/int-normalizer.test.html");
	await page.waitForFunction(() => window.__result !== undefined);
	const result = await page.evaluate(() => window.__result);
	await page.close();
	return result;
}

test("normalizer: applies schema-driven in-place rules", async () => {
	const browser = await chromium.launch();
	const result = await loadResult(browser);
	await browser.close();

	expect(result.emptyRootHtml).toBe("<p><br></p>");
	expect(result.richHtml).toBe("<p>Hello <strong>bold</strong> mystery</p>");
	expect(result.hasList).toBe(false);
	expect(result.hasQuote).toBe(false);
	expect(result.steps).toContain("renameElement");
	expect(result.steps).toContain("pruneEmpty");
	expect(result.steps).toContain("fillEmpty");
});
