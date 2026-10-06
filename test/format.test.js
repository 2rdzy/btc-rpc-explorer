'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

require('./helpers/setup.js');
const { Decimal } = require('decimal.js');
const utils = require('../app/utils.js');

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

describe('halving estimates', () => {
	const estimate = height => utils.nextHalvingEstimates({ height: Math.floor(height / 2016) * 2016, time: 1.6e9 }, { height, time: 1.7e9 });

	for (const [height, halvingCount, nextHalvingBlock] of [[0, 0, 210000], [209999, 0, 210000], [210000, 1, 420000], [840000, 4, 1050000], [975700, 4, 1050000]]) {
		test(`block ${height} is after ${halvingCount} halvings, the next at ${nextHalvingBlock}`, () => {
			const result = estimate(height);

			assert.equal(result.halvingCount, halvingCount);
			assert.equal(result.nextHalvingBlock, nextHalvingBlock);
		});
	}
});
