import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { buildApp, requestPage, startApp } from "./helpers/app.js";
import type { RunningApp } from "./helpers/app.js";
import { startFakeElectrum } from "./helpers/fakeElectrum.js";
import { startFakeNode } from "./helpers/fakeNode.js";
import type { Recorded } from "./helpers/fakeNode.js";
import { nodeSpecific } from "./fixtures/nodeSpecific.js";

// An address page with two Electrum servers that disagree, in the running explorer.

const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BLOCK = "0000000000000000a9255f39c2ab84cfef67d19bb18b443bff86186c4f820e3c";
const TX1 = { tx_hash: "c457065cc0a4dc8291e29240ade3214fce2ea8c172e343f950e4e4a9b72df404", height: 975700 };
const TX2 = { tx_hash: "eb7fb4afdd68663e4b3296b91f2d2ed654b6b5323a984aa1ccd7d0501b184c2c", height: 975700 };

describe("the address page when the Electrum servers disagree", () => {
	let node: Awaited<ReturnType<typeof startFakeNode>>;
	let app: RunningApp;
	const closers: (() => void)[] = [];

	const start = async (answers: { history: typeof TX1[], balance: { confirmed: number, unconfirmed: number } }[]) => {
		const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "rpc.json"), "utf8")) as Record<string, Recorded>;
		const info = (fixtures["getblockchaininfo []"] as { result: Record<string, unknown> }).result;
		const difficultyKey = "difficulty_blake2b" in info ? "difficulty_blake2b" : "difficulty";
		const tip = { height: info.blocks as number, hash: info.bestblockhash as string, bits: info.bits as string, difficultyKey, difficulty: info[difficultyKey] as number, time: info.time as number };
		const servers = [];

		// the page asks for the transactions without their block, which the recording has with it
		for (const tx of [TX1, TX2]) {
			fixtures[`getrawtransaction ["${tx.tx_hash}",1]`] = fixtures[`getrawtransaction ["${tx.tx_hash}",1,"${BLOCK}"]`];
		}

		for (const a of answers) {
			servers.push(await startFakeElectrum(a));
		}

		closers.push(...servers.map(s => s.close));
		buildApp();
		node = await startFakeNode(fixtures, (method, params) => nodeSpecific(method, params, tip));
		app = await startApp(node.port, {
			BTCEXP_ADDRESS_API: "electrum",
			BTCEXP_ELECTRUM_SERVERS: servers.map(s => `tcp://127.0.0.1:${s.port}`).join(",")
		});
	};

	after(async () => {
		await app?.stop();
		await node?.close();
		closers.forEach(close => close());
	});

	test("it shows a trust warning with what each server said", { timeout: 240000 }, async () => {
		await start([
			{ history: [TX1, TX2], balance: { confirmed: 2000, unconfirmed: 0 } },
			{ history: [TX1], balance: { confirmed: 700, unconfirmed: 0 } }
		]);

		const page = await requestPage(app.baseUrl, { path: `/address/${ADDRESS}` });

		assert.equal(page.status, 200);
		assert.ok(page.text.includes("Trust Warning"), "no trust warning");
		assert.ok(page.text.includes("did not agree on the transaction history"));
		assert.ok(page.text.includes("did not agree on the balance"));
		assert.ok(page.text.includes("2 confirmed transactions"));
		assert.ok(page.text.includes("1 confirmed transaction"));
		assert.ok(page.text.includes("700 sat confirmed"));
		assert.deepEqual([...node.misses], []);
	});
});
