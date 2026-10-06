'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, describe, test } = require('node:test');

require('./helpers/setup.js');
const utils = require('../app/utils.js');

const customConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'txt', 'mining-pools-configs-custom', 'BTC', 'blake2b.json'), 'utf8'));

const coinbaseTx = (text, value = 0, payoutAddress = 'bc1qexample') => ({
	vin: [{ coinbase: Buffer.from(`\u0003\u0001\u0002${text}`, 'utf8').toString('hex') }],
	vout: [{ value, scriptPubKey: { address: payoutAddress } }]
});

describe('identifyMiner with the custom BLAKE2b pool list', () => {
	before(() => { global.miningPoolsConfigs = [customConfig]; });

	for (const [tag, name] of [['AlphaPool', 'AlphaPool'], ['Lazarus', 'Lazarus'], ['omegapool.tech', 'omegapool.tech'], ['Legata', 'Legata']]) {
		test(`finds ${name} by its coinbase tag`, () => {
			const miner = utils.identifyMiner(coinbaseTx(`xx ${tag} DATUM User yy`), 975000);

			assert.equal(miner.name, name);
			assert.match(miner.identifiedBy, new RegExp(`coinbase tag '${tag}'`));
		});
	}

	test('returns nothing for a coinbase with no known tag and no payout value', () => {
		assert.equal(utils.identifyMiner(coinbaseTx('some unknown pool'), 975000), null);
	});

	test('falls back to the payout address when there is a value but no known tag', () => {
		const miner = utils.identifyMiner(coinbaseTx('some unknown pool', 3.125, 'bc1qpayout'), 975000);

		assert.equal(miner.name, 'bc1qpayout');
		assert.equal(miner.type, 'address-only');
	});

	test('returns nothing for a transaction without inputs', () => {
		assert.equal(utils.identifyMiner({ vin: [], vout: [] }, 975000), null);
		assert.equal(utils.identifyMiner(null, 975000), null);
	});

	test('a list that comes first takes precedence over later ones', () => {
		global.miningPoolsConfigs = [customConfig, { coinbase_tags: { 'AlphaPool': { name: 'Someone Else' } } }];

		assert.equal(utils.identifyMiner(coinbaseTx('AlphaPool'), 975000).name, 'AlphaPool');
	});
});
