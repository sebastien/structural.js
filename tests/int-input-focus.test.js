import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("input: ignores keydown and mouse when focus/target is outside the editor", async () => {
	const result = await loadResult("/tests/int-input-focus.test.html");

	expect(result.afterForeign).toBe(result.baseline);
	expect(result.foreignOffset).toBe(result.baselineOffset);
	expect(result.foreignPrintable).toBe(false);
	expect(result.foreignBackspace).toBe(false);
	expect(result.foreignEnter).toBe(false);
	expect(result.afterForeignInput).toBe(result.baseline);
	expect(result.foreignInputPrintable).toBe(false);
	expect(result.afterForeignClick.text).toBe(result.baseline);
	expect(result.afterForeignClick.selectionKind).toBe(result.baselineKind);
	expect(result.afterForeignClick.offset).toBe(result.baselineOffset);
	expect(result.afterForeignClick.foreignSel).toEqual(result.foreignSelBefore);
	expect(result.editorPrintable).toBe(true);
	expect(result.afterEditor).not.toBe(result.baseline);
	expect(result.afterEditorClick.selectionKind).toBe("range");
	expect(result.afterEditorClick.range).toBeTruthy();
});
