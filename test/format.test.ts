import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import "./helpers/setup.js";
import { Decimal } from "decimal.js";
import * as utils from "../app/utils.js";

describe('exchanged currency formatting', () => {
	before(() => {
		global.exchangeRates = { usd: 61234.5678, eur: 56789.1234 };
		global.currencyTypes = { usd: { symbol: '$' }, eur: { symbol: '€' } };
		global.currencySymbols = { usd: '$', eur: '€' };
	});

	after(() => {
		delete global.exchangeRates;
		delete global.currencyTypes;
		delete global.currencySymbols;
	});

	test('converts an amount at the exchange rate, with thousands separators and two decimals', () => {
		assert.deepEqual(utils.getExchangedCurrencyFormatData(new Decimal(12.3456789), 'usd'), { symbol: '$', value: '755,982.31', unit: 'usd' });
	});

	test('uses the symbol and rate of the requested currency', () => {
		assert.deepEqual(utils.getExchangedCurrencyFormatData(new Decimal(1), 'eur'), { symbol: '€', value: '56,789.12', unit: 'eur' });
	});

	test('formatExchangedCurrency gives the formatted and the raw value, with the requested decimals', () => {
		assert.deepEqual(utils.formatExchangedCurrency(new Decimal(12.3456789), 'usd'), { val: '755,982.31', symbol: '$', unit: 'usd', valRaw: '755982.31' });
		assert.equal(utils.formatExchangedCurrency(new Decimal(1.005), 'eur', 3).val, '57,073.070');
	});

	test('a currency with no exchange rate gives nothing', () => {
		assert.equal(utils.getExchangedCurrencyFormatData(new Decimal(1), 'jpy'), '');
	});
});

describe('currency amounts', () => {
	before(async () => {
		global.exchangeRates = { usd: 61234.5678, eur: 56789.1234 };
		global.currencySymbols = { usd: '$', eur: '€' };
		await import('../app/currencies.js');
	});

	after(() => {
		delete global.exchangeRates;
		delete global.currencySymbols;
		delete global.currencyTypes;
	});

	test('formats a BTC amount with thousands separators', () => {
		assert.deepEqual(utils.formatCurrencyAmount(new Decimal(1234.5678), 'btc'), { currencyUnit: 'BTC', simpleVal: '1,234.5678', intVal: 1234, val: '1,234.5678' });
	});

	test('converts BTC to sats', () => {
		assert.deepEqual(utils.formatCurrencyAmount(new Decimal(0.5), 'sat'), { currencyUnit: 'sat', simpleVal: '50,000,000', intVal: 50000000, val: '50,000,000' });
	});

	test('converts BTC to a local currency', () => {
		assert.deepEqual(utils.formatCurrencyAmount(new Decimal(1234.5678), 'usd'), { val: '75,598,225.65', currencyUnit: 'USD', simpleVal: '75,598,225.65', intVal: 75598225 });
	});

	test('forced decimal places round the shown value but keep the whole part in intVal', () => {
		assert.deepEqual(utils.formatCurrencyAmountWithForcedDecimalPlaces(new Decimal(1234.5678), 'usd', 0), { val: '75,598,226', currencyUnit: 'USD', simpleVal: '75,598,226', intVal: 75598225 });
		assert.equal(utils.formatCurrencyAmountWithForcedDecimalPlaces(new Decimal(0.123456789), 'btc', 2).val, '0.12');
	});

	test('the whole part of an amount below 0.000001 BTC is 0 (it used to be read from the string "1e-8" as 1)', () => {
		assert.equal(utils.formatCurrencyAmount(new Decimal(0.00000001), 'btc').intVal, 0);
		assert.equal(utils.formatCurrencyAmountWithForcedDecimalPlaces(new Decimal(1e-9), 'btc', 5).intVal, 0);
	});

	test('satoshis per unit of a local currency', () => {
		assert.deepEqual(utils.satoshisPerUnitOfLocalCurrency('usd'), { amt: '1,633', amtRaw: 1633, unit: 'sat/$' });
	});
});

describe('large number formatting', () => {
	test('with significant digits', () => {
		assert.equal(utils.formatLargeNumberSignificant(12345.6789, 3)[0].toString(), '12.3');
		assert.equal(utils.formatLargeNumberSignificant(123456789, 5)[0].toString(), '123.46');
		assert.equal(utils.formatLargeNumberSignificant(123456789, 5)[1].name, 'mega');
	});

	test('negative, tiny and very large numbers', () => {
		assert.equal(utils.formatLargeNumber(-1234567, 3)[0].toString(), '-1.235');
		assert.equal(utils.formatLargeNumber(1e-7, 3)[0].toString(), '0');
		assert.deepEqual(utils.formatLargeNumber(3.3e22, 3)[0].toString(), '33');
		assert.equal(utils.formatLargeNumber(3.3e22, 3)[1].name, 'zetta');
	});
});

describe('halving estimates', () => {
	const estimate = (height: number) => utils.nextHalvingEstimates({ height: Math.floor(height / 2016) * 2016, time: 1.6e9, mediantime: 1.6e9 }, { height, time: 1.7e9, mediantime: 1.7e9 });

	for (const [height, halvingCount, nextHalvingBlock] of [[0, 0, 210000], [209999, 0, 210000], [210000, 1, 420000], [840000, 4, 1050000], [975700, 4, 1050000]]) {
		test(`block ${height} is after ${halvingCount} halvings, the next at ${nextHalvingBlock}`, () => {
			const result = estimate(height);

			assert.equal(result.halvingCount, halvingCount);
			assert.equal(result.nextHalvingBlock, nextHalvingBlock);
		});
	}
});
