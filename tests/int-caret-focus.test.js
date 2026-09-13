import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("caret: hides while DOM focus is outside the editor and returns on focus", async () => {
	const result = await loadResult("/tests/int-caret-focus.test.html");

	expect(result.error ?? null).toBeNull();
	expect(result.hasSetFocused).toBe(true);
	expect(result.visibleBefore).toBe("visible");
	expect(result.visibleForeign).toBe("hidden");
	expect(result.visibleReturn).toBe("visible");
	expect(result.visibleApiOff).toBe("hidden");
	expect(result.visibleApiOn).toBe("visible");
});
