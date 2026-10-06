import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "./helpers/setup.js";
import baseRouter from "../routes/baseRouter.js";
import apiRouter from "../routes/apiRouter.js";
import type { Router } from "express";
import type { RpcData } from "../app/api/rpcApi.js";
import { fakeRpc } from "./helpers/setup.js";
import coins from "../app/coins.js";
import config from "../app/config.js";

// express keeps the routes of a router in a stack that its types do not describe
interface RouteLayer {
	route?: { path: string, methods: Record<string, boolean>, stack: { handle: (req: unknown, res: unknown, next: () => void) => void }[] }
}

const stackOf = (router: Router) => (router as unknown as { stack: RouteLayer[] }).stack;

// the handler of the first route registered for the path and method
function routeHandler(router: Router, path: string, method: string) {
	return stackOf(router).find(layer => layer.route && layer.route.path === path && layer.route.methods[method])!.route!.stack[0].handle;
}

const registered = stackOf(baseRouter)
	.filter(layer => layer.route)
	.flatMap(layer => Object.keys(layer.route!.methods).map(method => `${method.toUpperCase()} ${layer.route!.path}`));

describe('routes', () => {
	test('the pages are registered', () => {
		assert.ok(registered.includes('GET /'));
		assert.ok(registered.includes('GET /next-block'));
		assert.ok(registered.includes('GET /node-details'));
	});

	// These two used to let any request replace or null the shared RPC client (a one-request
	// denial of service). They must stay gone.
	for (const route of ['POST /connect', 'GET /connect', 'GET /disconnect', 'POST /disconnect']) {
		test(`${route} is not registered`, () => {
			assert.ok(!registered.includes(route), `${route} should not exist`);
		});
	}
});

describe('terminal route', () => {
	const handler = routeHandler(baseRouter, '/terminal', 'post');

	// call the route as express would and return what it wrote
	function run(body: unknown): Promise<RpcData> {
		return new Promise(resolve => {
			let written = '';
			const res = {
				write: (data: string, callback: () => void) => { written += data; callback(); },
				end: () => resolve(JSON.parse(written))
			};

			handler({ body }, res, () => {});
		});
	}

	test('parsescript turns a script given as hex into its assembly', async () => {
		const p2pkh = '76a914' + '00'.repeat(20) + '88ac';

		assert.deepEqual(await run({ cmd: `parsescript ${p2pkh}` }), { parsed: { asm: `OP_DUP OP_HASH160 ${'00'.repeat(20)} OP_EQUALVERIFY OP_CHECKSIG` } });
	});

	test('parsescript reports input that is not hex, or not a script, instead of failing', async () => {
		assert.match((await run({ cmd: 'parsescript zz' })).Error, /hex/);
		assert.match((await run({ cmd: 'parsescript' })).Error, /hex/);
		assert.match((await run({ cmd: 'parsescript 4c' })).Error, /Unable to parse/);
	});

	test('an unknown command and a missing command are reported', async () => {
		assert.deepEqual(await run({ cmd: 'nope' }), { Error: 'Unknown command' });
		assert.deepEqual(await run({}), { Error: 'No command' });
		assert.deepEqual(await run({ cmd: { a: 1 } }), { Error: 'No command' });
	});
});

describe('transaction page', () => {
	const handler = routeHandler(baseRouter, '/tx/:transactionId', 'get');

	// call the route as express would; resolves with the status and the view that were used
	const load = (txid: string) => new Promise<{ status: number, view: string, message: string | undefined }>((resolve, reject) => {
		const res = {
			locals: {} as RpcData,
			statusCode: 200,
			status(code: number) { this.statusCode = code; return this; },
			render(view: string) { resolve({ status: this.statusCode, view, message: this.locals.userMessageMarkdown }); }
		};

		handler({ params: { transactionId: txid }, query: {}, session: {}, headers: {} }, res, (err?: unknown) => { if (err) reject(err); });
	});

	const unknownTxid = 'ab'.repeat(32);

	test('an unknown transaction is a 404 with the message page', async () => {
		fakeRpc({ getrawtransaction: () => ({ error: { code: -5, message: 'No such mempool or blockchain transaction' } }) });

		const page = await load(unknownTxid);

		assert.equal(page.status, 404);
		assert.equal(page.view, 'transaction');
		assert.match(page.message!, /Failed to load transaction: txid=\*\*ab/);
	});

	test('a page that could not be built (the node cannot be reached) is a 500', async () => {
		fakeRpc({});
		global.rpcConnected = false;

		try {
			assert.equal((await load(unknownTxid)).status, 500);

		} finally {
			global.rpcConnected = true;
		}
	});
});

const coinConfig = coins[config.coin];

describe('block pages', () => {
	// call a block route as express would; resolves with the status and the view that were used
	const load = (path: string, params: Record<string, string>) => new Promise<{ status: number, view: string, message: string | undefined }>((resolve, reject) => {
		const res = {
			locals: { pageErrors: [] } as RpcData,
			statusCode: 200,
			status(code: number) { this.statusCode = code; return this; },
			render(view: string) { resolve({ status: this.statusCode, view, message: this.locals.userMessageMarkdown }); }
		};

		routeHandler(baseRouter, path, 'get')({ params, query: {}, session: {}, headers: {} }, res, (err?: unknown) => { if (err) reject(err); });
	});

	// what the node answers for something it does not know
	const none = { error: { code: -5, message: 'Block not found' } };

	test('an unknown block hash is a 404 with the message page', async () => {
		fakeRpc({ getblock: () => none, getblockheader: () => none });

		const page = await load('/block/:blockHash', { blockHash: 'cd'.repeat(32) });

		assert.equal(page.status, 404);
		assert.equal(page.view, 'block');
		assert.match(page.message!, /Failed to load block/);
	});

	test('a height beyond the chain is a 404 with the message page', async () => {
		fakeRpc({ getblockhash: () => ({ error: { code: -8, message: 'Block height out of range' } }) });

		const page = await load('/block-height/:blockHeight', { blockHeight: '99999999' });

		assert.equal(page.status, 404);
		assert.match(page.message!, /Failed loading block: height=\*\*99999999/);
	});

	test('a block page that could not be built (the node cannot be reached) is a 500', async () => {
		fakeRpc({});
		global.rpcConnected = false;

		try {
			assert.equal((await load('/block/:blockHash', { blockHash: 'cd'.repeat(32) })).status, 500);
			assert.equal((await load('/block-height/:blockHeight', { blockHeight: '5' })).status, 500);

		} finally {
			global.rpcConnected = true;
		}
	});
});

