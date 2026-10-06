'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, test } = require('node:test');

require('./helpers/setup.js');

const mining = require('../app/helpers/mining.js');
const timing = require('../app/helpers/timing.js');
const http = require('../app/helpers/http.js');
const { arrayFromHexString } = require('../app/helpers/collections.js');
const utils = require('../app/utils.js');

const hex = s => Buffer.from(s).toString('hex');
const coinbase = (tag, vout, blockhash) => ({ vin: [{ coinbase: hex(tag) }], vout, blockhash });

describe('identifyMiner', () => {
	beforeEach(() => {
		global.activeBlockchain = 'main';
		global.miningPoolsConfigs = [{
			payout_addresses: { addrA: { name: 'PoolA' } },
			coinbase_tags: { '/TagB/': { name: 'PoolB' } },
			block_hashes: { hh1: { name: 'PoolH' } },
			block_heights: { PoolX: { heights: [5, 6] } }
		}];
	});

	afterEach(() => { global.miningPoolsConfigs = undefined; });

	test('by payout address, with the reason', () => {
		const out = mining.identifyMiner(coinbase('x', [{ value: 1, scriptPubKey: { address: 'addrA' } }]), 100);
		assert.equal(out.name, 'PoolA');
		assert.equal(out.identifiedBy, 'payout address addrA');
	});

	test('by coinbase tag', () => {
		const out = mining.identifyMiner(coinbase('hi /TagB/ there', [{ value: 1, scriptPubKey: { address: 'z' } }]), 100);
		assert.equal(out.name, 'PoolB');
		assert.equal(out.identifiedBy, "coinbase tag '/TagB/'");
	});

	test('by block hash', () => {
		assert.equal(mining.identifyMiner(coinbase('x', [], 'hh1'), 100).name, 'PoolH');
	});

	test('by block height, on mainnet only', () => {
		assert.equal(mining.identifyMiner(coinbase('x', []), 5).name, 'PoolX');
		global.activeBlockchain = 'test';
		assert.equal(mining.identifyMiner(coinbase('x', []), 5), null);
	});

	test('falls back to the first paid address', () => {
		const out = mining.identifyMiner(coinbase('x', [{ value: 0, scriptPubKey: { address: 'q' } }, { value: 2, scriptPubKey: { address: 'w' } }]), 100);
		assert.deepEqual(out, { name: 'w', type: 'address-only', identifiedBy: 'payout address w' });
	});

	test('nothing to go on gives null', () => {
		assert.equal(mining.identifyMiner(null, 1), null);
		assert.equal(mining.identifyMiner({ vin: [] }, 1), null);
		assert.equal(mining.identifyMiner(coinbase('x', [{ value: 0 }]), 100), null);
	});
});

describe('values and supply', () => {
	beforeEach(() => { global.activeBlockchain = 'main'; });

	test('getTxTotalInputOutputValues', () => {
		const tx = { txid: 't', vin: [{ txid: 'a' }, { txid: 'b' }], vout: [{ value: 1 }, { value: 0.25 }] };
		const out = mining.getTxTotalInputOutputValues(tx, [{ value: 1 }, { value: 0.5 }], 100);
		assert.equal(out.input.toString(), '1.5');
		assert.equal(out.output.toString(), '1.25');
		assert.equal(mining.getTxTotalInputOutputValues(tx, null, 100).input, null);
	});

	test('a coinbase input counts as the block reward', () => {
		const tx = { vin: [{ coinbase: 'x' }], vout: [{ value: 50 }] };
		assert.equal(mining.getTxTotalInputOutputValues(tx, [null], 0).input.toString(), '50');
	});

	test('getBlockTotalFeesFromCoinbaseTxAndBlockHeight', () => {
		const cb = { vout: [{ value: 3.125 }, { value: 0.5 }, { value: 0 }] };
		assert.equal(mining.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(cb, 840000).toString(), '0.5');
		assert.equal(mining.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(null, 1), 0);
	});

	test('estimatedSupply counts the blocks up to and including the height', () => {
		assert.equal(mining.estimatedSupply(0).toString(), '50');
		assert.equal(mining.estimatedSupply(1).toString(), '100');
		assert.equal(mining.estimatedSupply(210000).toString(), '10500050');
		assert.equal(mining.estimatedSupply(420000).toString(), '15750050');
	});
});

