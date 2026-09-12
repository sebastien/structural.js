import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("controllers: subtree range snapshots and native selection sync", async () => {
	const result = await loadResult("/tests/int-range-selection.test.html");
	if (result.error) throw new Error(result.error);

	expect(result).toEqual({
		synced: true,
		snapshot: { start: 4, end: 14 },
		restored: true,
		restoredText: "ct some te",
		html: "Sele<em>ct some te</em>xt",
		reverseNativeDirection: true,
		collapsedSync: true,
		collapsedOffset: 2,
		collapsedSnapshot: null,
		placedInside: true,
		placedInsideOffset: 7,
		snappedToEnd: true,
		snappedOffset: 16,
		selectionKind: "caret",
	});
});
