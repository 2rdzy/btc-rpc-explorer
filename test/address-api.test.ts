import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { after, afterEach, before, describe, mock, test } from "node:test";

import axios from "axios";

import "./helpers/setup.js";
import config from "../app/config.js";
import * as addressApi from "../app/api/addressApi.js";
import * as electrumAddressApi from "../app/api/electrumAddressApi.js";
import * as blockchainAddressApi from "../app/api/blockchainAddressApi.js";
import * as blockchairAddressApi from "../app/api/blockchairAddressApi.js";
import * as blockcypherAddressApi from "../app/api/blockcypherAddressApi.js";

// p2wpkh script of a made-up key: the content only matters for the hash the client sends
const scriptPubkey = '0014' + '11'.repeat(20);

describe('address API selection', () => {
	const original = config.addressApi;
	afterEach(() => { config.addressApi = original; });

	test('lists the supported APIs', () => {
		assert.deepEqual(addressApi.getSupportedAddressApis(), ['blockchain.com', 'blockchair.com', 'blockcypher.com', 'electrum', 'electrumx']);
	});

	test('feature support depends on the configured API', () => {
		config.addressApi = 'blockchair.com';
		assert.deepEqual(addressApi.getCurrentAddressApiFeatureSupport(), { pageNumbers: true, sortDesc: true, sortAsc: false });
		config.addressApi = 'electrumx';
		assert.deepEqual(addressApi.getCurrentAddressApiFeatureSupport(), { pageNumbers: true, sortDesc: true, sortAsc: true });
		config.addressApi = undefined;
		assert.equal(addressApi.getCurrentAddressApiFeatureSupport(), undefined);
	});

	test('no API configured gives an error entry, not an exception', async () => {
		config.addressApi = undefined;
		assert.deepEqual(await addressApi.getAddressDetails('a', scriptPubkey, 'desc', 10, 0), { addressDetails: null, errors: ['No address API configured'] });
	});

	test('no Electrum connection rejects with a user text', async () => {
		config.addressApi = 'electrum';
		await assert.rejects(addressApi.getAddressDetails('a', scriptPubkey, 'desc', 10, 0), (err: { error: string, userText: string }) => err.error === 'No Electrum Server Connection' && /No Electrum connection available/.test(err.userText));
		await assert.rejects(electrumAddressApi.lookupTxBlockHash('00'), (err: { error: string }) => err.error === 'No Electrum Server Connection');
	});
});

describe('HTTP address APIs', () => {
	afterEach(() => mock.restoreAll());

	test('blockchain.com: descending', async () => {
		const get = mock.method(axios, 'get', async () => ({ data: { n_tx: 3, hash160: 'h', total_received: 10, total_sent: 4, final_balance: 6, txs: [{ hash: 't1', block_height: 5 }, { hash: 't2', block_height: 6 }] } }));
		const out = await blockchainAddressApi.getAddressDetails('1abc', scriptPubkey, 'desc', 2, 0);
		assert.match(String(get.mock.calls[0].arguments[0]), /rawaddr\/1abc\?limit=2&offset=0$/);
		assert.deepEqual(out.addressDetails, { txids: ['t1', 't2'], blockHeightsByTxid: { t1: 5, t2: 6 }, txCount: 3, hash160: 'h', totalReceivedSat: 10, totalSentSat: 4, balanceSat: 6, source: 'blockchain.com' });
	});

	test('blockchain.com: ascending pages from the end and reverses', async () => {
		const urls: string[] = [];
		mock.method(axios, 'get', async (url: string) => {
			urls.push(url);
			return { data: { n_tx: 10, txs: [{ hash: 'a', block_height: 1 }, { hash: 'b', block_height: 2 }] } };
		});
		const out = await blockchainAddressApi.getAddressDetails('1abc', scriptPubkey, 'asc', 2, 0);
		assert.match(urls[0], /limit=1$/);
		assert.match(urls[1], /limit=2&offset=8$/);
		assert.deepEqual(out.addressDetails!.txids, ['b', 'a']);
	});

	test('bc1 addresses are refused by blockchain.com and blockcypher.com', async () => {
		await assert.rejects(blockchainAddressApi.getAddressDetails('bc1q', scriptPubkey, 'desc', 1, 0), { userText: 'blockchain.com API does not support bc1 (native Segwit) addresses' });
		await assert.rejects(blockcypherAddressApi.getAddressDetails('bc1q', scriptPubkey, 'desc', 1, 0), { userText: 'blockcypher.com API does not support bc1 (native Segwit) addresses' });
	});

	test('a failed request is logged and rethrown', async () => {
		global.errorStats = {};
		mock.method(axios, 'get', async () => { throw new Error('offline'); });
		await assert.rejects(blockchainAddressApi.getAddressDetails('1abc', scriptPubkey, 'desc', 1, 0), /offline/);
		assert.equal(global.errorStats['3208hwssse'].count, 1);
		assert.equal(global.errorStats['32907shsghs'].count, 1);
	});

	test('blockchair.com', async () => {
		global.activeBlockchain = 'main';
		const get = mock.method(axios, 'get', async () => ({ data: { data: { '1abc': { transactions: ['t1', 't2', 't3'], address: { transaction_count: 3, received: 9, spent: 4, balance: 5 } } } } }));
		const out = await blockchairAddressApi.getAddressDetails('1abc', scriptPubkey, 'desc', 2, 0);
		assert.match(String(get.mock.calls[0].arguments[0]), /^https:\/\/api\.blockchair\.com\/bitcoin\/dashboards\/address\/1abc\/\?offset=0$/);
		assert.deepEqual(out.addressDetails, { txids: ['t1', 't2'], txCount: 3, totalReceivedSat: 9, totalSentSat: 4, balanceSat: 5, source: 'blockchair.com' });
	});

	test('blockcypher.com honours the offset', async () => {
		global.activeBlockchain = 'main';
		mock.method(axios, 'get', async () => ({ data: { n_tx: 3, total_received: 9, total_sent: 4, final_balance: 5, txrefs: [{ tx_hash: 'a', block_height: 1 }, { tx_hash: 'b', block_height: 2 }, { tx_hash: 'c', block_height: 3 }] } }));
		const out = await blockcypherAddressApi.getAddressDetails('1abc', scriptPubkey, 'desc', 2, 1);
		assert.deepEqual(out.addressDetails!.txids, ['b', 'c']);
		assert.deepEqual(out.addressDetails!.blockHeightsByTxid, { b: 2, c: 3 });
		assert.equal(out.addressDetails!.source, 'blockcypher.com');
	});
});

