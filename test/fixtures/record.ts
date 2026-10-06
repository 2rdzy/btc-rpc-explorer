// Records the answers of a real node for test/pages.test.ts (npm run record-fixtures):
//
//   BTCEXP_RECORD_COOKIE_FILE=~/.bitcoin/.cookie [BTCEXP_RECORD_NODE=127.0.0.1:8332] npm run record-fixtures
//
// It starts the explorer against a proxy that passes its calls on to your node, requests every page of
// test/fixtures/pages.ts, and writes what the node answered to test/fixtures/rpc.json. The answers are made smaller
// on the way (long lists are cut) and scrubbed of anything private (the addresses of peers, of your node, and
// wallets). Read the file before you commit it.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { callKey } from "../helpers/fakeNode.js";
import type { Recorded } from "../helpers/fakeNode.js";
import { buildApp, requestPage, smokePassword, startApp } from "../helpers/app.js";
import { pages } from "./pages.js";

const cookieFile = (process.env.BTCEXP_RECORD_COOKIE_FILE || path.join(os.homedir(), ".bitcoin", ".cookie")).replace(/^~/, os.homedir());
const [nodeHost, nodePort] = (process.env.BTCEXP_RECORD_NODE || "127.0.0.1:8332").split(":");
const authorization = "Basic " + Buffer.from(fs.readFileSync(cookieFile, "utf8").trim()).toString("base64");

const recorded: Record<string, Recorded> = {};

// documentation addresses (RFC 5737) stand in for the real ones
const documentationAddress = (i: number, port = 8333) => `192.0.2.${(i % 250) + 1}:${port}`;

type Json = Record<string, unknown>;

// makes an answer smaller and scrubs it
function reduce(method: string, params: unknown[], result: unknown): unknown {
	if (method === "getblock" && result && Array.isArray((result as Json).tx)) {
		return { ...(result as Json), tx: ((result as Json).tx as unknown[]).slice(0, 20) };
	}

	if (method === "getrawmempool" && Array.isArray(result)) {
		return result.slice(0, 30);
	}

	if (method === "getblocktemplate" && result) {
		const transactions = ((result as Json).transactions as Json[]).slice(0, 40).map(tx => ({ ...tx, data: "" }));

		return { ...(result as Json), transactions };
	}

	if (method === "getpeerinfo" && Array.isArray(result)) {
		return (result as Json[]).slice(0, 12).map((peer, i) => ({
			...peer,
			addr: documentationAddress(i),
			addrbind: documentationAddress(i, 40000 + i),
			addrlocal: "198.51.100.1:8333"
		}));
	}

	if (method === "getnetworkinfo" && result) {
		return { ...(result as Json), localaddresses: [] };
	}

	if (method === "listwallets") {
		return [];
	}

	if (method === "help" && params.length === 0 && typeof result === "string") {
		return result.split("\n").slice(0, 60).join("\n");
	}

	return result;
}

const proxy = http.createServer((req, res) => {
	let body = "";

	req.on("data", chunk => { body += chunk; });
	req.on("end", async () => {
		const call = JSON.parse(body);
		const answer = await (await fetch(`http://${nodeHost}:${nodePort}/`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body })).json() as Json;

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
