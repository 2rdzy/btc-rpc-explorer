import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { fakeRpc } from "./helpers/setup.js";
import config from "../app/config.js";
import * as coreApi from "../app/api/coreApi.js";
import type { RpcData } from "../app/api/rpcApi.js";

const txid = (n: number) => String(n).padStart(64, '0');
const hash = (n: number) => 'f'.repeat(60) + String(n).padStart(4, '0');

beforeEach(() => {
	global.activeBlockchain = 'main';
	global.rpcConnected = true;
	global.txindexAvailable = true;
	global.prunedBlockchain = false;
	global.btcNodeSemver = '29.4.2';
	global.miningPoolsConfigs = undefined;
	global.SATS_PER_BTC = 1e8;
	global.errorStats = {};
});

describe('simple lookups', () => {
	test('genesis hash and coinbase transaction id', () => {
		assert.match(coreApi.getGenesisBlockHash(), /^000000000019d668/);
		assert.match(coreApi.getGenesisCoinbaseTransactionId(), /^4a5e1e4b/);
	});

	test('getUtxo gives null for a spent output', async () => {
		fakeRpc({ gettxout: params => (params[1] === 0 ? { value: 1 } : null) });

		assert.deepEqual(await coreApi.getTxUtxos({ txid: txid(1), vout: [{}, {}] }), [{ value: 1 }, null]);
	});

	test('getMempoolTxids pages the txids', async () => {
		fakeRpc({ getrawmempool: () => ['a', 'b', 'c', 'd'] });

		assert.deepEqual(await coreApi.getMempoolTxids(2, 1), { txCount: 4, txids: ['b', 'c'] });
	});

	test('smart fee estimates are asked for each target', async () => {
		const calls = fakeRpc({ estimatesmartfee: params => ({ feerate: params[0] }) });

		const out = await coreApi.getSmartFeeEstimates('ECONOMICAL', [2, 6]);

		assert.deepEqual(out, [{ feerate: 2 }, { feerate: 6 }]);
		assert.deepEqual(calls.map(c => c.params), [[2, 'ECONOMICAL'], [6, 'ECONOMICAL']]);
	});

	test('several blocks, headers and stats by height', async () => {
		fakeRpc({
			getblockhash: params => hash(params[0]),
			getblock: params => ({ hash: params[0], height: Number(params[0].slice(-4)), tx: [txid(1)] }),
			getrawtransaction: () => ({ txid: txid(1), vin: [{ coinbase: '00' }], vout: [{ value: 50, scriptPubKey: {} }] }),
			getblockheader: params => ({ hash: params[0], height: Number(params[0].slice(-4)) }),
			getblockstats: params => ({ height: params[0] })
		});

		assert.deepEqual((await coreApi.getBlocksByHeight([11, 12])).map(b => b.height), [11, 12]);
		assert.deepEqual((await coreApi.getBlockHeadersByHeight([13, 14])).map(b => b.height), [13, 14]);
		assert.deepEqual(await coreApi.getBlocksStatsByHeight([15, 16]), [{ height: 15 }, { height: 16 }]);
		assert.deepEqual(Object.keys(await coreApi.getBlocksByHash([hash(21), hash(22)])), [hash(21), hash(22)]);
	});
});

describe('BLAKE2b fork awareness', () => {
	test('the fork height comes from the deployment info when it is active', async () => {
		fakeRpc({ getdeploymentinfo: () => ({ blake2b: { active: true, height: 961640 } }) });
		assert.equal(await coreApi.getBlake2bForkHeight(), 961640);
	});

	test('no fork height when it is not active, or the call fails', async () => {
		fakeRpc({ getdeploymentinfo: () => ({ blake2b: { active: false, height: 961640 } }) });
		assert.equal(await coreApi.getBlake2bForkHeight(), null);

		fakeRpc({ getdeploymentinfo: () => ({ error: { code: -1, message: 'boom' } }) });
		assert.equal(await coreApi.getBlake2bForkHeight(), null);
		assert.equal(global.errorStats.blake2bForkHeight.count, 1);
	});

	test('the hashrate over a window that crosses the fork is null', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ blake2b: { active: true, height: 961640 } }),
			getblockchaininfo: () => ({ blocks: 962000 }),
			getnetworkhashps: params => 1000 + params[0]
		});

		assert.equal(await coreApi.getNetworkHashrate(1008), null);
		assert.equal(await coreApi.getNetworkHashrate(144), 1144);
	});
});

