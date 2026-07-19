import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("normalizer: applies schema-driven in-place rules", async () => {
	const result = await loadResult("/tests/int-normalizer.test.html");

	expect(result.emptyRootHtml).toBe("<p><br></p>");
	expect(result.placeholderHtml).toBe("<p><br></p>");
	expect(result.richHtml).toBe("<p>Hello <strong>bold</strong> mystery</p>");
	expect(result.hasList).toBe(false);
	expect(result.hasQuote).toBe(false);
	expect(result.steps).toContain("renameElement");
	expect(result.steps).toContain("pruneEmpty");
	expect(result.steps).toContain("fillEmpty");
});
