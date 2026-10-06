'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

require('./helpers/setup.js');
const utils = require('../app/utils.js');

describe('getDifficulty / isBlake2bDifficulty', () => {
	test('reads difficulty from a SHA-256d block', () => {
		const block = { difficulty: 127479855693691.4 };

		assert.equal(utils.getDifficulty(block), 127479855693691.4);
		assert.equal(utils.isBlake2bDifficulty(block), false);
	});

	test('reads difficulty_blake2b from a BLAKE2b block', () => {
		const block = { difficulty_blake2b: 1.986469847209289e+19 };

		assert.equal(utils.getDifficulty(block), 1.986469847209289e+19);
		assert.equal(utils.isBlake2bDifficulty(block), true);
	});

	test('prefers difficulty when both are present', () => {
		const block = { difficulty: 5, difficulty_blake2b: 7 };

		assert.equal(utils.getDifficulty(block), 5);
		assert.equal(utils.isBlake2bDifficulty(block), false);
	});

	test('keeps a difficulty of 0', () => {
		assert.equal(utils.getDifficulty({ difficulty: 0 }), 0);
	});

	test('returns undefined when there is neither', () => {
		assert.equal(utils.getDifficulty({}), undefined);
		assert.equal(utils.isBlake2bDifficulty({}), false);
	});
});

describe('formatLargeNumber', () => {
	test('scales a BLAKE2b-sized difficulty to exa', () => {
		const [value, scale] = utils.formatLargeNumber(1.986469847209289e+19, 3);

		assert.equal(value.toString(), '19.865');
		assert.equal(scale.exponent, '18');
	});

	test('scales a SHA-256d-sized difficulty to tera', () => {
		const [value, scale] = utils.formatLargeNumber(127479855693691.4, 3);

		assert.equal(value.toString(), '127.48');
		assert.equal(scale.exponent, '12');
	});

	test('leaves a small number unscaled', () => {
		const [value, scale] = utils.formatLargeNumber(5, 3);

		assert.equal(value.toString(), '5');
		assert.deepEqual(scale, {});
	});

	test('throws for undefined (which is what a missing difficulty used to cause)', () => {
		assert.throws(() => utils.formatLargeNumber(undefined, 3), /DecimalError/);
	});
});

describe('parseNodeVersion', () => {
	const cases = [
		['/Satoshi:29.4.2/Knots:20260508/', '29.4.2', '29.4.2'],
		['/Satoshi:25.0.0/', '25.0.0', '25.0.0'],
		['/Satoshi:27.1.0/Knots:20240801/', '27.1.0', '27.1.0'],
		['/Satoshi:0.21.1.1/', '0.21.1.1', '0.21.1'],
		['/Satoshi:0.18.1/', '0.18.1', '0.18.1'],
	];

	for (const [subversion, version, semver] of cases) {
		test(`${subversion} is ${semver}`, () => {
			assert.deepEqual(utils.parseNodeVersion(subversion), { version, semver });
		});
	}

	test('a version that is not numeric passes every version check', () => {
		assert.deepEqual(utils.parseNodeVersion('/Satoshi:28.1.0.knots/'), { version: '28.1.0.knots', semver: '1000.1000.0' });
	});

	test('an unreadable string passes every version check and has no version', () => {
		assert.deepEqual(utils.parseNodeVersion('/btcd:0.24.0/'), { version: null, semver: '1000.1000.0' });
		assert.deepEqual(utils.parseNodeVersion(undefined), { version: null, semver: '1000.1000.0' });
	});
});