describe('peers and help', () => {
	test('getPeerSummary counts versions, services, connection types and networks', async () => {
		fakeRpc({
			getpeerinfo: () => [
				{ subver: '/Satoshi:29.0.0/', servicesnames: ['NETWORK', 'WITNESS'], connection_type: 'outbound-full-relay', network: 'ipv4' },
				{ subver: '/Satoshi:29.0.0/', servicesnames: ['NETWORK'], connection_type: 'inbound', network: 'ipv4' },
				{ subver: '/Knots:1/', servicesnames: ['WITNESS'], connection_type: 'inbound', network: 'onion' }
			]
		});

		const out = await coreApi.getPeerSummary();

		assert.deepEqual(out.versionSummary, [['/Satoshi:29.0.0/', 2], ['/Knots:1/', 1]]);
		assert.deepEqual(out.servicesSummary, [['NETWORK', 2], ['WITNESS', 2]]);
		assert.deepEqual(out.connectionTypeSummary, [['inbound', 2], ['outbound-full-relay', 1]]);
		assert.deepEqual(out.networkTypeSummary, [['ipv4', 2], ['onion', 1]]);
		assert.equal(out.serviceNamesAvailable, true);
		assert.equal(out.getpeerinfo.length, 3);
	});

	test('older nodes: numeric services and no connection type', async () => {
		fakeRpc({ getpeerinfo: () => [{ subver: 'a', services: '0409' }, { subver: 'b', services: '0409' }] });

		const out = await coreApi.getPeerSummary();

		assert.deepEqual(out.servicesSummary, [['0409', 2]]);
		assert.equal(out.serviceNamesAvailable, false);
		assert.equal('connectionTypeSummary' in out, false);
		assert.equal('networkTypeSummary' in out, false);
	});

	test('getHelp splits the node help into sections of methods', async () => {
		fakeRpc({ help: () => '== Blockchain ==\ngetblock "blockhash" ( verbosity )\ngetblockcount\n\n== Wallet ==\nsendtoaddress "address" amount' });

		assert.deepEqual(await coreApi.getHelp(), [
			{ name: 'Blockchain', methods: [{ name: 'getblock', content: 'getblock "blockhash" ( verbosity )' }, { name: 'getblockcount', content: 'getblockcount' }] },
			{ name: 'Wallet', methods: [{ name: 'sendtoaddress', content: 'sendtoaddress "address" amount' }] }
		]);
	});

	test('getRpcMethodHelp picks out the arguments', async () => {
		fakeRpc({ help: () => 'getblock "blockhash" ( verbosity )\n\nArguments:\n1. blockhash    (string, required) The block hash\n2. verbosity    (numeric, optional, default=1) 0 for hex\n     more details\n\nResult:\n...' });

		const out = await coreApi.getRpcMethodHelp('getblock');

		assert.equal(out.args.length, 2);
		assert.deepEqual(out.args[0], { name: 'blockhash', detailsLines: [], properties: ['string', 'required'], description: 'The block hash' });
		assert.equal(out.args[1].name, 'verbosity');
		assert.deepEqual(out.args[1].detailsLines, ['     more details']);
		assert.match(out.string, /^getblock/);
	});
});

