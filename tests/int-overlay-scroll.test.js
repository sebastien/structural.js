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
	await page.goto("http://localhost/tests/int-overlay-scroll.test.html");
	await page.waitForFunction(() => window.__result !== undefined);
	return page;
}

test("virtual overlays mount beside editor and scroll with overflow container", async () => {
	const browser = await chromium.launch();
	const page = await loadPage(browser);
	const result = await page.evaluate(() => window.__result);
	await page.close();
	await browser.close();
	if (result.error) throw new Error(result.error);

	expect(result.mountedUnderShell).toBe(true);
	expect(result.notUnderBody).toBe(true);
	expect(result.blocksAlign).toBe(true);
	expect(result.caretAlign).toBe(true);
	expect(result.freeScrollSync).toBe(true);
	expect(result.blocksAfterCount).toBeGreaterThan(0);
});