describe('the genesis transaction', () => {
	const genesisTxid = coinConfig.genesisCoinbaseTransactionIdsByNetwork.main;
	const handler = routeHandler(apiRouter, '/tx/:txid', 'get');

	// the API answer for the transaction
	const getTx = () => new Promise<RpcData>((resolve, reject) => handler({ params: { txid: genesisTxid }, query: {} }, { locals: {}, json: (body: RpcData) => resolve(body) }, (err?: unknown) => { if (err) reject(err); }));

	test('is not changed by answering a request for it', async () => {
		fakeRpc({ getblockchaininfo: () => ({ blocks: 960000 }) });
		global.specialTransactions = { [genesisTxid]: { summary: 'The genesis transaction' } };

		const before = JSON.stringify(coinConfig.genesisCoinbaseTransactionsByNetwork.main);

		try {
			const answer = await getTx();

			assert.equal(answer.confirmations, 960000);
			assert.deepEqual(answer.fee, { amount: -50, unit: 'BTC' });
			assert.deepEqual(answer.fun, { summary: 'The genesis transaction' });

		} finally {
			delete global.specialTransactions;
		}

		assert.equal(JSON.stringify(coinConfig.genesisCoinbaseTransactionsByNetwork.main), before);
	});
});

describe('the transaction API', () => {
	const handler = routeHandler(apiRouter, '/tx/:txid', 'get');

	test('does not change the transaction it was given (it may be the cached one)', async () => {
		const spent = { txid: '11'.repeat(32), vout: [{ value: 2, n: 0, scriptPubKey: { type: 'pubkeyhash', address: 'addr' } }], vin: [{ coinbase: '00' }], time: 100, confirmations: 9 };
		const tx = { txid: '22'.repeat(32), confirmations: 5, vin: [{ txid: spent.txid, vout: 0, scriptSig: {} }], vout: [{ value: 1.5 }] };
		const before = JSON.stringify(tx);

		// the same objects every time, as a cache gives them
		fakeRpc({ getrawtransaction: params => (params[0] === tx.txid ? tx : spent) });

		const answer = await new Promise<RpcData>((resolve, reject) => handler({ params: { txid: tx.txid }, query: {} }, { locals: {}, json: (body: RpcData) => resolve(body) }, (err?: unknown) => { if (err) reject(err); }));

		assert.deepEqual(answer.fee, { amount: 0.5, unit: 'BTC' });
		assert.equal(answer.vin[0].value, 2);
		assert.equal(answer.vin[0].scriptSig.address, 'addr');
		assert.equal(JSON.stringify(tx), before);
	});
});

describe('mempool fees', () => {
	const handler = routeHandler(apiRouter, '/mempool/fees', 'get');

	// call the route as express would; resolves with what it sent as JSON
	const getFees = () => new Promise<RpcData>((resolve, reject) => handler({ query: {} }, { json: (body: RpcData) => resolve(body) }, (err?: unknown) => reject(err)));

	const smartFee = () => ({ feerate: 0.0001, blocks: 2 });

	test('answers the smart estimates and the rates of the next block', async () => {
		fakeRpc({
			estimatesmartfee: smartFee,
			getblocktemplate: () => ({ height: 5, weightlimit: 4000000, coinbasevalue: 5000010000, transactions: [{ txid: 'a', fee: 1000, weight: 400, depends: [] }] })
		});

		assert.deepEqual(await getFees(), { nextBlock: { smart: 10, min: 10, max: 10, median: 10 }, '30min': 10, '60min': 10, '1day': 10 });
	});

	test('still answers the smart estimates when the node has no block template', async () => {
		fakeRpc({ estimatesmartfee: smartFee, getblocktemplate: () => ({ error: { code: -9, message: 'Node is not connected' } }) });

		assert.deepEqual(await getFees(), { nextBlock: { smart: 10 }, '30min': 10, '60min': 10, '1day': 10 });
	});
});

describe('price routes with exchange rates disabled (the default)', () => {
	const handlerFor = (path: string) => routeHandler(apiRouter, path, 'get');

	// call a route as express would; resolves with what it sent as JSON
	function getJson(path: string): Promise<RpcData> {
		return new Promise((resolve, reject) => {
			const res = { json: (body: Record<string, unknown>) => resolve(body) };

			try {
				handlerFor(path)({ query: {} }, res, () => {});

			} catch (err) {
				reject(err);
			}
		});
	}

	for (const path of ['/price', '/price/sats', '/price/marketcap']) {
		test(`${path} says that exchange rates are disabled`, async () => {
			delete global.exchangeRates;

			const body = await getJson(path);

			assert.equal(body.success, false);
			assert.match(body.error, /exchange-rate requests disabled/);
		});
	}
});