describe('Electrum address API', () => {
	let server: net.Server;
	let requests: { id: number, method: string, params: unknown[] }[];
	const history = [{ tx_hash: 'aa', height: 1 }, { tx_hash: 'bb', height: 2 }, { tx_hash: 'cc', height: 3 }];
	const originalApi = config.addressApi;
	const originalServers = config.electrumServers;
	const originalTls = config.electrumTls;

	before(async () => {
		requests = [];
		server = net.createServer((socket: net.Socket) => {
			let buffer = '';
			socket.setEncoding('utf8');
			socket.on('data', (chunk: string) => {
				buffer += chunk;
				let i;
				while ((i = buffer.indexOf('\n')) !== -1) {
					const msg = JSON.parse(buffer.slice(0, i));
					buffer = buffer.slice(i + 1);
					requests.push(msg);
					const results: Record<string, unknown> = {
						'server.version': ['fake-electrum', '1.4'],
						'server.ping': null,
						'blockchain.scripthash.get_history': history.map(x => ({ ...x })),
						'blockchain.scripthash.get_balance': { confirmed: 1000, unconfirmed: 5 },
						'blockchain.transaction.get_confirmed_blockhash': 'blockhash1'
					};
					socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: results[msg.method] }) + '\n');
				}
			});
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));

		config.addressApi = 'electrum';
		config.electrumTls = {};
		config.electrumServers = [{ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, protocol: 'tcp' }];
		await electrumAddressApi.connectToServers();
	});

	after(() => {
		config.addressApi = originalApi;
		config.electrumServers = originalServers;
		config.electrumTls = originalTls;
		server.close();
		// the client keeps trying to reconnect: end the test process instead of waiting for it
		setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
	});

	test('connects and counts the connection', () => {
		assert.equal(global.electrumStats.base.connect.count, 1);
		assert.ok(requests.some(r => r.method === 'server.version'));
	});

	test('descending lists the newest first, with heights, balance and unconfirmed balance', async () => {
		const out = await addressApi.getAddressDetails('addr', scriptPubkey, 'desc', 2, 0);
		assert.deepEqual(out.errors, []);
		assert.deepEqual(out.addressDetails, {
			txCount: 3,
			txids: ['cc', 'bb'],
			blockHeightsByTxid: { cc: 3, bb: 2 },
			balanceSat: 1000,
			unconfirmedBalanceSat: 5
		});
	});

	test('ascending with an offset', async () => {
		const out = await electrumAddressApi.getAddressDetails('addr', scriptPubkey, 'asc', 5, 1);
		assert.deepEqual(out.addressDetails!.txids, ['bb', 'cc']);
	});

	test('the request uses the reversed sha256 of the script', async () => {
		const sent = requests.filter(r => r.method === 'blockchain.scripthash.get_history').pop()!;
		const expected = Buffer.from(crypto.createHash('sha256').update(Buffer.from(scriptPubkey, 'hex')).digest()).reverse().toString('hex');
		assert.deepEqual(sent.params, [expected]);
	});

	test('lookupTxBlockHash', async () => {
		assert.equal(await electrumAddressApi.lookupTxBlockHash('00'.repeat(32)), 'blockhash1');
	});

	test('RPC stats are counted', () => {
		assert.ok(global.electrumStats.rpc.blockchainScripthash_getHistory.successes >= 2);
		assert.ok(global.electrumStats.rpc.blockchainScripthash_getBalance.successes >= 2);
	});
});