describe('transactions with inputs', () => {
	const prev = (n: number) => ({ txid: txid(n), vout: [{ value: 2, n: 0, scriptPubKey: { asm: 'x', hex: 'y', type: 'pubkeyhash', address: 'a' } }], time: 1000, vin: [{ txid: txid(99), vout: 0 }] });

	test('the outputs spent by the inputs are summarized', async () => {
		fakeRpc({
			getrawtransaction: params => (params[0] === txid(1) ? { txid: txid(1), vin: [{ txid: txid(9), vout: 0 }], vout: [{ value: 1.5 }] } : prev(9))
		});

		const out = await coreApi.getRawTransactionsWithInputs([txid(1)]);

		assert.equal(out.transactions.length, 1);
		const input = out.txInputsByTransaction[txid(1)][0];
		assert.equal(input.txid, txid(9));
		assert.equal(input.utxoTime, 1000);
		assert.equal(input.scriptPubKey.asm, undefined);
		assert.equal(input.scriptPubKey.hex, undefined);
	});

	test('without a transaction index there are no inputs', async () => {
		global.txindexAvailable = false;
		fakeRpc({ getrawtransaction: () => ({ txid: txid(1), vin: [{ txid: txid(9), vout: 0 }], vout: [] }), listwallets: () => [] });

		const out = await coreApi.getRawTransactionsWithInputs([txid(1)]);

		assert.deepEqual(out.txInputsByTransaction, {});
	});

	test('a block with a page of transactions finds its miner from the coinbase', async () => {
		fakeRpc({
			getblock: () => ({ hash: hash(1), height: 5, tx: [txid(1), txid(2), txid(3)] }),
			getrawtransaction: params => (params[0] === txid(1)
				? { txid: txid(1), vin: [{ coinbase: '00' }], vout: [{ value: 50, scriptPubKey: { address: 'miner' } }] }
				: { txid: params[0], vin: [{ coinbase: '00' }], vout: [{ value: 1, scriptPubKey: {} }] })
		});

		const page1 = await coreApi.getBlockByHashWithTransactions(hash(1), 2, 0);
		assert.deepEqual(page1.transactions.map((t: RpcData) => t.txid), [txid(1), txid(2)]);
		assert.equal(page1.getblock.miner.name, 'miner');

		const page2 = await coreApi.getBlockByHashWithTransactions(hash(1), 2, 2);
		assert.deepEqual(page2.transactions.map((t: RpcData) => t.txid), [txid(3)]);
		assert.equal(page2.getblock.miner.name, 'miner');
	});

	test('without a transaction index a failure gives the block with no transactions', async () => {
		global.txindexAvailable = false;
		fakeRpc({
			getblock: () => ({ hash: hash(2), height: 6, tx: [txid(1)] }),
			getrawtransaction: params => (params[0] === txid(1) ? { txid: txid(1), vin: [{ coinbase: '00' }], vout: [{ value: 50, scriptPubKey: {} }] } : { error: { code: -5, message: 'none' } })
		});

		const first = await coreApi.getBlockByHashWithTransactions(hash(2), 5, 0);
		assert.equal(first.transactions.length, 1);

		fakeRpc({
			getblock: () => ({ hash: hash(3), height: 7, tx: [txid(1)] }),
			getblockheader: () => ({ hash: hash(3), height: 7 }),
			getrawtransaction: () => ({ error: { code: -5, message: 'none' } }),
			listwallets: () => []
		});
		const original = config.noTxIndexSearchDepth;
		config.noTxIndexSearchDepth = 0;
		try {
			const out = await coreApi.getBlockByHashWithTransactions(hash(3), 5, 0);
			assert.deepEqual(out.transactions, []);
			assert.deepEqual(out.txInputsByTransaction, {});
		} finally {
			config.noTxIndexSearchDepth = original;
		}
	});

	test('with a transaction index a failure rejects', async () => {
		fakeRpc({
			getblock: () => ({ hash: hash(4), height: 8, tx: [txid(1)] }),
			getrawtransaction: () => ({ error: { code: -5, message: 'none' } })
		});

		await assert.rejects(coreApi.getBlockByHashWithTransactions(hash(4), 5, 0));
	});

	test('buildBlockAnalysisData summarizes each transaction in turn', async () => {
		fakeRpc({
			getrawtransaction: params => (params[0] === txid(1)
				? { txid: txid(1), version: 2, size: 200, vsize: 150, weight: 600, time: 90000, vin: [{ txid: txid(9), vout: 0, sequence: 1 }], vout: [{ value: 1.5, scriptPubKey: { type: 'witness_v0_keyhash', address: 'x' } }] }
				: { txid: txid(9), vout: [{ value: 2, n: 0, scriptPubKey: { type: 'pubkeyhash', address: 'a' } }], time: 3600, vin: [{ txid: txid(99), vout: 0 }] })
		});

		const results: RpcData[] = [];
		await new Promise<void>(resolve => coreApi.buildBlockAnalysisData(5, hash(1), [txid(1)], 0, results, resolve));

		assert.equal(results.length, 1);
		assert.equal(results[0].txid, txid(1));
		assert.equal(results[0].totalInput.toString(), '2');
		assert.equal(results[0].totalOutput.toString(), '1.5');
		assert.equal(results[0].totalFee.toString(), '0.5');
		assert.equal(results[0].vin[0].type, 'pubkeyhash');
		assert.equal(results[0].totalDaysDestroyed.toNumber(), 2 * (90000 - 3600) / 86400);
	});
});

