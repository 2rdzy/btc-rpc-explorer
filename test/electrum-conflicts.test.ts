import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import "./helpers/setup.js";
import config from "../app/config.js";
import * as electrumAddressApi from "../app/api/electrumAddressApi.js";
import { balanceKey, balanceSummary, chooseAnswer, historyKey, historySummary } from "../app/api/electrumConsensus.js";
import { startFakeElectrum } from "./helpers/fakeElectrum.js";
import type { ElectrumAnswers } from "./helpers/fakeElectrum.js";

// p2wpkh script of a made-up key: the content only matters for the hash the client sends
const scriptPubkey = "0014" + "11".repeat(20);

// the clients keep trying to reconnect after their servers are closed: end the test process instead of waiting for them
after(() => {
	setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
});

const answer = <T>(result: T, server: string | null) => ({ result, server });
const same = (x: string) => x;

describe("choosing between the answers of several servers", () => {
	test("servers that agree give no conflict", () => {
		const { chosen, conflict } = chooseAnswer([answer("a", "s1"), answer("a", "s2")], "thing", same, same);

		assert.equal(chosen.server, "s1");
		assert.equal(conflict, undefined);
	});

	test("a single server cannot conflict", () => {
		assert.equal(chooseAnswer([answer("a", "s1")], "thing", same, same).conflict, undefined);
	});

	test("the answer most servers give wins, whatever the order", () => {
		const { chosen, conflict } = chooseAnswer([answer("odd", "s1"), answer("a", "s2"), answer("a", "s3")], "thing", same, x => `says ${x}`);

		assert.equal(chosen.server, "s2");
		assert.deepEqual(conflict, {
			what: "thing",
			used: "s2",
			answers: [{ server: "s1", summary: "says odd" }, { server: "s2", summary: "says a" }, { server: "s3", summary: "says a" }]
		});
	});

	test("on a tie the first server's answer is used", () => {
		const { chosen, conflict } = chooseAnswer([answer("a", "s1"), answer("b", "s2"), answer("b", "s3"), answer("a", "s4")], "thing", same, same);

		assert.equal(chosen.server, "s1");
		assert.equal(conflict?.used, "s1");
	});

	test("a server without a name is still reported", () => {
		const { conflict } = chooseAnswer([answer("a", null), answer("b", "s2")], "thing", same, same);

		assert.equal(conflict?.answers[0].server, "unknown server");
	});
});

describe("what makes two answers differ", () => {
	const history = [{ tx_hash: "aa", height: 1 }, { tx_hash: "bb", height: 2 }];

	test("the same transactions in another order are the same", () => {
		assert.equal(historyKey(history), historyKey([...history].reverse()));
	});

	test("a different transaction, or the same one at another height, differs", () => {
		assert.notEqual(historyKey(history), historyKey([history[0], { tx_hash: "cc", height: 2 }]));
		assert.notEqual(historyKey(history), historyKey([history[0], { tx_hash: "bb", height: 3 }]));
		assert.notEqual(historyKey(history), historyKey([history[0]]));
	});

	test("unconfirmed transactions are ignored, as every server sees another mempool", () => {
		assert.equal(historyKey(history), historyKey([...history, { tx_hash: "dd", height: 0 }, { tx_hash: "ee", height: -1 }]));
	});

	test("the confirmed balance differs, the unconfirmed one does not count", () => {
		assert.equal(balanceKey({ confirmed: 5 }), balanceKey({ confirmed: 5, unconfirmed: 9 } as { confirmed: number }));
		assert.notEqual(balanceKey({ confirmed: 5 }), balanceKey({ confirmed: 6 }));
	});

	test("summaries say it in words", () => {
		assert.equal(historySummary(history), "2 confirmed transactions");
		assert.equal(historySummary([history[0], { tx_hash: "dd", height: 0 }]), "1 confirmed transaction");
		assert.equal(balanceSummary({ confirmed: 1000 }), "1000 sat confirmed");
	});
});

