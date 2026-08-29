import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	closePage,
	installBrowserLifecycle,
	loadPath,
} from "./playwright-harness.js";
import { cases } from "./int-richtext-contract-cases.js";

installBrowserLifecycle();

let page = null;

beforeAll(async () => {
	page = await loadPath("/tests/int-richtext-contract.html");
	await page.waitForFunction(() => window.__test && window.__editor);
});

afterAll(async () => {
	await closePage(page);
	page = null;
});

for (const c of cases) {
	test(`${c.group}: ${c.name}`, async () => {
		const result = await page.evaluate((spec) => window.__test.runOne(spec), c);
		expect(result.actual).toBe(result.expected);
	});
}