describe('timing helpers', () => {
	test('timePromise returns the result and records whole milliseconds', async () => {
		const results = {};
		assert.equal(await timing.timePromise('t', async () => 5, results), 5);
		assert.ok(Number.isInteger(results.t) && results.t >= 1);
	});

	test('timePromise records an _error entry and rethrows', async () => {
		const results = {};
		await assert.rejects(timing.timePromise('t', async () => { throw new Error('x'); }, results), /x/);
		assert.ok('t_error' in results);
	});

	test('safePromise logs instead of throwing', async () => {
		global.errorStats = {};
		assert.equal(await timing.safePromise('sp-id', async () => { throw new Error('x'); }), undefined);
		assert.equal(global.errorStats['sp-id'].count, 1);
		assert.equal(await timing.safePromise('sp-id', async () => 7), 7);
	});

	test('awaitPromises settles everything and logs rejections', async () => {
		global.errorStats = {};
		const out = await timing.awaitPromises([Promise.resolve(1), Promise.reject(new Error('bad'))]);
		assert.deepEqual(out.map(x => x.status), ['fulfilled', 'rejected']);
		assert.equal(global.errorStats.awaitPromises_rejected.count, 1);
	});

	test('reflectPromise', async () => {
		assert.deepEqual(await timing.reflectPromise(Promise.resolve(1)), { v: 1, status: 'resolved' });
		assert.deepEqual(await timing.reflectPromise(Promise.reject(2)), { e: 2, status: 'rejected' });
	});

	test('perfLogNewItem keeps the newest 100, newest first', () => {
		let last;
		for (let i = 0; i < 120; i++) {
			last = timing.perfLogNewItem({ path: `/p${i}` });
		}
		assert.equal(timing.perfLog.length, 100);
		assert.equal(timing.perfLog[0].id, last.perfId);
		assert.equal(timing.perfLog[0].path, '/p119');
		assert.equal(utils.perfLog, timing.perfLog);
	});

	test('trackAppEvent counts events and param values', () => {
		global.appEventStats = {};
		timing.trackAppEvent('e');
		timing.trackAppEvent('e', 2, { a: 1 });
		assert.equal(global.appEventStats.e.count, 3);
		assert.equal(global.appEventStats.e.params['a[1]'].count, 2);
	});
});

describe('fileCache', () => {
	let dir;
	beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-cache-')); });
	afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

	test('writes and loads, creating the directory', () => {
		const cache = timing.fileCache(path.join(dir, 'sub'), 'c');
		assert.equal(cache.tryLoadJson(), null);
		cache.writeJson({ a: 1 });
		assert.deepEqual(cache.tryLoadJson(), { a: 1 });
	});

	test('a new version removes the older files', () => {
		timing.fileCache(dir, 'c', 1).writeJson(1);
		timing.fileCache(dir, 'c', 2).writeJson(2);
		timing.fileCache(dir, 'c', 3).writeJson(3);
		assert.deepEqual(fs.readdirSync(dir).sort(), ['c-v3.json']);
	});

	test('a corrupt file is deleted and loads as null', () => {
		fs.writeFileSync(path.join(dir, 'c.json'), '{bad');
		assert.equal(timing.fileCache(dir, 'c').tryLoadJson(), null);
		assert.equal(fs.existsSync(path.join(dir, 'c.json')), false);
	});
});

describe('http helpers', () => {
	test('getCrawlerFromUserAgentString', () => {
		assert.equal(http.getCrawlerFromUserAgentString('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'google');
		assert.equal(http.getCrawlerFromUserAgentString('python-requests/2.31'), 'python-requests');
		assert.equal(http.getCrawlerFromUserAgentString('Mozilla/5.0 Firefox'), null);
		assert.equal(http.getCrawlerFromUserAgentString(undefined), null);
	});

	test('redirectToConnectPageIfNeeded', () => {
		const calls = [];
		const res = { redirect: u => calls.push(['redirect', u]), end: () => calls.push(['end']) };
		const req = { session: {}, originalUrl: '/block/1' };

		assert.equal(http.redirectToConnectPageIfNeeded(req, res), true);
		assert.equal(req.session.redirectUrl, '/block/1');
		assert.deepEqual(calls, [['redirect', '/'], ['end']]);
		assert.equal(http.redirectToConnectPageIfNeeded({ session: { host: 'h' } }, res), false);
	});

	test('expressRequestToJson picks the loggable parts', () => {
		const out = http.expressRequestToJson({ method: 'GET', url: '/x', ip: '1.2.3.4', secret: 'no' });
		assert.equal(out.method, 'GET');
		assert.equal(out.ip, '1.2.3.4');
		assert.equal('secret' in out, false);
	});

	test('arrayFromHexString', () => {
		assert.deepEqual([...arrayFromHexString('00ff10')], [0, 255, 16]);
	});
});

describe('utils facade', () => {
	test('exports what the rest of the app uses', () => {
		for (const name of ['logError', 'formatCurrencyAmount', 'identifyMiner', 'timePromise', 'refreshExchangeRates', 'geoLocateIpAddresses', 'buildQrCodeUrls', 'getCrawlerFromUserAgentString', 'tryParseAddress', 'perfLogNewItem', 'fileCache']) {
			assert.equal(typeof utils[name], 'function', name);
		}
	});
});
