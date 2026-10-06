'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, test } = require('node:test');

const { fakeRpc } = require('./helpers/setup.js');
const config = require('../app/config.js');
const coins = require('../app/coins.js');
const rpcApi = require('../app/api/rpcApi.js');

const coinConfig = coins[config.coin];
const txid = 'ab'.repeat(32);
const blockhash = 'cd'.repeat(32);

beforeEach(() => {
	global.activeBlockchain = 'main';
	global.rpcConnected = true;
	global.txindexAvailable = true;
	global.btcNodeSemver = '29.4.2';
	global.miningPoolsConfigs = undefined;
});

afterEach(() => {
	global.rpcConnected = true;
	global.txindexAvailable = true;
	global.btcNodeSemver = '29.4.2';
});

describe('connection and versions', () => {
	test('no RPC connection rejects without asking the node', async () => {
		const calls = fakeRpc({ getblockcount: () => 1 });
		global.rpcConnected = false;

		await assert.rejects(rpcApi.getBlockCount(), /No RPC connection available/);
		await assert.rejects(rpcApi.getRpcDataWithParams({ method: 'getblockhash', parameters: [1] }), /No RPC connection available/);
		assert.equal(calls.length, 0);

		assert.equal(await rpcApi.getRpcData('getblockcount', true), 1);
	});

	test('RPC that the node is too old for resolve as unsupported', async () => {
		fakeRpc({});
		global.btcNodeSemver = '0.16.0';

		assert.deepEqual(await rpcApi.getBlockStatsByHeight(5), { success: false, error: 'Unsupported', minRpcVersionNeeded: '0.17.0' });
		assert.deepEqual(await rpcApi.getIndexInfo(), { success: false, error: 'Unsupported', minRpcVersionNeeded: '0.21.0' });
		assert.deepEqual(await rpcApi.getDeploymentInfo(), { success: false, error: 'Unsupported', minRpcVersionNeeded: '23.0.0' });
	});

	test('the genesis block stats are built in', async () => {
		const calls = fakeRpc({});

		assert.deepEqual(await rpcApi.getBlockStatsByHeight(0), coinConfig.genesisBlockStatsByNetwork.main);
		assert.deepEqual(await rpcApi.getBlockStats(coinConfig.genesisBlockHashesByNetwork.main), coinConfig.genesisBlockStatsByNetwork.main);
		assert.equal(calls.length, 0);
	});

	test('getblockstats is asked of the node otherwise', async () => {
		const calls = fakeRpc({ getblockstats: params => ({ asked: params }) });

		assert.deepEqual(await rpcApi.getBlockStatsByHeight(7), { asked: [7] });
		assert.equal(calls[0].method, 'getblockstats');
	});

	test('the UTXO set summary uses the coin stats index when there is one', async () => {
		const calls = fakeRpc({ gettxoutsetinfo: params => ({ params }) });

		global.getindexinfo = { coinstatsindex: {} };
		assert.deepEqual(await rpcApi.getUtxoSetSummary(), { params: ['muhash'] });
		assert.deepEqual(await rpcApi.getUtxoSetSummary(false), { params: [] });

		global.getindexinfo = {};
		assert.deepEqual(await rpcApi.getUtxoSetSummary(), { params: [] });
		assert.equal(calls.length, 3);
	});

	test('the blockchain info keeps the prune height up to date', async () => {
		fakeRpc({ getblockchaininfo: () => ({ pruned: true, pruneheight: 123 }) });
		await rpcApi.getBlockchainInfo();
		assert.equal(global.pruneHeight, 123);
	});

	test('a failing call is counted in the stats and logged with the request', async () => {
		global.errorStats = {};
		global.rpcStats = {};
		fakeRpc({ getblockchaininfo: () => ({ error: { code: -1, message: 'boom' } }) });

		await assert.rejects(rpcApi.getRpcData('getblockchaininfo'), err => err.userData.request === 'getblockchaininfo');

		assert.equal(global.rpcStats.getblockchaininfo.failures, 1);
		assert.equal(global.errorStats['RpcError-001'].count, 1);
	});
});

describe('blocks', () => {
	test('getBlockByHeight resolves the hash first', async () => {
		fakeRpc({
			getblockhash: params => (params[0] === 5 ? blockhash : null),
			getblock: () => ({ hash: blockhash, height: 5, tx: [txid] }),
			getrawtransaction: () => ({ txid, vin: [{ coinbase: '00' }], vout: [{ value: 3.125, scriptPubKey: { address: 'miner-address' } }] })
		});

		const block = await rpcApi.getBlockByHeight(5);

		assert.equal(block.hash, blockhash);
		assert.equal(block.coinbaseTx.txid, txid);
		assert.equal(block.miner.name, 'miner-address');
		assert.equal(block.subsidy.toString(), '50');
		assert.equal(block.totalFees.toString(), '-46.875');
	});

	test('a pruned block falls back to its header, without transactions', async () => {
		fakeRpc({
			getblock: () => ({ error: { code: -1, message: 'Block not available (pruned data)' } }),
			getblockheader: () => ({ hash: blockhash, height: 5 })
		});

		const block = await rpcApi.getBlockByHash(blockhash);

		assert.deepEqual(block.tx, []);
		assert.equal(block.height, 5);
		assert.equal(block.subsidy.toString(), '50');
	});

	test('the header by height', async () => {
		fakeRpc({ getblockhash: () => blockhash, getblockheader: params => ({ asked: params[0] }) });

		assert.deepEqual(await rpcApi.getBlockHeaderByHeight(9), { asked: blockhash });
	});
});

