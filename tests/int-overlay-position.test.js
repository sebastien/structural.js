import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("bare createElement overlays are absolute and align with text metrics", async () => {
	const result = await loadResult("/tests/int-overlay-position.test.html");
	if (result.error) throw new Error(result.error);

	expect(result.caretPosition).toBe("absolute");
	expect(result.selectionPosition).toBe("absolute");
	expect(result.caretParent).toBe(true);
	expect(result.selectionParent).toBe(true);
	expect(result.caretAlign).toBe(true);
	expect(result.selectionAlign).toBe(true);
	expect(result.caretAfterType).toBe(true);
	expect(result.longCaretAbs).toBe(true);
	expect(result.longMoveMs).toBeLessThan(50);
});
