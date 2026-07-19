import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("virtual overlays mount beside editor and scroll with overflow container", async () => {
	const result = await loadResult("/tests/int-overlay-scroll.test.html");
	if (result.error) throw new Error(result.error);

	expect(result.mountedUnderShell).toBe(true);
	expect(result.notUnderBody).toBe(true);
	expect(result.blocksAlign).toBe(true);
	expect(result.caretAlign).toBe(true);
	expect(result.freeScrollSync).toBe(true);
	expect(result.blocksAfterCount).toBeGreaterThan(0);
});
