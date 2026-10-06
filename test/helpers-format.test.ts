import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import "./helpers/setup.js";
import "../app/currencies.js";
import * as currency from "../app/helpers/currency.js";
import * as errors from "../app/helpers/errors.js";
import * as outputTypes from "../app/helpers/outputTypes.js";

describe('output type helpers', () => {
	test('abbreviations and names', () => {
		assert.equal(outputTypes.outputTypeAbbreviation('witness_v1_taproot'), 'P2TR');
		assert.equal(outputTypes.outputTypeName('pubkeyhash'), 'Pay to Public Key Hash');
		assert.equal(outputTypes.outputTypeAbbreviation('nulldata'), 'nulldata');
	});

	test('unknown types, including inherited property names, give ???', () => {
		assert.equal(outputTypes.outputTypeAbbreviation('foo'), '???');
		assert.equal(outputTypes.outputTypeName('toString'), '???');
		assert.equal(outputTypes.outputTypeAbbreviation('constructor'), '???');
	});

	test('asHash, asHashOrHeight and asAddress strip other characters', () => {
		assert.equal(outputTypes.asHash('ab12 XY!z9'), 'ab129');
		assert.equal(outputTypes.asHashOrHeight('961640'), 961640);
		assert.equal(outputTypes.asHashOrHeight('ab12 XY'), 'ab12');
		assert.equal(outputTypes.asAddress('bc1q-abc 123!'), 'bc1qabc123');
	});
});

describe('large numbers', () => {
	test('formatLargeNumber picks the scale', () => {
		const [value, scale] = currency.formatLargeNumber(1234567, 2);
		assert.equal(value.toString(), '1.23');
		assert.equal(scale.abbreviation, 'M');

		const [small, none] = currency.formatLargeNumber(12.3456, 2);
		assert.equal(small.toString(), '12.35');
		assert.deepEqual(none, {});
	});

	test('formatLargeNumberSignificant keeps the significant digits', () => {
		const [value, scale] = currency.formatLargeNumberSignificant(123456789, 4);
		assert.equal(value.toString(), '123.5');
		assert.equal(scale.abbreviation, 'M');
	});
});

describe('currency formatting', () => {
	beforeEach(() => {
		global.exchangeRates = { usd: 60000, eur: 55000 };
		global.goldExchangeRates = { usd: 2500 };
		global.currencySymbols = { usd: '$', eur: '€' };
	});

	afterEach(() => {
		global.exchangeRates = null;
		global.goldExchangeRates = null;
	});

	test('native amounts strip even trailing zeroes only', () => {
		assert.equal(currency.formatCurrencyAmount(0.1, 'btc').simpleVal, '0.1');
		assert.equal(currency.formatCurrencyAmount(0.12345678, 'btc').simpleVal, '0.12345678');
		assert.equal(currency.formatCurrencyAmount(1, 'btc').simpleVal, '1');
	});

	test('long fractions are split into val and lessSignificantDigits', () => {
		const out = currency.formatCurrencyAmount(0.12345678, 'btc');
		assert.equal(out.val, '0.1234');
		assert.equal(out.lessSignificantDigits, '5678');
		assert.equal(out.currencyUnit, 'BTC');
	});

	test('forced decimal places keep trailing zeroes', () => {
		assert.equal(currency.formatCurrencyAmountWithForcedDecimalPlaces(1, 'btc', 2).val, '1.00');
	});

	test('exchanged amounts use the rates', () => {
		assert.equal(currency.formatCurrencyAmount(0.5, 'usd').val, '30,000');
	});

	test('exchanged amounts fall back to the base unit without rates', () => {
		global.exchangeRates = null;
		assert.equal(currency.formatCurrencyAmount(1, 'usd').currencyUnit, 'BTC');
	});

	test('unknown currency type throws', () => {
		assert.throws(() => currency.formatCurrencyAmount(1, 'nope'), /Unknown currency type: nope/);
	});

	test('formatExchangedCurrency and getExchangedCurrencyFormatData', () => {
		assert.deepEqual(currency.formatExchangedCurrency(0.5, 'usd'), { val: '30,000.00', symbol: '$', unit: 'usd', valRaw: '30000.00' });
		assert.deepEqual(currency.getExchangedCurrencyFormatData(0.5, 'eur'), { symbol: '€', value: '27,500.00', unit: 'eur' });
		assert.equal(currency.formatExchangedCurrency(1, 'xyz'), '');
	});

	test('gold is priced from USD', () => {
		assert.deepEqual(currency.formatExchangedCurrency(1, 'au'), { val: '24.00', unit: 'oz', symbol: 'AU', valRaw: '24.00' });
	});

	test('satoshisPerUnitOfLocalCurrency', () => {
		assert.deepEqual(currency.satoshisPerUnitOfLocalCurrency('usd'), { amt: '1,666', amtRaw: 1666, unit: 'sat/$' });
		global.exchangeRates = null;
		assert.equal(currency.satoshisPerUnitOfLocalCurrency('usd'), null);
	});
});

describe('logError', () => {
	test('counts by id, records the message and returns the entry', () => {
		global.errorLog = undefined;
		global.errorStats = {};

		const out = errors.logError('test-id', new Error('boom'), { user: 'u' }, false);

		assert.equal(out.errorId, 'test-id');
		assert.equal(out.userData!.errorMsg, 'boom');
		assert.equal(global.errorStats['test-id'].count, 1);
		assert.equal(global.errorStats['test-id'].properties.user.u, 1);
		assert.equal(global.errorLog.length, 1);
	});

	test('keeps only the last 100 errors', () => {
		global.errorLog = [];
		for (let i = 0; i < 120; i++) {
			errors.logError('many', 'x', null, false);
		}
		assert.equal(global.errorLog.length, 100);
	});
});
