import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { buildApp, requestPage, smokePassword, startApp } from "./helpers/app.js";
import type { RunningApp } from "./helpers/app.js";
import { startFakeNode } from "./helpers/fakeNode.js";
import type { Recorded } from "./helpers/fakeNode.js";
import { pages } from "./fixtures/pages.js";

// The whole explorer, as a user meets it: the built application runs as its own process, against a node that answers
// from recorded answers of a real one (test/fixtures/rpc.json), and every page and endpoint of test/fixtures/pages.ts
// is requested over HTTP. It covers what the other tests do not: the start-up code, the middleware, the routes and
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

		node = await startFakeNode(fixtures);
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

			if (page.settleMs) {
				await new Promise(resolve => setTimeout(resolve, page.settleMs));
			}
		});
	}

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
