// Records the answers of a real node for test/pages.test.ts (npm run record-fixtures):
//
//   BTCEXP_RECORD_COOKIE_FILE=~/.bitcoin/.cookie [BTCEXP_RECORD_NODE=127.0.0.1:8332] npm run record-fixtures
//
// It starts the explorer against a proxy that passes its calls on to your node, requests every page of
// test/fixtures/pages.ts, and writes what the node answered to test/fixtures/rpc.json. Only chain data is kept (blocks,
// transactions, ...): what belongs to your node (peers, addresses, mempool, ...) is not recorded, the test makes it up
// (test/fixtures/nodeSpecific.ts). Long lists are cut. Read the file before you commit it.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { callKey } from "../helpers/fakeNode.js";
import type { Recorded } from "../helpers/fakeNode.js";
import { buildApp, requestPage, smokePassword, startApp } from "../helpers/app.js";
import { nodeSpecific } from "./nodeSpecific.js";
import { pages } from "./pages.js";

const cookieFile = (process.env.BTCEXP_RECORD_COOKIE_FILE || path.join(os.homedir(), ".bitcoin", ".cookie")).replace(/^~/, os.homedir());
const [nodeHost, nodePort] = (process.env.BTCEXP_RECORD_NODE || "127.0.0.1:8332").split(":");
const authorization = "Basic " + Buffer.from(fs.readFileSync(cookieFile, "utf8").trim()).toString("base64");

const recorded: Record<string, Recorded> = {};

type Json = Record<string, unknown>;

// makes an answer smaller and scrubs it
function reduce(method: string, params: unknown[], result: unknown): unknown {
	if (method === "getblock" && result && Array.isArray((result as Json).tx)) {
		return { ...(result as Json), tx: ((result as Json).tx as unknown[]).slice(0, 20) };
	}

	return result;
}

// the tip of the chain, for the made-up answers
let tip = { height: 0, hash: "", bits: "", difficultyKey: "difficulty", difficulty: 0, time: 0 };

async function callNode(method: string, params: unknown[], id: unknown = 1): Promise<Json> {
	return await (await fetch(`http://${nodeHost}:${nodePort}/`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "1.0", id, method, params }) })).json() as Json;
}

const proxy = http.createServer((req, res) => {
	let body = "";

	req.on("data", chunk => { body += chunk; });
	req.on("end", async () => {
		const call = JSON.parse(body);

		// what belongs to the node is answered as the test will answer it, and not kept
		const madeUp = nodeSpecific(call.method, call.params ?? [], tip);

		if (madeUp) {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...("error" in madeUp ? { error: madeUp.error } : { result: madeUp.result }) }));

			return;
		}

		const answer = await callNode(call.method, call.params ?? [], call.id);

		const entry: Recorded = answer.error
			? { error: answer.error as { code: number, message: string } }
			: { result: reduce(call.method, call.params ?? [], answer.result) };

		recorded[callKey(call.method, call.params)] = entry;

		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...("error" in entry ? { error: entry.error } : { result: entry.result }) }));
	});
});

async function main() {
	buildApp();

	const info = (await callNode("getblockchaininfo", [])).result as Json;
	const difficultyKey = "difficulty_blake2b" in info ? "difficulty_blake2b" : "difficulty";

	tip = { height: info.blocks as number, hash: info.bestblockhash as string, bits: info.bits as string, difficultyKey, difficulty: info[difficultyKey] as number, time: info.time as number };

	await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", () => resolve()));

	const app = await startApp((proxy.address() as AddressInfo).port, { BTCEXP_BASIC_AUTH_PASSWORD: smokePassword });

	for (const page of pages) {
		const response = await requestPage(app.baseUrl, page, smokePassword);

		const expected = page.status ?? 200;

		console.log(`${response.status === expected ? "ok  " : "WRONG"} ${response.status} ${page.post ? "POST " : ""}${page.path}`);

		if (page.settleMs) {
			await new Promise(resolve => setTimeout(resolve, page.settleMs));
		}
	}

	await app.stop();
	proxy.close();
	proxy.closeAllConnections();

	const keys = Object.keys(recorded).sort();
	const file = path.join(__dirname, "rpc.json");
	const text = "{\n" + keys.map(key => `${JSON.stringify(key)}: ${JSON.stringify(recorded[key])}`).join(",\n") + "\n}\n";

	fs.writeFileSync(file, text);

	console.log(`\n${keys.length} answers, ${(text.length / 1024).toFixed(0)} KB, written to ${path.relative(process.cwd(), file)}`);

	// anything that looks like an address of a machine that is not a documentation one
	const addresses = (text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []).filter(a => !/^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(a) && !/^(0|127|255)\./.test(a));
	const hosts = text.match(/[a-z2-7]{16,56}\.onion|\.i2p\b/g) || [];

	if (addresses.length || hosts.length) {
		console.log("CHECK before you commit: addresses in the file that are not documentation ones:", [...new Set(addresses)].slice(0, 20), [...new Set(hosts)].slice(0, 5));
	}
}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
