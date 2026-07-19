import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("history: undo/redo restore text and Mod+Z is swallowed", async () => {
	const result = await loadResult("/tests/int-history.test.html");

	expect(result.baseline).toBe("hello");
	expect(result.afterInsert).toBe("hello!");
	expect(result.canUndoAfterInsert).toBe(true);
	expect(result.afterUndo).toBe("hello");
	expect(result.canRedoAfterUndo).toBe(true);
	expect(result.afterRedo).toBe("hello!");
	expect(result.afterSecondUndo).toBe("hello!");
	expect(result.modZPrevented).toBe(true);
	expect(result.afterModZ).toBe("hello");
});
