import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("anchor: cursor stays on its content across external replaces", async () => {
	const result = await loadResult("/tests/int-anchor.test.html");

	expect(result.error).toBeUndefined();
	// Caret glued inside "bravo" despite the insertion before it
	// (inner offset shifts with the block's own growth).
	expect(result.insertBefore).toEqual({ blockText: "ZZ bravo", inner: 5 });
	// Deleted block: legacy numeric offset preserved inside "charlie".
	expect(result.deletedBlock.sameOffset).toBe(true);
	expect(result.deletedBlock.blockText).toBe("charlie");
	// Range tracks "bravo" exactly.
	expect(result.rangeStart).toEqual({ blockText: "ZZ bravo", inner: 0 });
	expect(result.rangeEnd).toEqual({ blockText: "ZZ bravo", inner: 8 });
	// Opt-out keeps the legacy numeric offset.
	expect(result.optOutSameOffset).toBe(true);
	// Explicit selection wins.
	expect(result.explicitSelection).toBe(0);
	// History policy on external replaces.
	expect(result.historyBefore).toBe(true);
	expect(result.historyPreserved).toBe(true);
	expect(result.historyCleared).toBe(false);
});
