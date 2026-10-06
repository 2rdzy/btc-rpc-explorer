import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import "./helpers/setup.js";
import * as addresses from "../app/helpers/addresses.js";
import * as estimates from "../app/helpers/estimates.js";

// BIP84 test vector (account 0 of the "abandon ... about" mnemonic). bip32Addresses takes an xpub, so the
// explorer converts other formats first.
const zpubKey = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

const zpub = zpubKey;
const xpubOfZpub = addresses.xpubChangeVersionBytes(zpub, 'xpub');

describe('vout addresses', () => {
	test('getVoutAddress', () => {
		assert.equal(addresses.getVoutAddress({ scriptPubKey: { address: 'a' } }), 'a');
		assert.equal(addresses.getVoutAddress({ scriptPubKey: { addresses: ['x', 'y'] } }), 'x');
		assert.equal(addresses.getVoutAddress({ scriptPubKey: {} }), null);
		assert.equal(addresses.getVoutAddress(null), null);
	});

	test('getVoutAddresses', () => {
		assert.deepEqual(addresses.getVoutAddresses({ scriptPubKey: { address: 'a' } }), ['a']);
		assert.deepEqual(addresses.getVoutAddresses({ scriptPubKey: { addresses: ['x', 'y'] } }), ['x', 'y']);
		assert.deepEqual(addresses.getVoutAddresses({}), []);
		assert.deepEqual(addresses.getVoutAddresses(undefined), []);
	});
});

describe('extended public keys', () => {
	test('bip32Addresses derives the BIP84 test vector', () => {
		assert.deepEqual(addresses.bip32Addresses(xpubOfZpub, 'p2wpkh', 0, 2, 0), [
			'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
			'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'
		]);
	});

	test('bip32Addresses honours offset and limit', () => {
		const all = addresses.bip32Addresses(xpubOfZpub, 'p2wpkh', 0, 4, 0);
		assert.deepEqual(addresses.bip32Addresses(xpubOfZpub, 'p2wpkh', 0, 2, 2), all.slice(2));
	});

	test('bip32Addresses rejects an unknown address type', () => {
		assert.throws(() => addresses.bip32Addresses(xpubOfZpub, 'p2tr', 0, 1), /Unknown address type: "p2tr"/);
	});

	test('xpubChangeVersionBytes converts and round-trips', () => {
		const xpub = addresses.xpubChangeVersionBytes(zpub, 'xpub');
		assert.match(xpub, /^xpub/);
		assert.equal(addresses.xpubChangeVersionBytes(` ${xpub}\n`, 'zpub'), zpub);
		assert.throws(() => addresses.xpubChangeVersionBytes(zpub, 'nope'), /Invalid target version/);
	});
});

describe('tryParseAddress', () => {
	beforeEach(() => { global.activeBlockchain = 'main'; });
	afterEach(() => { global.activeBlockchain = 'main'; });

	test('base58', () => {
		const out = addresses.tryParseAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
		assert.equal(out.encoding, 'base58');
		assert.equal(typeof out.parsedAddress!.hash, 'string');
		assert.equal(out.parsedAddress!.version, 0);
	});

	test('bech32 and taproot', () => {
		assert.equal(addresses.tryParseAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').encoding, 'bech32');
		// bitcoinjs decodes taproot (bech32m) addresses in its bech32 step already
		assert.equal(addresses.tryParseAddress('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr').encoding, 'bech32');
	});

	test('a base58 address is not tried on the wrong network', () => {
		global.activeBlockchain = 'test';
		const out = addresses.tryParseAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
		assert.equal(out.encoding, undefined);
		assert.equal(out.errors!.length, 2);
	});

	test('garbage gives the errors of each attempt', () => {
		const out = addresses.tryParseAddress('xyz');
		assert.equal(out.encoding, undefined);
		assert.equal(out.errors!.length, 2);
	});
});

describe('estimates', () => {
	const now = Date.now() / 1000;
	const header = (height: number, ago: number) => ({ height, time: now - ago, mediantime: now - ago - 3000 });

	test('difficultyAdjustmentEstimates: slow blocks mean a downward adjustment', () => {
		const out = estimates.difficultyAdjustmentEstimates(header(960960, 1e6), header(961100, 600));
		assert.equal(out.sign, '-');
		assert.equal(out.estimateAvailable, true);
		assert.equal(out.blockCount, 141);
		assert.equal(out.blocksLeft, 532);
		assert.equal(out.currentEpoch, 476);
		assert.ok(out.delta.lt(0));
	});

	test('difficultyAdjustmentEstimates: fast blocks mean an upward adjustment', () => {
		const out = estimates.difficultyAdjustmentEstimates(header(960960, 3e4), header(961100, 600));
		assert.equal(out.sign, '+');
		assert.ok(out.delta.gt(0));
	});

	// blocks of exactly 500 seconds, 100 blocks before the next difficulty adjustment (at 961632)
	const steady = () => [{ height: 960960, time: 0, mediantime: 1000 }, { height: 961532, time: 0, mediantime: 1000 + 572 * 500 }];

	test('difficultyAdjustmentEstimates: the time left follows from the pace of the epoch so far', () => {
		const [start, current] = steady();
		const out = estimates.difficultyAdjustmentEstimates(start, current);

		assert.equal(out.timePerBlock, 500);
		assert.equal(out.blocksLeft, 100);
		assert.equal(out.currentEpoch, 476);
		assert.equal(out.calculationBlockCount, 572);
		// 100 blocks * 500 s = 13.9 hours: less than a day, so the time left is given in hours
		assert.equal(out.daysLeftStr, '< 1 day');
		assert.equal(out.timeLeftStr, '~14 hrs');
	});

	test('difficultyAdjustmentEstimates: more than a day left is given in days', () => {
		const out = estimates.difficultyAdjustmentEstimates({ height: 960960, time: 0, mediantime: 1000 }, { height: 961100, time: 0, mediantime: 1000 + 140 * 500 });

		// 532 blocks * 500 s = 3.08 days
		assert.equal(out.blocksLeft, 532);
		assert.equal(out.daysLeftStr, '~3.1 days');
		assert.equal(out.timeLeftStr, '~3.1 days');
	});

	test('nextHalvingEstimates: the days follow from the blocks left, the target block time and the pace of the epoch', () => {
		const [start, current] = steady();
		const out = estimates.nextHalvingEstimates(start, current) as ReturnType<typeof estimates.nextHalvingEstimates> & { daysUntilNextHalving: number };

		// 88468 blocks to go at 600 s, less the 100 s each of the 100 blocks of this epoch that come in faster
		assert.equal(out.blocksUntilNextHalving, 1050000 - 961532);
		assert.ok(Math.abs(out.daysUntilNextHalving - (88468 * 600 - 100 * 100) / 86400) < 1e-9);
	});

	test('nextHalvingEstimates', () => {
		const out = estimates.nextHalvingEstimates(header(960960, 1e6), header(961100, 600));
		assert.equal(out.halvingCount, 4);
		assert.equal(out.nextHalvingIndex, 5);
		assert.equal(out.nextHalvingBlock, 1050000);
		assert.equal(out.blocksUntilNextHalving, 1050000 - 961100);
		assert.ok(out.nextHalvingDate! > new Date());
	});

	test('nextHalvingEstimates after the last halving', () => {
		const out = estimates.nextHalvingEstimates(header(1, 1e6), header(210000 * 32, 600));
		assert.equal(out.nextHalvingIndex, -1);
		assert.equal(out.nextHalvingDate, undefined);
	});
});
