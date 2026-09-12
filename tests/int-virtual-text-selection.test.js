import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("virtual-text selection renders literal text instead of structural bounds", async () => {
	const result = await loadResult("/tests/int-virtual-text-selection.test.html");
	if (result.error) throw new Error(result.error);

	expect(result).toEqual({
		structuralText: "BCD",
		displayText: "CD",
		nativeText: "CD",
		overlays: 2,
	});
});
