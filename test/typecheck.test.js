'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { compare, parseErrors } = require('../bin/typecheck.js');

describe('type check baseline', () => {
	test('parseErrors keeps the file, code and message, and drops the position', () => {
		const output = [
			"routes/a.js(12,5): error TS2339: Property 'x' does not exist on type 'Y'.",
			"  Type 'Y' has no property 'x'.",
			"app/b.js(3,1): error TS2304: Cannot find name 'z'.",
			'Found 2 errors.'
		].join('\n');

		assert.deepEqual(parseErrors(output), [
			"app/b.js: TS2304: Cannot find name 'z'.",
			"routes/a.js: TS2339: Property 'x' does not exist on type 'Y'."
		]);
	});

	test('the same finding at another line is the same finding', () => {
		assert.deepEqual(
			parseErrors("a.js(1,1): error TS1: m"),
			parseErrors("a.js(99,7): error TS1: m")
		);
	});

	test('nothing new when the findings equal the baseline', () => {
		assert.deepEqual(compare(['a', 'b'], ['b', 'a']), { added: [], fixed: [] });
	});

	test('a finding that is not in the baseline is new', () => {
		assert.deepEqual(compare(['a', 'b', 'c'], ['a', 'b']), { added: ['c'], fixed: [] });
	});

	test('a finding that is gone is reported as fixed, and is not an error', () => {
		assert.deepEqual(compare(['a'], ['a', 'b']), { added: [], fixed: ['b'] });
	});

	test('a second copy of a recorded finding is new', () => {
		assert.deepEqual(compare(['a', 'a'], ['a']), { added: ['a'], fixed: [] });
	});
});
