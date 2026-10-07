import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { plugin, segmentColor } from "../public/js/fork-marker.js";

// a chart that records what is drawn: the x axis shows heights min..max over 100..500 pixels
function fakeChart(min: number, max: number) {
	const calls: unknown[][] = [];
	const ctx = new Proxy({} as Record<string, unknown>, {
		get: (target, name: string) => (name in target ? target[name] : (...args: unknown[]) => { calls.push([name, ...args]); }),
		set: (target, name: string, value) => { calls.push(["set " + name, value]); target[name] = value; return true; }
	});

	return {
		calls,
		chart: { ctx, chartArea: { left: 100, right: 500, top: 10, bottom: 210 }, scales: { x: { min, max, getPixelForValue: (v: number) => 100 + 400 * (v - min) / (max - min) } } }
	};
}

describe("the fork marker", () => {
	test("draws a dashed line from the top to the bottom of the chart at the fork, with its label", () => {
		const { chart, calls } = fakeChart(900000, 1000000);

		plugin(920000, "BLAKE2b", "#C4402A").afterDatasetsDraw(chart as never);

		const x = 100 + 400 * 20000 / 100000;

		assert.deepEqual(calls.find(c => c[0] == "moveTo"), ["moveTo", x, 10]);
		assert.deepEqual(calls.find(c => c[0] == "lineTo"), ["lineTo", x, 210]);
		assert.deepEqual(calls.find(c => c[0] == "setLineDash"), ["setLineDash", [5, 4]]);
		assert.deepEqual(calls.find(c => c[0] == "fillText"), ["fillText", "BLAKE2b", x + 4, 22]);
		assert.deepEqual(calls.find(c => c[0] == "set textAlign"), ["set textAlign", "left"]);
		assert.deepEqual(calls.find(c => c[0] == "set strokeStyle"), ["set strokeStyle", "#C4402A"]);
	});

	test("the label is on the left of the line when the line is in the right half", () => {
		const { chart, calls } = fakeChart(900000, 1000000);

		plugin(990000, "BLAKE2b", "red").afterDatasetsDraw(chart as never);

		const x = 100 + 400 * 90000 / 100000;

		assert.deepEqual(calls.find(c => c[0] == "fillText"), ["fillText", "BLAKE2b", x - 4, 22]);
		assert.deepEqual(calls.find(c => c[0] == "set textAlign"), ["set textAlign", "right"]);
	});

	test("nothing is drawn without a fork height, or when it is outside the chart", () => {
		for (const [height, min, max] of [[null, 900000, 1000000], [undefined, 900000, 1000000], [899999, 900000, 1000000], [1000001, 900000, 1000000]]) {
			const { chart, calls } = fakeChart(min as number, max as number);

			plugin(height as never, "BLAKE2b", "red").afterDatasetsDraw(chart as never);

			assert.deepEqual(calls, [], String(height));
		}
	});

	test("the fork itself at the edge of the chart is drawn", () => {
		const { chart, calls } = fakeChart(960000, 1000000);

		plugin(960000, "BLAKE2b", "red").afterDatasetsDraw(chart as never);

		assert.ok(calls.some(c => c[0] == "moveTo"));
	});

	test("a chart without scales or an area is left alone", () => {
		assert.doesNotThrow(() => plugin(960000, "x", "red").afterDatasetsDraw({ ctx: {}, scales: {}, chartArea: undefined } as never));
	});
});

describe("segmentColor", () => {
	const color = segmentColor(960000, "grey", "red");
	const piece = (x: number) => ({ p1: { parsed: { x } } });

	test("a piece that ends before the fork has the first color, one that ends at or after it the second", () => {
		assert.equal(color(piece(959999) as never), "grey");
		assert.equal(color(piece(960000) as never), "red");
		assert.equal(color(piece(970000) as never), "red");
	});

	test("without a fork height every piece has the second color", () => {
		assert.equal(segmentColor(null, "grey", "red")(piece(1) as never), "red");
	});
});
