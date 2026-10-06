import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "./helpers/setup.js";
import baseRouter from "../routes/baseRouter.js";
import apiRouter from "../routes/apiRouter.js";
import type { Router } from "express";
import type { RpcData } from "../app/api/rpcApi.js";

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
