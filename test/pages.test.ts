import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { buildApp, requestPage, smokePassword, startApp } from "./helpers/app.js";
import type { RunningApp } from "./helpers/app.js";
import { startFakeNode } from "./helpers/fakeNode.js";
import type { Recorded } from "./helpers/fakeNode.js";
import { pages } from "./fixtures/pages.js";
import { nodeSpecific } from "./fixtures/nodeSpecific.js";

// The whole explorer, as a user meets it: the built application runs as its own process, against a node that answers
// from recorded chain data (blocks and transactions, test/fixtures/rpc.json) and made-up node data (peers, mempool, ...,
// test/fixtures/nodeSpecific.ts), and every page and endpoint of test/fixtures/pages.ts is requested over HTTP. It covers what the other tests do not: the start-up code, the middleware, the routes and
// the templates together.
//
// When a page makes a call that is not in the recording, the test says which: record again with
// `npm run record-fixtures` (it needs a node; see test/fixtures/record.ts).

describe('the explorer against a recorded node', () => {
	let node: Awaited<ReturnType<typeof startFakeNode>>;
	let app: RunningApp;

	before(async () => {
		const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rpc.json'), 'utf8')) as Record<string, Recorded>;

		buildApp();

		// the made-up answers follow the tip of the recorded chain
		const info = (fixtures['getblockchaininfo []'] as { result: Record<string, unknown> }).result;
		const difficultyKey = 'difficulty_blake2b' in info ? 'difficulty_blake2b' : 'difficulty';
		const tip = { height: info.blocks as number, hash: info.bestblockhash as string, bits: info.bits as string, difficultyKey, difficulty: info[difficultyKey] as number, time: info.time as number };

		node = await startFakeNode(fixtures, (method, params) => nodeSpecific(method, params, tip));
		app = await startApp(node.port, { BTCEXP_BASIC_AUTH_PASSWORD: smokePassword });
	}, { timeout: 240000 });

	after(async () => {
		await app?.stop();
		await node?.close();
	});

	for (const page of pages) {
		test(`${page.post ? 'POST ' : ''}${page.path}`, async () => {
			const result = await requestPage(app.baseUrl, page, smokePassword);

			assert.equal(result.status, page.status ?? 200, `status of ${page.path}`);

			if (page.location !== undefined) {
				assert.equal(result.location, page.location);
			}

			for (const expected of page.contains ?? []) {
				if (typeof expected === 'string') {
					assert.ok(result.text.includes(expected), `${page.path} does not contain '${expected}'`);

				} else {
					assert.match(result.text, expected);
				}
			}

			// a page that was meant to load says nothing of failing
			if ((page.status ?? 200) === 200) {
				for (const failure of ['Error building page', 'Failed to load block', 'Failed to load transaction', 'Failed loading block', 'TypeError', 'ReferenceError']) {
					assert.ok(!result.text.includes(failure), `${page.path} says '${failure}'`);
				}
			}

			// a page starts with its doctype: template comments written with // end up in front of it
			if (result.text.includes('<html')) {
				assert.ok(result.text.startsWith('<!DOCTYPE html>'), `${page.path} starts with ${JSON.stringify(result.text.slice(0, 40))}`);
			}

			// a column count that is not a number leaves classes like row-cols-md-NaN in the page
			assert.ok(!/row-cols-\w+-(NaN|undefined)/.test(result.text), `${page.path} has a summary row with no column count`);

			if (page.settleMs) {
				await new Promise(resolve => setTimeout(resolve, page.settleMs));
			}
		});
	}

	test('responses carry the security headers, and only the snippets can be framed', async () => {
		const auth = { authorization: 'Basic ' + Buffer.from(`user:${smokePassword}`).toString('base64') };

		for (const path of ['/', '/api/version', '/nonexistent', '/block-height/975700']) {
			const response = await fetch(app.baseUrl + path, { headers: auth, redirect: 'manual' });

			assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
			assert.equal(response.headers.get('referrer-policy'), 'same-origin', path);
			assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', path);
			assert.equal(response.headers.get('x-powered-by'), null, path);
		}

		const snippet = await fetch(`${app.baseUrl}/snippet/timestamp`, { headers: auth });

		assert.equal(snippet.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(snippet.headers.get('x-frame-options'), null);
	});

	test('without the password nothing is served', async () => {
		for (const page of [{ path: '/' }, { path: '/rpc-browser' }, { path: '/api/block/975700' }]) {
			assert.equal((await requestPage(app.baseUrl, page)).status, 401, page.path);
			assert.equal((await requestPage(app.baseUrl, page, 'wrong')).status, 401, page.path);
		}
	});

	test('the node was never asked for something that is not in the recording', () => {
		assert.deepEqual([...node.misses], []);
	});

	test('nothing was left unhandled', () => {
		const output = app.output();

		assert.ok(!output.includes('ExpressUncaughtError'), 'a route failed without being caught');
		assert.ok(!/unhandled(Rejection| Rejection)/i.test(output), 'a promise was rejected and nobody handled it');
	});
});