describe('transactions by height', () => {
	test('each transaction is looked up with the hash of the block at its height', async () => {
		const calls = fakeRpc({
			getblockhash: params => hash(params[0]),
			getrawtransaction: params => ({ txid: params[0] })
		});

		const out = await coreApi.getRawTransactionsByHeights([txid(1), txid(2)], { [txid(1)]: 700 });

		assert.deepEqual(out, [{ txid: txid(1) }, { txid: txid(2) }]);
		const lookups = calls.filter(c => c.method === 'getrawtransaction').map(c => c.params).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

		assert.deepEqual(lookups, [[txid(1), 1, hash(700)], [txid(2), 1]]);
	});
});

describe('next block, difficulty and chain stats (the fee groups and the range)', () => {
	test('a transaction with unconfirmed parents counts with its effective fee rate', async () => {
		fakeRpc({
			getblocktemplate: () => ({
				height: 5,
				weightlimit: 4000000,
				coinbasevalue: 5000010000,
				transactions: [
					{ txid: 'low', fee: 1000, weight: 400, depends: [] },
					{ txid: 'high', fee: 3000, weight: 400, depends: [] },
					{ txid: 'parent', fee: 1000, weight: 400, depends: [] },
					{ txid: 'child', fee: 4000, weight: 400, depends: [3] }
				]
			})
		});

		const out = await coreApi.getNextBlockEstimate();

		// 'low' (10) and 'high' (30) are the extremes: the parent and the child do not count for them
		assert.equal(out.minFeeRate, 10);
		assert.equal(out.maxFeeRate, 30);
		assert.equal(out.medianFeeRate, 30);

		// ten groups of 2: the child's fee together with its parent's is 5000 for 800 weight = 25, in [24, 26)
		assert.equal(out.feeRateGroups[7].minFeeRate, 24);
		assert.equal(out.feeRateGroups[7].txidCount, 1);
		assert.equal(out.feeRateGroups[7].totalWeight, 400);
		// 'low' and the parent (10 each) are in the first group, and nothing is at or above 30
		assert.equal(out.feeRateGroups[0].txidCount, 2);
		assert.equal(out.feeRateGroups.reduce((n: number, group: RpcData) => n + group.txidCount, 0), 3);
	});

	test('getTxStats asks for one window per block when the range is shorter than the number of windows', async () => {
		const calls = fakeRpc({
			getblockchaininfo: () => ({ blocks: 1000 }),
			getblockhash: params => hash(params[0]),
			getchaintxstats: () => ({ window_tx_count: 10, txrate: 1, window_interval: 600 })
		});

		const out = await coreApi.getTxStats(250, 50, 100);

		assert.equal(calls.filter(c => c.method === 'getchaintxstats').length, 50);
		assert.equal(out.blocksPerPoint, 1);
	});

	test('getNextBlockEstimate groups the template by fee rate', async () => {
		fakeRpc({
			getblocktemplate: () => ({
				height: 5,
				weightlimit: 4000000,
				coinbasevalue: 5000010000,
				transactions: [
					{ txid: 'a', fee: 1000, weight: 400, depends: [] },
					{ txid: 'b', fee: 4000, weight: 400, depends: [] },
					{ txid: 'c', fee: 800, weight: 400, depends: [2] }
				]
			})
		});

		const out = await coreApi.getNextBlockEstimate();

		assert.equal(out.weight, 1200);
		assert.equal(out.minFeeTxid, 'a');
		// 'b' is the parent of 'c', so only 'a' counts for the minimum and maximum
		assert.equal(out.maxFeeTxid, 'a');
		assert.equal(out.minFeeRate, 10);
		assert.equal(out.maxFeeRate, 10);
		assert.equal(out.feeRateGroups.length, 10);
		assert.equal(out.totalFees.toString(), '0.0001');
	});

	test('no block template is an error', async () => {
		fakeRpc({ getblocktemplate: () => ({}) });

		await assert.rejects(coreApi.getNextBlockEstimate(), /The node did not return a block template/);
	});

	test('getDifficultyByBlockHeights', async () => {
		global.difficultyByBlockheightCache = {};
		fakeRpc({
			getblockhash: params => hash(params[0]),
			getblockheader: params => (Number(params[0].slice(-4)) < 2000 ? { height: 1500, difficulty: 100, time: 5 } : { height: 2500, difficulty_blake2b: 7, time: 9 })
		});

		const out = await coreApi.getDifficultyByBlockHeights([1500, 2500]);

		assert.deepEqual(out, { 1500: { difficulty: 100, blake2b: false, time: 5 }, 2500: { difficulty: 7, blake2b: true, time: 9 } });
		assert.equal(global.difficultyByBlockheightCacheDirty, true);
	});

	test('getTxStats understands the keywords and builds the series', async () => {
		fakeRpc({
			getblockchaininfo: () => ({ blocks: 1000 }),
			getblockhash: params => hash(params[0]),
			getchaintxstats: params => ({ window_tx_count: 10 * params[0], txrate: 1, window_interval: 600 })
		});

		const out = await coreApi.getTxStats(2, 'genesis', 'latest');

		assert.equal(out.blocksPerPoint, 500);
		assert.deepEqual(out.txCounts, [{ x: 500, y: 5000 }, { x: 0, y: 4990 }]);
		assert.deepEqual(out.txLabels, [1, 0]);
		assert.equal(out.avgTimespan, 600);

		await assert.rejects(coreApi.getTxStats(2, 10, 5), /blockStart \(10\) > blockEnd \(5\)/);
	});

	test('getUtxoSetSummary marks where it came from', async () => {
		global.getindexinfo = { coinstatsindex: {} };
		fakeRpc({ gettxoutsetinfo: () => ({ total_amount: 19000000 }) });

		const out = await coreApi.getUtxoSetSummary(true, false);

		assert.equal(out.total_amount, 19000000);
		assert.equal(out.usingCoinStatsIndex, true);
		assert.ok(out.lastUpdated > 0);
	});
});

