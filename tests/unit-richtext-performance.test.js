import { expect, test } from "bun:test";
import { TextAdapter } from "../src/js/structural/text.js";

if (!globalThis.Node) {
	globalThis.Node = { TEXT_NODE: 3 };
}

const FRAME_BUDGET_MS = 1000 / 60;
const REPORTED_LOAN_PARAGRAPH =
	"Antony Barbara Head (43) and Leonard Bertha Ballard (45) arasdase married NZ citizens. Both own their home and reside together. Antony is employed FT with an annual income of $62,400. Leonard is employed PT with an annual income of $31,148. The application is for a top-up loan in their personal names.";
const LONG_SINGLE_PARAGRAPH =
	"Use the heading buttons to promote paragraphs into heading levels. Create bullet lists for structured content." +
	REPORTED_LOAN_PARAGRAPH.repeat(10);

function percentile95(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function slotsFor(adapter, node) {
	return adapter._graphemeBoundaries(node.data, node).map((offset, index) => ({
		index,
		point: { node, offset },
		graphemeIndex: index,
	}));
}

test("performance: long paragraph input processing stays within a 60 FPS frame", () => {
	const adapter = new TextAdapter(null);
	const node = { nodeType: Node.TEXT_NODE, data: LONG_SINGLE_PARAGRAPH };
	const midpoint = Math.floor(node.data.length / 2);
	const samples = [];

	// Simulate the synchronous cache work done after each input event: mutate one
	// long text node, rebuild its caret slots, and rebuild text-offset prefixes.
	for (let frame = 0; frame < 60; frame += 1) {
		const started = performance.now();
		node.data = `${node.data.slice(0, midpoint)}x${node.data.slice(midpoint)}`;
		adapter._graphemeCache.delete(node);
		adapter._positions = slotsFor(adapter, node);
		adapter._blockOrder = [];
		adapter._rebuildPrefixTextOffsets();
		samples.push(performance.now() - started);
	}

	const expectedGraphemeCount = adapter._graphemeBoundaries(node.data, node).length - 1;
	expect(LONG_SINGLE_PARAGRAPH.length).toBeGreaterThanOrEqual(3000);
	expect(adapter._prefixTextOffsets).toHaveLength(expectedGraphemeCount + 1);
	expect(adapter._prefixTextOffsets.at(-1)).toBe(expectedGraphemeCount);

	const p95 = percentile95(samples);
	if (p95 > FRAME_BUDGET_MS) {
		throw new Error(
			`long-paragraph input processing p95=${p95.toFixed(2)}ms exceeds the ${FRAME_BUDGET_MS.toFixed(2)}ms 60 FPS frame budget; samples=${JSON.stringify(samples)}`,
		);
	}
});
