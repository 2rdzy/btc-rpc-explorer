import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { summarizeData } from "../public/js/difficulty-history-data.js";

const yearItems: [string, number][] = [['All Time', 1000], ['1y', 1], ['5y', 5]];

// epochs 0..count-1, starting every 2016 blocks; difficulty(i) gives each epoch's difficulty and
// firstBlake2b the first epoch that uses BLAKE2b
function rawData(count: number, { difficulty = (i: number) => 100 + i, firstBlake2b = null }: { difficulty?: (i: number) => number, firstBlake2b?: number | null } = {}) {
	const raw: { heights: number[], [height: string]: unknown } = { heights: [] };

	for (let i = 0; i < count; i++) {
		const height = i * 2016;

		raw.heights.push(height);
		raw[`${height}`] = { difficulty: difficulty(i), time: 1231006505 + i * 1209600, blake2b: firstBlake2b != null && i >= firstBlake2b };
	}

	return raw;
}

describe('summarizeData', () => {
	test('lists one entry per epoch, in height order, even if the heights arrive unsorted', () => {
		const raw = rawData(4);
		raw.heights.reverse();

		const summary = summarizeData(raw, yearItems);

		assert.deepEqual(summary.difficultyData.map(item => item.epoch), [0, 1, 2, 3]);
		assert.deepEqual(summary.difficultyData.map(item => item.difficulty), [100, 101, 102, 103]);
	});

	test('computes each epoch\'s change in percent, with no change for the first', () => {
		const summary = summarizeData(rawData(3, { difficulty: i => [100, 110, 99][i] }), yearItems);

		assert.equal(summary.difficultyDeltaData[0].difficultyDelta, undefined);
		assert.ok(Math.abs(summary.difficultyDeltaData[1].difficultyDelta! - 10) < 1e-9);
		assert.ok(Math.abs(summary.difficultyDeltaData[2].difficultyDelta! - (-10)) < 1e-9);
	});

	test('keeps the real change in the table data and clamps only the chart to plus or minus 100', () => {
		const summary = summarizeData(rawData(3, { difficulty: i => [100, 1000, 1][i] }), yearItems);

		assert.equal(summary.difficultyDeltaData[1].difficultyDelta, 900);
		assert.equal(summary.changeGraphData_years[1000][1].y, 100);
		assert.ok(Math.abs(summary.changeGraphData_years[1000][2].y! - (-100)) < 0.5);
		assert.ok(summary.changeGraphData_years[1000][2].y! >= -100);
	});

	describe('on a SHA-256d only chain', () => {
		const summary = summarizeData(rawData(5), yearItems);

		test('has no BLAKE2b epoch and an empty BLAKE2b series', () => {
			assert.equal(summary.firstBlake2bEpoch, null);
			assert.deepEqual(summary.blake2bGraphData_years[1000], []);
			assert.equal(summary.graphData_years[1000].length, 5);
			assert.ok(summary.difficultyData.every(item => item.blake2b === false));
		});
	});

	describe('across the switch to BLAKE2b', () => {
		// epochs 0-3 are SHA-256d (difficulty about 1e14), epochs 4-6 are BLAKE2b (about 1e19)
		const raw = rawData(7, { difficulty: i => (i < 4 ? 1e14 * (1 + i / 100) : 1e19 * (1 + i / 100)), firstBlake2b: 4 });
		const summary = summarizeData(raw, yearItems);

		test('finds the first BLAKE2b epoch and flags the epochs', () => {
			assert.equal(summary.firstBlake2bEpoch, 4);
			assert.deepEqual(summary.difficultyData.map(item => item.blake2b), [false, false, false, false, true, true, true]);
		});

		test('puts each epoch in the series of its own algorithm', () => {
			assert.deepEqual(summary.graphData_years[1000].map(p => p.x), [0, 1, 2, 3]);
			assert.deepEqual(summary.blake2bGraphData_years[1000].map(p => p.x), [4, 5, 6]);
			assert.ok(summary.graphData_years[1000].every(p => p.y! < 1e15));
			assert.ok(summary.blake2bGraphData_years[1000].every(p => p.y! > 1e18));
		});

		test('shows no percentage across the switch, only an algorithm change', () => {
			const delta = summary.difficultyDeltaData[4];

			assert.equal(delta.algorithmChange, true);
			assert.equal(delta.difficultyDelta, undefined);
		});

		test('leaves a gap in the change chart at the switch and keeps the rest', () => {
			const changes = summary.changeGraphData_years[1000];

			assert.equal(changes.length, 7);
			assert.equal(changes[4].y, null);
			assert.ok(changes.filter((p, i) => i !== 4).every(p => typeof p.y === 'number'));
		});

		test('compares epochs of the same algorithm normally on both sides of the switch', () => {
			assert.ok(summary.difficultyDeltaData[3].difficultyDelta! > 0);
			assert.ok(summary.difficultyDeltaData[5].difficultyDelta! > 0);
			assert.ok(summary.difficultyDeltaData[5].difficultyDelta! < 5);
		});
	});

	test('a chain that is BLAKE2b from the first epoch has no switch', () => {
		const summary = summarizeData(rawData(3, { firstBlake2b: 0 }), yearItems);

		assert.equal(summary.firstBlake2bEpoch, 0);
		assert.ok(summary.difficultyDeltaData.every(item => !item.algorithmChange));
	});

	test('the one year window holds only the most recent epochs', () => {
		const summary = summarizeData(rawData(60), yearItems);
		const lastYear = summary.graphData_years[1];

		assert.ok(lastYear.length > 0 && lastYear.length < 60);
		assert.equal(lastYear[lastYear.length - 1].x, 59);
		assert.equal(summary.graphData_years[1000].length, 60);
	});
});