describe('mempool and mining summaries', () => {
	const entry = (fee: number, size: number, time: number, depends: string[] = []) => ({ fees: { modified: fee, ancestor: fee }, ancestorsize: size, depends, time, weight: size * 4 });

	test('mempool transaction summaries, in sats, with progress updates', async () => {
		fakeRpc({
			getmempoolentry: params => (({ t1xxxxxxxxx: entry(0.0001, 200, 1000), t2xxxxxxxxx: entry(0.0002, 100, 2000, ['t1xxxxxxxxx']) } as Record<string, unknown>)[params[0]])
		});
		const updates: { count: number, done: number }[] = [];

		const out = await coreApi.getMempoolTxSummaries(['t1xxxxxxxxx', 't2xxxxxxxxx'], 'status', status => { updates.push(status); });

		assert.deepEqual(out.map((x: RpcData) => x.key).sort(), ['t1xxxxxxxx', 't2xxxxxxxx']);
		const first = out.find((x: RpcData) => x.key === 't1xxxxxxxx');
		assert.equal(first.f, 10000);
		assert.equal(first.w, 800);
		assert.equal(first.t, 1000);
		assert.deepEqual(out.find((x: RpcData) => x.key === 't2xxxxxxxx').a, ['t1xxxxxxxx']);
		assert.equal(updates.length, 2);
		assert.equal(updates.at(-1)!.done, updates.at(-1)!.count);
	});

	test('buildMempoolSummary and buildPredictedBlocks run over the same summaries', async () => {
		const ids = ['aaaaaaaaaa01', 'bbbbbbbbbb02', 'cccccccccc03'];
		fakeRpc({
			getrawmempool: () => ids,
			getmempoolentry: params => entry(0.00005 * (ids.indexOf(params[0]) + 1), 200 + ids.indexOf(params[0]) * 10, 1000)
		});

		const summary = await coreApi.buildMempoolSummary('s', 5, 5, () => {});

		assert.equal(summary.count, 3);
		assert.equal(summary.oldestTxs.length, 3);
		assert.equal(summary.oldestTxs[0].txid.length, 12);
		assert.ok(summary.totalFees.gt(0));
		assert.equal(summary.satoshiPerByteBucketCounts.length, summary.satoshiPerByteBuckets.length);

		const log = console.log;
		console.log = () => {};
		try {
			const blocks = await coreApi.buildPredictedBlocks('s', () => {});
			assert.equal(blocks.length, 1);
			assert.equal(blocks[0].txCount, 3);
		} finally {
			console.log = log;
		}
	});

	// three transactions whose orders by age, by size, by fee rate and by ancestor fee rate all differ:
	//   age (oldest first):  a, c, b      size (largest first):  a, b, c
	//   fee rate:            b, c, a      ancestor fee rate:     b, c, a
	// (their own ids: the summaries of transactions are cached by the start of the txid)
	const orderedIds = ['dddddddddd01', 'eeeeeeeeee02', 'ffffffffff03'];
	const orderedEntries: Record<string, ReturnType<typeof entry>> = {
		[orderedIds[0]]: entry(0.0001, 300, 1000),
		[orderedIds[1]]: entry(0.0003, 200, 3000),
		[orderedIds[2]]: entry(0.00004, 100, 2000)
	};

	test('the age labels of the mempool summary say days, hours, minutes or seconds by the oldest transaction', async () => {
		const now = Math.floor(Date.now() / 1000);

		// [txid, age of the oldest transaction in seconds, the unit and last label that is expected]
		const cases: [string, number, string, string][] = [
			['gggggggggg01', 3 * 86400, 'd', '3.0d'],
			['hhhhhhhhhh02', 5 * 3600, 'h', '5.0h'],
			['iiiiiiiiii03', 30 * 60, 'm', '30.0m'],
			['jjjjjjjjjj04', 45, 's', '45s']
		];

		for (const [id, age, unit, lastLabel] of cases) {
			fakeRpc({ getrawmempool: () => [id], getmempoolentry: () => entry(0.0001, 200, now - age) });

			const labels: string[] = (await coreApi.buildMempoolSummary('s', 5, 5, () => {})).ageBucketLabels;

			assert.equal(labels.length, 5);
			assert.ok(labels.every(label => label.endsWith(unit)), `${unit}: ${labels}`);
			assert.equal(labels[4], lastLabel);
		}
	});

	test('the size and fee rate labels of the mempool summary', async () => {
		const now = Math.floor(Date.now() / 1000);
		const ids = ['kkkkkkkkkk01', 'llllllllll02', 'mmmmmmmmmm03'];
		const entries: Record<string, ReturnType<typeof entry>> = {
			[ids[0]]: entry(0.0001, 300, now - 600),
			[ids[1]]: entry(0.0003, 200, now - 600),
			[ids[2]]: entry(0.00004, 100, now - 600)
		};
		fakeRpc({ getrawmempool: () => ids, getmempoolentry: params => entries[params[0]] });

		const summary = await coreApi.buildMempoolSummary('s', 5, 5, () => {});

		// the largest is 300: five buckets of 60
		assert.deepEqual(summary.sizeBucketLabels, ['0 - 60', 120, 180, 240, '240+']);
		assert.deepEqual(summary.sizeBucketTxCounts, [0, 1, 0, 1, 1]);

		// fee rates of 33.3, 150 and 40 sat/vB: buckets of 1, and everything above the top 0.25% of the weight in one
		// bucket labelled by where it starts
		assert.equal(summary.satoshiPerByteBucketLabels.length, 151);
		assert.equal(summary.satoshiPerByteBucketLabels[0], '[0 - 1)');
		assert.equal(summary.satoshiPerByteBucketLabels[33], '[33 - 34)');
		assert.equal(summary.satoshiPerByteBucketLabels[149], '[149 - 150)');
		assert.equal(summary.satoshiPerByteBucketLabels[150], '150+');
		assert.equal(summary.satoshiPerByteBucketCounts.length, 151);
		assert.deepEqual([33, 40, 150].map(i => summary.satoshiPerByteBucketCounts[i]), [1, 1, 1]);
		assert.equal(summary.satoshiPerByteBucketCounts.reduce((a: number, b: number) => a + b, 0), 3);

		// ten minutes old at most: the age is given in minutes
		assert.ok(summary.ageBucketLabels.every((label: string) => label.endsWith('m')), summary.ageBucketLabels);
	});

	test('the fee rate buckets are in sat/vB: a transaction paying the 1 sat/vB minimum is not in the one below 1', async () => {
		const now = Math.floor(Date.now() / 1000);
		const entries: Record<string, ReturnType<typeof entry>> = {
			nnnnnnnnnn01: entry(0.000004, 400, now - 60),
			oooooooooo02: entry(0.0000099, 400, now - 60)
		};
		fakeRpc({ getrawmempool: () => Object.keys(entries), getmempoolentry: params => entries[params[0]] });

		const summary = await coreApi.buildMempoolSummary('s', 5, 5, () => {});

		// 400 sat for 400 vB is 1 sat/vB, and 990 sat for 400 vB is 2.475
		assert.equal(summary.satoshiPerByteBucketCounts[0], 0);
		assert.equal(summary.satoshiPerByteBucketCounts[1], 1);
		assert.equal(summary.satoshiPerByteBucketCounts[2], 1);
	});

	test('the oldest, largest and highest fee transactions are listed in order', async () => {
		fakeRpc({ getrawmempool: () => orderedIds, getmempoolentry: params => orderedEntries[params[0]] });

		const summary = await coreApi.buildMempoolSummary('s', 5, 5, () => {});

		assert.deepEqual(summary.oldestTxs.map((x: RpcData) => x.txid), [orderedIds[0], orderedIds[2], orderedIds[1]]);
		assert.deepEqual(summary.largestTxs.map((x: RpcData) => x.txid), [orderedIds[0], orderedIds[1], orderedIds[2]]);
		assert.deepEqual(summary.highestFeeTxs.map((x: RpcData) => x.txid), [orderedIds[1], orderedIds[2], orderedIds[0]]);
	});

	test('predicted blocks take the transactions by their ancestor fee rate, highest first', async () => {
		fakeRpc({ getrawmempool: () => orderedIds, getmempoolentry: params => orderedEntries[params[0]] });

		const log = console.log;
		const printed: unknown[][] = [];
		console.log = (...args: unknown[]) => { printed.push(args); };
		try {
			const blocks = await coreApi.buildPredictedBlocks('s', () => {});

			assert.equal(blocks.length, 1);
			assert.deepEqual(blocks[0].txs.map((x: RpcData) => x.txid), [orderedIds[1], orderedIds[2], orderedIds[0]].map(id => id.substring(0, 10)));
		} finally {
			console.log = log;
		}

		// it used to print every block it built, on every request (it uses the debug log now)
		assert.deepEqual(printed, []);
	});

	test('buildMiningSummary groups blocks by miner', async () => {
		global.miningPoolsConfigs = [{ payout_addresses: { addrA: { name: 'PoolA' } }, coinbase_tags: {}, block_hashes: {}, block_heights: {} }];
		fakeRpc({
			getblockhash: params => hash(params[0]),
			getblock: params => ({ hash: params[0], height: Number(params[0].slice(-4)), weight: 1000, tx: [txid(1), txid(2)] }),
			getrawtransaction: () => ({ txid: txid(1), vin: [{ coinbase: '00' }], vout: [{ value: 3.125, scriptPubKey: { address: 'addrA' } }] })
		});
		const updates: { count: number, done: number }[] = [];

		const out = await coreApi.buildMiningSummary('s', 700, 702, s => { updates.push(s); });

		assert.deepEqual(out.minerNamesSortedByBlockCount, ['PoolA']);
		assert.deepEqual(out.miners.PoolA.blocks, [700, 701, 702]);
		assert.equal(out.overall.blockCount, 3);
		assert.equal(out.overall.totalTransactions, 6);
		assert.equal(updates.at(-1)!.done, updates.at(-1)!.count);
	});
});
