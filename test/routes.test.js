'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

require('./helpers/setup.js');
const baseRouter = require('../routes/baseRouter.js');

const registered = baseRouter.stack
	.filter(layer => layer.route)
	.flatMap(layer => Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route.path}`));

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
	const handler = baseRouter.stack.find(layer => layer.route && layer.route.path === '/terminal' && layer.route.methods.post).route.stack[0].handle;

	// call the route as express would and return what it wrote
	function run(body) {
		return new Promise(resolve => {
			let written = '';
			const res = {
				write: (data, callback) => { written += data; callback(); },
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
	const apiRouter = require('../routes/apiRouter.js');

	function handlerFor(path) {
		return apiRouter.stack.find(layer => layer.route && layer.route.path === path && layer.route.methods.get).route.stack[0].handle;
	}

	// call a route as express would; resolves with what it sent as JSON
	function getJson(path) {
		return new Promise((resolve, reject) => {
			const res = { json: body => resolve(body) };

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
