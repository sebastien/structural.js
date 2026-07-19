import { expect, test } from "bun:test";
import { installBrowserLifecycle, loadResult } from "./playwright-harness.js";

installBrowserLifecycle();

test("command: serializable command and transaction objects", async () => {
	const result = await loadResult("/tests/int-command.test.html");

	expect(result).toEqual({
		stringCommand: {
			type: "toggleInline",
			actor: "agent",
			args: { value: "strong" },
			selection: { offset: 12, selectionKind: "caret" },
			mode: null,
			meta: {},
		},
		objectCommand: {
			type: "toggleBlock",
			actor: "local",
			args: { tag: "h2" },
			selection: null,
			mode: "insert",
			meta: { source: "keymap" },
		},
		transaction: {
			handled: true,
			json: {
				command: {
					type: "splitBlock",
					actor: "local",
					args: {},
					selection: null,
					mode: null,
					meta: {},
				},
				steps: [{ type: "splitNode", path: [0], offset: 3 }],
				inverse: [{ type: "mergeNode", path: [0] }],
				selectionBefore: { offset: 3 },
				selectionAfter: { offset: 4 },
				result: true,
			},
		},
		keys: {
			ctrlR: false,
			f5: false,
			ctrlB: true,
		},
		defaultKeymap: {
			shiftRight: true,
			shifted: { start: 1, end: 2 },
			selectAll: true,
			selectedWholeEditor: true,
			collapse: true,
			selectionKind: "caret",
		},
	});
});
