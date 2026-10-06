import assert from "node:assert/strict";
import { describe, test } from "node:test";
import moment from "moment";
import "moment-duration-format";
import * as text from "../app/helpers/text.js";
import * as collections from "../app/helpers/collections.js";
import * as random from "../app/helpers/random.js";
import * as color from "../app/helpers/color.js";
import * as node from "../app/helpers/node.js";

describe('text helpers', () => {
	test('formatHex decodes hex', () => {
		assert.equal(text.formatHex('48656c6c6f'), 'Hello');
		assert.equal(text.formatHex('00ff', 'hex'), '00ff');
	});

	test('getRandomString uses only the given characters', () => {
		assert.match(text.getRandomString(50, 'a'), /^[a-z]{50}$/);
		assert.match(text.getRandomString(50, 'A#'), /^[A-Z0-9]{50}$/);
	});

	test('addThousandsSeparators', () => {
		assert.equal(text.addThousandsSeparators(1234567), '1,234,567');
		assert.equal(text.addThousandsSeparators(999), '999');
		assert.equal(text.addThousandsSeparators(1234.5678), '1,234.5678');
		assert.equal(text.addThousandsSeparators('12345678'), '12,345,678');
	});

	test('ellipsize', () => {
		assert.equal(text.ellipsize('abcdef', 10), 'abcdef');
		assert.equal(text.ellipsize('abcdefghij', 5), 'abcd…');
		assert.equal(text.ellipsize('abcdefghij', 5, '...'), 'ab...');
	});

	test('ellipsizeMiddle keeps start and end', () => {
		assert.equal(text.ellipsizeMiddle('abcdef', 10), 'abcdef');
		assert.equal(text.ellipsizeMiddle('0123456789abcdef', 7), '012…def');
	});

	test('parseExponentStringDouble expands exponents', () => {
		assert.equal(text.parseExponentStringDouble('1.5e-7'), '0.00000015');
		assert.equal(text.parseExponentStringDouble('1.5e+20'), '150000000000000000000');
	});

	test('summarizeDuration', () => {
		assert.equal(text.summarizeDuration(moment.duration(90061, 'seconds'), { oneElement: true }), '1d');
		assert.match(text.summarizeDuration(moment.duration(90061, 'seconds')), /^1d, 1hr/);
	});
});

describe('collection helpers', () => {
	test('splitArrayIntoChunks', () => {
		assert.deepEqual(collections.splitArrayIntoChunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
		assert.deepEqual(collections.splitArrayIntoChunks([], 3), []);
	});

	test('splitArrayIntoChunksByChunkCount spreads items over the chunks', () => {
		assert.deepEqual(collections.splitArrayIntoChunksByChunkCount([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5], [6, 7]]);
	});

	test('objectProperties lists own keys', () => {
		assert.deepEqual(collections.objectProperties({ a: 1, b: 2 }), ['a', 'b']);
		assert.equal(collections.objHasProperty({ a: 1 }, 'a'), true);
		assert.equal(collections.objHasProperty({}, 'toString'), false);
	});

	test('stringifySimple', () => {
		assert.equal(collections.stringifySimple({ a: 1, b: 'x' }), '{"a":1,"b":"x"}');
	});

	test('obfuscateProperties copies and hides', () => {
		const original = { user: 'u', password: 'p' };
		const hidden = collections.obfuscateProperties(original, ['password']);
		assert.deepEqual(hidden, { user: 'u', password: '*****' });
		assert.equal(original.password, 'p');
	});

	test('sleep waits', async () => {
		const start = Date.now();
		await collections.sleep(20);
		assert.ok(Date.now() - start >= 15);
	});
});

describe('random helpers', () => {
	test('seededRandom is deterministic and within [0, 1)', () => {
		assert.equal(random.seededRandom(42), random.seededRandom(42));
		const r = random.seededRandom(7);
		assert.ok(r >= 0 && r < 1);
	});

	test('seededRandomIntBetween is not rounded and stays in [min, max)', () => {
		for (let i = 0; i < 50; i++) {
			const v = random.seededRandomIntBetween(i, 5, 9);
			assert.ok(v >= 5 && v < 9, String(v));
		}
	});

	test('randomInt returns a whole number in [min, min + span)', () => {
		for (let i = 0; i < 50; i++) {
			const v = random.randomInt(5, 4);
			assert.ok(Number.isInteger(v) && v >= 5 && v <= 8, String(v));
		}
	});
});

describe('color helpers', () => {
	test('colorHexToRgb', () => {
		assert.deepEqual(color.colorHexToRgb('#ff0000'), { r: 255, g: 0, b: 0 });
		assert.deepEqual(color.colorHexToRgb('00ff00'), { r: 0, g: 255, b: 0 });
		assert.equal(color.colorHexToRgb('nope'), null);
	});

	test('rgbToHsl and colorHexToHsl', () => {
		assert.deepEqual(color.rgbToHsl(255, 255, 255), { h: 0, s: 0, l: 1 });
		assert.deepEqual(color.colorHexToHsl('#ff0000'), color.rgbToHsl(255, 0, 0));
	});
});

describe('node helpers', () => {
	test('parseNodeVersion', () => {
		assert.deepEqual(node.parseNodeVersion('/Satoshi:29.4.2/Knots:20260508/'), { version: '29.4.2', semver: '29.4.2' });
		assert.equal(node.parseNodeVersion('/Satoshi:0.21.0.1/').semver, '0.21.0');
		assert.deepEqual(node.parseNodeVersion(undefined), { version: null, semver: '1000.1000.0' });
	});

	test('getDifficulty prefers difficulty, falls back to difficulty_blake2b', () => {
		assert.equal(node.getDifficulty({ difficulty: 5 }), 5);
		assert.equal(node.getDifficulty({ difficulty_blake2b: 7 }), 7);
		assert.equal(node.isBlake2bDifficulty({ difficulty_blake2b: 7 }), true);
		assert.equal(node.isBlake2bDifficulty({ difficulty: 5 }), false);
	});
});
