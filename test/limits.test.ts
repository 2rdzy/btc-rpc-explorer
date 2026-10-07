import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blockRangeError, maxBlockRange, maxHeightListLength, parseHeightList } from "../app/helpers/limits.js";

describe("blockRangeError", () => {
	test("a range of the allowed size is fine", () => {
		assert.equal(blockRangeError(0, 0), null);
		assert.equal(blockRangeError(975000, 975143), null);
		assert.equal(blockRangeError(100, 100 + maxBlockRange - 1), null);
	});

	test("a range that is too long is refused", () => {
		assert.match(blockRangeError(100, 100 + maxBlockRange)!, /At most 10,000 blocks/);
		assert.match(blockRangeError(0, 975000)!, /At most/);
	});

	test("a range that is no range is refused", () => {
		for (const [start, end] of [[-1, 5], [10, 5], [NaN, 5], [5, NaN], [1.5, 3], [0, Infinity], [-100000 * 144, 975000]]) {
			assert.match(blockRangeError(start, end)!, /whole numbers/, `${start}-${end}`);
		}
	});
});

describe("parseHeightList", () => {
	test("heights are read in order", () => {
		assert.deepEqual(parseHeightList("975699,975700"), [975699, 975700]);
		assert.deepEqual(parseHeightList("0"), [0]);
	});

	test("the longest list allowed is fine, one more is not", () => {
		assert.equal(parseHeightList(Array(maxHeightListLength).fill("1").join(","))!.length, maxHeightListLength);
		assert.equal(parseHeightList(Array(maxHeightListLength + 1).fill("1").join(",")), null);
	});

	test("anything that is no height refuses the list", () => {
		for (const list of ["", "abc", "1,,2", "1,2,", "-1", "1.5", "1e3", " 1", "0x10", "1234567890", "1,abc"]) {
			assert.equal(parseHeightList(list), null, JSON.stringify(list));
		}
	});
});
