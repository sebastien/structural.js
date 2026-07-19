import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("clipboard: copy, cut, paste, foreign ignore, Mod+C/X/V swallowed", async () => {
	const result = await loadResult("/tests/int-clipboard.test.html");

	expect(result.copied).toBe(true);
	expect(result.afterCopy).toBe("hello world");
	expect(result.cutOk).toBe(true);
	expect(result.afterCut).toBe(" world");
	expect(result.afterUndoCut).toBe("hello world");
	expect(result.pasteOk).toBe(true);
	expect(result.afterPaste).toBe("hello world!");
	expect(result.ownsForeign).toBe(false);
	expect(result.foreignCopy).toBe(false);
	expect(result.afterForeign).toBe(result.beforeForeign);
	expect(result.eventPasteOk).toBe(true);
	expect(result.afterEventPaste.includes("PASTE")).toBe(true);
	expect(result.pasteEventPrevented).toBe(true);
	expect(result.modC).toBe(true);
	expect(result.modX).toBe(true);
});
