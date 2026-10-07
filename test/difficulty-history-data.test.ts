import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hashesPerBlock, SHA256D_HASHES_PER_DIFFICULTY, summarizeData } from "../public/js/difficulty-history-data.js";

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

describe('hashesPerBlock', () => {
	test('is the difficulty times 2^48 / 0xffff for SHA-256d, and the difficulty itself for BLAKE2b', () => {
		assert.equal(SHA256D_HASHES_PER_DIFFICULTY, Math.round(2 ** 48 / 0xffff));
		assert.equal(hashesPerBlock(1, false), 4295032833);
		assert.equal(hashesPerBlock(1.27e14, false), 1.27e14 * 4295032833);
		assert.equal(hashesPerBlock(2.18e19, true), 2.18e19);
	});

	test('agrees with the network hash rate of Bitcoin: difficulty 1.27e14 is about 900 EH/s', () => {
		const hashesPerSecond = hashesPerBlock(1.2748e14, false) / 600;

		assert.ok(hashesPerSecond > 8.9e20 && hashesPerSecond < 9.2e20, String(hashesPerSecond));
	});
});

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
		});

		test('puts both on one scale: the expected number of hashes per block', () => {
			// SHA-256d difficulty about 1e14 is about 4.3e23 hashes, BLAKE2b about 1e19 is already hashes
			assert.ok(summary.graphData_years[1000].every(p => p.y! > 4e23 && p.y! < 5e23));
			assert.ok(summary.blake2bGraphData_years[1000].every(p => p.y! > 1e19 && p.y! < 2e19));
			assert.equal(summary.difficultyData[0].hashes, 1e14 * SHA256D_HASHES_PER_DIFFICULTY);
			assert.equal(summary.difficultyData[0].difficulty, 1e14);
			assert.equal(summary.difficultyData[4].hashes, summary.difficultyData[4].difficulty);
		});

		test('shows the fall of the work per block at the switch, flagged as an algorithm change', () => {
			const delta = summary.difficultyDeltaData[4];

			assert.equal(delta.algorithmChange, true);
			assert.ok(delta.difficultyDelta! < -99.99);
			assert.ok(delta.difficultyDelta! > -100);
		});

		test('puts the switch in the change chart too: almost -100%', () => {
			const changes = summary.changeGraphData_years[1000];

			assert.equal(changes.length, 7);
			assert.ok(changes[4].y! < -99.99 && changes[4].y! >= -100);
			assert.ok(changes.every(p => typeof p.y === 'number'));
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