describe("Electrum servers that disagree", () => {
	const history = [{ tx_hash: "aa", height: 1 }, { tx_hash: "bb", height: 2 }, { tx_hash: "cc", height: 3 }];
	const agreeing: ElectrumAnswers = { history, balance: { confirmed: 1000, unconfirmed: 0 } };
	const behind: ElectrumAnswers = { history: history.slice(0, 2), balance: { confirmed: 400, unconfirmed: 0 } };
	const closers: (() => void)[] = [];
	const originalServers = config.electrumServers;
	const originalTls = config.electrumTls;

	before(async () => {
		// the one that disagrees connects first, so that the others have to outvote it
		const servers = [await startFakeElectrum(behind), await startFakeElectrum(agreeing), await startFakeElectrum(agreeing)];

		closers.push(...servers.map(s => s.close));
		config.electrumTls = {};
		config.electrumServers = servers.map(s => ({ host: "127.0.0.1", port: s.port, protocol: "tcp" }));
		await electrumAddressApi.connectToServers();
	});

	after(() => {
		config.electrumServers = originalServers;
		config.electrumTls = originalTls;
		closers.forEach(close => close());
	});

	test("the majority's answer is shown and the disagreement is reported", async () => {
		const out = await electrumAddressApi.getAddressDetails("addr", scriptPubkey, "desc", 10, 0);

		assert.deepEqual(out.errors, []);
		assert.equal(out.addressDetails!.txCount, 3);
		assert.equal(out.addressDetails!.balanceSat, 1000);
		assert.equal(out.conflicts!.length, 2);

		const [transactions, balance] = ["transaction history", "balance"].map(what => out.conflicts!.find(c => c.what === what)!);

		// the servers connect in no fixed order
		assert.deepEqual(transactions.answers.map(a => a.summary).sort(), ["2 confirmed transactions", "3 confirmed transactions", "3 confirmed transactions"]);
		assert.deepEqual(balance.answers.map(a => a.summary).sort(), ["1000 sat confirmed", "1000 sat confirmed", "400 sat confirmed"]);
		assert.match(balance.used, /^127\.0\.0\.1:\d+$/);
		assert.equal(balance.answers.find(a => a.server === balance.used)!.summary, "1000 sat confirmed");
		assert.equal(transactions.answers.find(a => a.server === transactions.used)!.summary, "3 confirmed transactions");
	});
});

describe("Electrum servers of which one fails", () => {
	const history = [{ tx_hash: "aa", height: 1 }, { tx_hash: "bb", height: 2 }];
	const good: ElectrumAnswers = { history, balance: { confirmed: 700, unconfirmed: 0 } };
	const failing: ElectrumAnswers = { ...good, failing: ["blockchain.scripthash.get_history", "blockchain.scripthash.get_balance"] };
	const closers: (() => void)[] = [];
	const originalServers = config.electrumServers;
	const originalTls = config.electrumTls;

	before(async () => {
		const servers = [await startFakeElectrum(failing), await startFakeElectrum(good)];

		closers.push(...servers.map(s => s.close));
		config.electrumTls = {};
		config.electrumServers = servers.map(s => ({ host: "127.0.0.1", port: s.port, protocol: "tcp" }));
		await electrumAddressApi.connectToServers();
	});

	after(() => {
		config.electrumServers = originalServers;
		config.electrumTls = originalTls;
		closers.forEach(close => close());
	});

	test("the server that answers is used, with no conflict", async () => {
		const out = await electrumAddressApi.getAddressDetails("addr", scriptPubkey, "desc", 10, 0);

		assert.deepEqual(out.errors, []);
		assert.equal(out.conflicts, undefined);
		assert.equal(out.addressDetails!.txCount, 2);
		assert.equal(out.addressDetails!.balanceSat, 700);
	});
});

describe("Electrum servers that all fail", () => {
	const failing: ElectrumAnswers = { history: [], balance: { confirmed: 0, unconfirmed: 0 }, failing: ["blockchain.scripthash.get_history", "blockchain.scripthash.get_balance"] };
	const closers: (() => void)[] = [];
	const originalServers = config.electrumServers;
	const originalTls = config.electrumTls;

	before(async () => {
		const servers = [await startFakeElectrum(failing), await startFakeElectrum(failing)];

		closers.push(...servers.map(s => s.close));
		config.electrumTls = {};
		config.electrumServers = servers.map(s => ({ host: "127.0.0.1", port: s.port, protocol: "tcp" }));
		await electrumAddressApi.connectToServers();
	});

	after(() => {
		config.electrumServers = originalServers;
		config.electrumTls = originalTls;
		closers.forEach(close => close());
	});

	test("the failure is reported, as when there is one server", async () => {
		const out = await electrumAddressApi.getAddressDetails("addr", scriptPubkey, "desc", 10, 0);

		assert.ok(out.errors!.length > 0);
		assert.deepEqual(out.addressDetails, {});
	});
});
