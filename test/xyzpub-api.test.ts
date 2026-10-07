import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { fakeRpc } from "./helpers/setup.js";
import * as xyzpubApi from "../app/api/xyzpubApi.js";
import { xpubChangeVersionBytes } from "../app/helpers/addresses.js";
import axios from "axios";
import config from "../app/config.js";

// BIP84 test vector (account 0 of the "abandon ... about" mnemonic)
const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const xpub = xpubChangeVersionBytes(zpub, 'xpub');
const ypub = xpubChangeVersionBytes(zpub, 'ypub');
const receive = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'];

beforeEach(() => { global.activeBlockchain = 'main'; });
afterEach(() => mock.restoreAll());

describe('getKeyDetails', () => {
	test('zpub', () => {
		const out = xyzpubApi.getKeyDetails(zpub);
		assert.equal(out.keyType, 'zpub');
		assert.equal(out.outputType, 'P2WPKH');
		assert.equal(out.bip32Path, "m/84'/0'");
		assert.deepEqual(out.relatedKeys.map(k => k.keyType), ['xpub', 'ypub']);
		assert.equal(out.relatedKeys[0].key, xpub);
		assert.match(out.relatedKeys[0].firstAddress, /^1/);
		assert.match(out.relatedKeys[1].firstAddress, /^3/);
	});

	test('xpub lists the other two formats', () => {
		const out = xyzpubApi.getKeyDetails(xpub);
		assert.equal(out.outputType, 'P2PKH');
		assert.deepEqual(out.relatedKeys.map(k => k.keyType), ['ypub', 'zpub']);
		assert.equal(out.relatedKeys[1].key, zpub);
		assert.equal(out.relatedKeys[1].firstAddress, receive[0]);
	});

	test('ypub', () => {
		const out = xyzpubApi.getKeyDetails(ypub);
		assert.equal(out.outputType, 'P2WPKH in P2SH');
		assert.deepEqual(out.relatedKeys.map(k => k.keyType), ['xpub', 'zpub']);
	});

	test('multi-sig keys have no related keys', () => {
		assert.equal(xyzpubApi.getKeyDetails('Zpub-anything').outputType, 'Multi-Sig P2WSH');
		assert.equal(xyzpubApi.getKeyDetails('Ypub-anything').outputType, 'Multi-Sig P2WSH in P2SH');
		assert.deepEqual(xyzpubApi.getKeyDetails('Zpub-anything').relatedKeys, []);
	});
});

describe('getXpubAddresses', () => {
	test('derives the receive addresses for any single-sig format', () => {
		assert.deepEqual(xyzpubApi.getXpubAddresses(zpub, 0, 2, 0), receive);
		assert.deepEqual(xyzpubApi.getXpubAddresses(zpub, 0, 1, 1), [receive[1]]);
	});

	test('receive and change differ', () => {
		assert.notDeepEqual(xyzpubApi.getXpubAddresses(zpub, 1, 2, 0), receive);
	});

	test('p2pkh and p2sh-p2wpkh for xpub and ypub', () => {
		assert.match(xyzpubApi.getXpubAddresses(xpub, 0, 1, 0)[0], /^1/);
		assert.match(xyzpubApi.getXpubAddresses(ypub, 0, 1, 0)[0], /^3/);
	});

	test('other keys give no addresses', () => {
		assert.deepEqual(xyzpubApi.getXpubAddresses('Zpub-anything'), []);
	});
});

describe('getXpubAddresses limit', () => {
	test('is cut at the maximum', { timeout: 30000 }, () => {
		assert.equal(xyzpubApi.getXpubAddresses(zpub, 0, 1000000).length, 1000);
		assert.equal(xyzpubApi.getXpubAddresses(zpub, 0, 5).length, 5);
	});
});

describe('searchXpubTxids', () => {
	const originalApi = config.addressApi;

	// the blockchair.com API answers from a map of address to transactions, by offset
	const answer = (pages: Record<string, Record<string, string[]>>) => async (url: string) => {
		const [, address, offset] = /address\/([^/]+)\/\?offset=(\d+)/.exec(url)!;
		const txids = (pages[address] || {})[offset] || [];
		return { data: { data: { [address]: { transactions: txids, address: { transaction_count: txids.length, received: 0, spent: 0, balance: 0 } } } } };
	};

	beforeEach(() => { config.addressApi = 'blockchair.com'; });
	afterEach(() => { config.addressApi = originalApi; });

	test('stops after the gap, and reports used and empty addresses', async () => {
		fakeRpc({ validateaddress: params => ({ address: params[0], scriptPubKey: '00' }) });
		const get = mock.method(axios, 'get', answer({ [receive[0]]: { 0: ['t1', 't2'] } }));

		const out = await xyzpubApi.searchXpubTxids(zpub, 3);

		assert.deepEqual(out.usedAddresses, [{ addressIndex: 0, address: receive[0], type: 'receive', txids: ['t1', 't2'], priorGap: 0 }]);
		assert.equal(out.emptyAddresses.receive.length, 3);
		assert.equal(out.emptyAddresses.change.length, 3);
		assert.equal(out.emptyAddresses.receive[0], receive[1]);
		assert.ok(get.mock.calls.length >= 7);
	});

	test('with no address API it ends (and finds nothing) instead of looping for ever', { timeout: 10000 }, async () => {
		fakeRpc({ validateaddress: params => ({ address: params[0], scriptPubKey: '00' }) });
		config.addressApi = undefined;

		const out = await xyzpubApi.searchXpubTxids(zpub, 2);

		assert.deepEqual(out.usedAddresses, []);
		assert.equal(out.emptyAddresses.receive.length, 2);
		assert.equal(out.emptyAddresses.change.length, 2);

		// with a limit on the addresses too
		assert.deepEqual((await xyzpubApi.searchXpubTxids(zpub, 20, 1)).usedAddresses, []);
	});

	test('a gap limit and an address limit above the maximum are cut', { timeout: 30000 }, async () => {
		fakeRpc({ validateaddress: params => ({ address: params[0], scriptPubKey: '00' }) });
		config.addressApi = undefined;

		const out = await xyzpubApi.searchXpubTxids(zpub, 1000000);

		assert.equal(out.emptyAddresses.receive.length, 100);
		assert.equal(out.emptyAddresses.change.length, 100);
	});

	test('pages through an address with more transactions than one page', async () => {
		fakeRpc({ validateaddress: params => ({ address: params[0], scriptPubKey: '00' }) });
		const full = Array.from({ length: 20 }, (_, i) => 'a' + i);
		const get = mock.method(axios, 'get', answer({ [receive[0]]: { 0: full, 20: ['last'] } }));

		const out = await xyzpubApi.searchXpubTxids(zpub, 1);

		const offsets = get.mock.calls.map((c: { arguments: unknown[] }) => String(c.arguments[0])).filter((u: string) => u.includes(receive[0])).map((u: string) => u.split('offset=')[1]);
		assert.deepEqual(offsets, ['0', '20']);
		assert.equal(out.usedAddresses.length, 2);
		assert.equal(out.usedAddresses[1].txids[0], 'last');
	});
});