describe('transactions', () => {
	test('the genesis coinbase gets its confirmations from the chain', async () => {
		fakeRpc({ getblockchaininfo: () => ({ blocks: 960000 }) });

		const tx = await rpcApi.getRawTransaction(coinConfig.genesisCoinbaseTransactionIdsByNetwork.main);

		assert.equal(tx.confirmations, 960000);
	});

	test('an ordinary transaction, with and without a block hash', async () => {
		const calls = fakeRpc({ getrawtransaction: params => ({ txid: params[0] }) });

		assert.deepEqual(await rpcApi.getRawTransaction(txid), { txid });
		await rpcApi.getRawTransaction(txid, blockhash);

		assert.deepEqual(calls[0].params, [txid, 1]);
		assert.deepEqual(calls[1].params, [txid, 1, blockhash]);
	});

	test('a missing transaction rejects when there is a transaction index', async () => {
		fakeRpc({ getrawtransaction: () => ({ error: { code: -5, message: 'No such transaction' } }) });

		await assert.rejects(rpcApi.getRawTransaction(txid));
	});

	test('without a transaction index, wallets and then recent blocks are searched', async () => {
		global.txindexAvailable = false;
		const original = config.noTxIndexSearchDepth;
		config.noTxIndexSearchDepth = 3;

		try {
			const calls = fakeRpc({
				getrawtransaction: params => (params[2] === 'hash-98' ? { txid: params[0], found: 'in block' } : { error: { code: -5, message: 'No such transaction' } }),
				listwallets: () => ['w1'],
				gettransaction: () => ({ error: { code: -5, message: 'Invalid or non-wallet transaction id' } }),
				getblockcount: () => 100,
				getblockhash: params => 'hash-' + params[0]
			});

			const tx = await rpcApi.getRawTransaction(txid);

			assert.equal(tx.found, 'in block');
			assert.ok(calls.some(c => c.method === 'gettransaction'));
			assert.equal(global.rpcClient.wallet, null);
		} finally {
			config.noTxIndexSearchDepth = original;
		}
	});

	test('without a transaction index and nowhere to find it, the error says where it looked', async () => {
		global.txindexAvailable = false;
		const original = config.noTxIndexSearchDepth;
		config.noTxIndexSearchDepth = 2;

		try {
			fakeRpc({
				getrawtransaction: () => ({ error: { code: -5, message: 'No such transaction' } }),
				listwallets: () => [],
				getblockcount: () => 10,
				getblockhash: params => 'hash-' + params[0]
			});

			await assert.rejects(rpcApi.getRawTransaction(txid), /cannot be found in wallet transactions, mempool transactions, or recently confirmed transactions/);
		} finally {
			config.noTxIndexSearchDepth = original;
		}
	});

	test('a transaction found in a wallet has its decoded fields merged in', async () => {
		global.txindexAvailable = false;

		fakeRpc({
			getrawtransaction: () => ({ error: { code: -5, message: 'No such transaction' } }),
			listwallets: () => ['w1'],
			gettransaction: () => ({ txid, amount: 1, decoded: { vin: [], vout: [] } })
		});

		const tx = await rpcApi.getRawTransaction(txid, blockhash);

		assert.deepEqual(tx, { txid, amount: 1, vin: [], vout: [], decoded: null });
	});

	test('getUtxo: spent is "0", unspent is the output, an error rejects', async () => {
		fakeRpc({ gettxout: params => (params[1] === 0 ? { value: 1 } : null) });
		assert.deepEqual(await rpcApi.getUtxo(txid, 0), { value: 1 });
		assert.equal(await rpcApi.getUtxo(txid, 1), '0');
	});
});

describe('mempool', () => {
	test('getRawMempool keys the entries by txid and skips the ones that left', async () => {
		fakeRpc({
			getrawmempool: () => ['t1', 't2'],
			getmempoolentry: params => (params[0] === 't1' ? { vsize: 100 } : { error: { code: -5, message: 'gone' } })
		});

		assert.deepEqual(await rpcApi.getRawMempool(), { t1: { vsize: 100, txid: 't1' } });
	});

	test('getMempoolTxDetails with and without ancestors and descendants', async () => {
		const calls = fakeRpc({
			getmempoolentry: () => ({ vsize: 1 }),
			getmempoolancestors: () => ['a'],
			getmempooldescendants: () => ['d']
		});

		assert.deepEqual(await rpcApi.getMempoolTxDetails(txid), { entry: { vsize: 1 }, ancestors: ['a'], descendants: ['d'] });
		calls.length = 0;
		assert.deepEqual(await rpcApi.getMempoolTxDetails(txid, false), { entry: { vsize: 1 } });
		assert.equal(calls.length, 1);
	});
});

describe('simple calls', () => {
	test('chain tx stats take an optional end block, smart fee takes the mode and target', async () => {
		const calls = fakeRpc({ getchaintxstats: () => ({}), estimatesmartfee: () => ({}), getnetworkhashps: () => 1 });

		await rpcApi.getChainTxStats(10);
		await rpcApi.getChainTxStats(10, blockhash);
		await rpcApi.getSmartFeeEstimate('ECONOMICAL', 6);
		await rpcApi.getNetworkHashrate();

		assert.deepEqual(calls.map(c => c.params), [[10], [10, blockhash], [6, 'ECONOMICAL'], [144]]);
	});
});
