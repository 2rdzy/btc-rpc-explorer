'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { queryInt, queryString, queryStringList } = require('../app/request.js');

describe('queryString', () => {
	test('returns a string value', () => assert.equal(queryString({ a: 'x' }, 'a'), 'x'));
	test('returns an empty string as it is', () => assert.equal(queryString({ a: '' }, 'a', 'd'), ''));
	test('returns the first of a repeated parameter', () => assert.equal(queryString({ a: ['x', 'y'] }, 'a'), 'x'));
	test('returns the default for a missing parameter', () => assert.equal(queryString({}, 'a', 'd'), 'd'));
	test('returns the default for an object (?a[b]=1)', () => assert.equal(queryString({ a: { b: '1' } }, 'a', 'd'), 'd'));
	test('returns the default for an array of objects', () => assert.equal(queryString({ a: [{ b: '1' }] }, 'a', 'd'), 'd'));
	test('returns the default for an empty array', () => assert.equal(queryString({ a: [] }, 'a', 'd'), 'd'));
	test('copes with no query at all', () => assert.equal(queryString(undefined, 'a', 'd'), 'd'));
	test('does not return inherited properties as parameters', () => assert.equal(queryString({}, 'constructor', 'd'), 'd'));
});

describe('queryInt', () => {
	test('parses a whole number', () => assert.equal(queryInt({ n: '25' }, 'n', 10), 25));
	test('parses a negative number and zero', () => {
		assert.equal(queryInt({ n: '-3' }, 'n', 10), -3);
		assert.equal(queryInt({ n: '0' }, 'n', 10), 0);
	});
	test('cuts a decimal number at the point, as parseInt does', () => assert.equal(queryInt({ n: '2.9' }, 'n', 10), 2));
	test('returns the default for text', () => assert.equal(queryInt({ n: 'abc' }, 'n', 10), 10));
	test('returns the default for an empty value', () => assert.equal(queryInt({ n: '' }, 'n', 10), 10));
	test('returns the default for a missing parameter', () => assert.equal(queryInt({}, 'n', 10), 10));
	test('returns the default for an object', () => assert.equal(queryInt({ n: { a: '1' } }, 'n', 10), 10));
	test('uses the first of a repeated parameter', () => assert.equal(queryInt({ n: ['7', '9'] }, 'n', 10), 7));
	test('returns undefined when there is no default and no number', () => assert.equal(queryInt({ n: 'x' }, 'n'), undefined));
});

describe('queryStringList', () => {
	test('returns the values of an indexed list', () => assert.deepEqual(queryStringList({ args: ['975700', 'x'] }, 'args'), ['975700', 'x']));
	test('treats a single value as a list of one', () => assert.deepEqual(queryStringList({ args: '975700' }, 'args'), ['975700']));
	test('turns anything that is not a string into null, keeping the places of the others', () => {
		assert.deepEqual(queryStringList({ args: ['a', { b: '1' }, ['c']] }, 'args'), ['a', null, null]);
	});
	test('gives an empty list for a missing parameter or an object', () => {
		assert.deepEqual(queryStringList({}, 'args'), []);
		assert.deepEqual(queryStringList({ args: { 0: 'a' } }, 'args'), []);
		assert.deepEqual(queryStringList(undefined, 'args'), []);
	});
});
