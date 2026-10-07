import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { buildApp, startApp } from "./helpers/app.js";
import type { RunningApp } from "./helpers/app.js";
import { startFakeNode } from "./helpers/fakeNode.js";
import type { Recorded } from "./helpers/fakeNode.js";
import { nodeSpecific } from "./fixtures/nodeSpecific.js";

// The rate limit counts the pages people open. What the pages ask for in the background (the block analysis alone makes
// dozens of calls), the API and the snippets are not counted: a page must not use up its own limit.

describe("rate limiting in the running explorer", () => {
	let node: Awaited<ReturnType<typeof startFakeNode>>;
	let app: RunningApp;

	before(async () => {
		const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "rpc.json"), "utf8")) as Record<string, Recorded>;
		const info = (fixtures["getblockchaininfo []"] as { result: Record<string, unknown> }).result;
		const difficultyKey = "difficulty_blake2b" in info ? "difficulty_blake2b" : "difficulty";
		const tip = { height: info.blocks as number, hash: info.bestblockhash as string, bits: info.bits as string, difficultyKey, difficulty: info[difficultyKey] as number, time: info.time as number };

		buildApp();
		node = await startFakeNode(fixtures, (method, params) => nodeSpecific(method, params, tip));
		app = await startApp(node.port, { BTCEXP_RATE_LIMIT_WINDOW_MAX_REQUESTS: "5" });
	}, { timeout: 240000 });

	after(async () => {
		await app?.stop();
		await node?.close();
	});

	test("background calls, the API and the snippets are not counted, pages are", async () => {
		const status = async (path: string) => (await fetch(app.baseUrl + path)).status;

		for (let i = 0; i < 30; i++) {
			assert.equal(await status("/internal-api/blocks-by-height/975700"), 200, `internal-api ${i}`);
			assert.equal(await status("/api/version"), 200, `api ${i}`);
		}

		assert.equal(await status("/snippet/timestamp"), 200);

		const pages = [];

		for (let i = 0; i < 8; i++) {
			pages.push(await status("/about"));
		}

		// (the explorer was asked for its home page once to see that it is up)
		assert.ok(pages.includes(429), `pages: ${pages}`);
		assert.deepEqual(pages, [...pages].sort(), "once limited, the pages stay limited");
		assert.equal(pages[pages.length - 1], 429);
	});
});
