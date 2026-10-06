// The answers that belong to a node and not to the chain: its peers, its addresses, its mempool, what it would mine,
// how long it has been up. They are made up here (nothing of the machine the chain data was recorded from is kept),
// and fit the recorded chain: they follow its tip. Everything about blocks and transactions is recorded instead
// (test/fixtures/rpc.json).

import type { Recorded } from "../helpers/fakeNode.js";

interface Tip { height: number, hash: string, bits: string, difficultyKey: string, difficulty: number, time: number }

const hex = (n: number, length: number) => n.toString(16).padStart(length, "0");

const MEMPOOL_SIZE = 12;
const mempoolTxid = (i: number) => `ffffffff${hex(i, 4)}${"d".repeat(52)}`;

function parseMempoolTxid(id: unknown): number | null {
	const match = typeof id === "string" ? /^ffffffff([0-9a-f]{4})d{52}$/.exec(id) : null;
	const i = match ? parseInt(match[1], 16) : -1;

	return i >= 0 && i < MEMPOOL_SIZE ? i : null;
}

// the transactions the mempool transactions spend: confirmed ones, made up as well
const fundingTxid = (i: number) => `eeeeeeee${hex(i, 4)}${"e".repeat(52)}`;

function parseFundingTxid(id: unknown): number | null {
	const match = typeof id === "string" ? /^eeeeeeee([0-9a-f]{4})e{52}$/.exec(id) : null;
	const i = match ? parseInt(match[1], 16) : -1;

	return i >= 0 && i < MEMPOOL_SIZE ? i : null;
}

// a pay-to-witness-key-hash output to a test address of BIP 173
const script = { asm: "0 751e76e8199196d454941c45d1b3a323f1433bd6", desc: "addr(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)", hex: "0014751e76e8199196d454941c45d1b3a323f1433bd6", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", type: "witness_v0_keyhash" };

const FUNDING_SATS = 100000000;
const FIRST_SATS = 60000000;

// every third transaction of the mempool depends on the one before it
const depends = (i: number): number[] => i % 3 === 2 ? [i - 1] : [];
const feeSats = (i: number): number => 1500 * (i + 2);
const vsize = (i: number): number => 200 + 10 * i;

const HELP = [
	"== Blockchain ==",
	'getblock "blockhash" ( verbosity )',
	"getblockchaininfo",
	"getblockcount",
	"getblockhash height",
	"",
	"== Control ==",
	'help ( "command" )',
	"uptime",
	"",
	"== Network ==",
	"getpeerinfo"
].join("\n");

// `help <method>` is the documentation of the method, which is the same for every node: it is recorded
export function nodeSpecific(method: string, params: unknown[], tip: Tip): Recorded | undefined {
	const result = (value: unknown): Recorded => ({ result: value });

	switch (method) {
		case "getpeerinfo":
			return result(Array.from({ length: 6 }, (_, i) => ({
				id: i,
				addr: `192.0.2.${i + 1}:8333`,
				addrbind: `192.0.2.100:${40000 + i}`,
				network: "ipv4",
				services: "0000000000000c09",
				servicesnames: ["NETWORK", "WITNESS", "NETWORK_LIMITED"],
				relaytxes: true,
				lastsend: tip.time,
				lastrecv: tip.time,
				last_transaction: tip.time - 60,
				last_block: tip.time - 600,
				last_block_announcement: 0,
				bytessent: 1000000 * (i + 1),
				bytesrecv: 2000000 * (i + 1),
				conntime: tip.time - 86400,
				timeoffset: 0,
				pingtime: 0.05 + i / 100,
				minping: 0.04,
				version: 70016,
				subver: i % 2 ? "/Satoshi:29.0.0/" : "/Satoshi:29.4.2/Knots:20260508/",
				inbound: i < 2,
				startingheight: tip.height - 5,
				synced_headers: tip.height,
				synced_blocks: tip.height,
				permissions: [],
				minfeefilter: 0.00001,
				connection_type: i < 2 ? "inbound" : "outbound-full-relay",
				transport_protocol_type: "v2",
				session_id: "",
				addrlocal: "198.51.100.1:8333"
			})));

		case "getnetworkinfo":
			return result({
				version: 290402, subversion: "/Satoshi:29.4.2/Knots:20260508/", protocolversion: 70016, localservices: "0000000000000c09",
				localservicesnames: ["NETWORK", "WITNESS", "NETWORK_LIMITED"], localrelay: true, timeoffset: 0, networkactive: true,
				connections: 6, connections_in: 2, connections_out: 4,
				networks: [{ name: "ipv4", limited: false, reachable: true, proxy: "", proxy_randomize_credentials: false }],
				relayfee: 0.00001, incrementalfee: 0.00001, localaddresses: [], warnings: []
			});

		case "getnettotals":
			return result({
				totalbytesrecv: 123456789, totalbytessent: 234567890, timemillis: tip.time * 1000,
				uploadtarget: { timeframe: 86400, target: 0, target_reached: false, serve_historical_blocks: true, bytes_left_in_cycle: 0, time_left_in_cycle: 0 }
			});

		case "uptime":
			return result(5 * 3600);

		case "listwallets":
			return result([]);

		case "getindexinfo":
			return result({ txindex: { synced: true, best_block_height: tip.height }, "basic block filter index": { synced: true, best_block_height: tip.height } });

		case "getmininginfo":
			return result({
				blocks: tip.height, currentblocksize: 0, currentblockweight: 0, currentblocktx: 0, bits: tip.bits, [tip.difficultyKey]: tip.difficulty,
				networkhashps: 3.7e16, pooledtx: MEMPOOL_SIZE, chain: "main",
				next: { height: tip.height + 1, bits: tip.bits, [tip.difficultyKey]: tip.difficulty }, warnings: []
			});

		case "getnetworkhashps":
			return result(3.7e16);

		case "estimatesmartfee":
			return result({ feerate: 0.00012, blocks: Number(params[0]) });

		case "getmempoolinfo":
			return result({
				loaded: true, size: MEMPOOL_SIZE, bytes: 3000, usage: 20000, total_fee: 0.001, maxmempool: 300000000, mempoolminfee: 0.00001,
				minrelaytxfee: 0.00001, incrementalrelayfee: 0.00001, dustrelayfee: 0.00003, dustrelayfeefloor: 0.00003, dustdynamic: "off",
				unbroadcastcount: 0, fullrbf: true, rbf_policy: "always", truc_policy: "accept"
			});

		case "getrawmempool":
			return result(Array.from({ length: MEMPOOL_SIZE }, (_, i) => mempoolTxid(i)));

		case "getmempoolentry": {
			const i = parseMempoolTxid(params[0]);

			if (i === null) {
				return { error: { code: -5, message: "Transaction not in mempool" } };
			}

			const base = feeSats(i) / 1e8;
			const parent = depends(i).length ? feeSats(i - 1) / 1e8 : 0;

			return result({
				vsize: vsize(i), weight: vsize(i) * 4, time: tip.time + 60 * i, height: tip.height,
				descendantcount: 1, descendantsize: vsize(i), ancestorcount: depends(i).length + 1,
				ancestorsize: vsize(i) + (parent ? vsize(i - 1) : 0), wtxid: mempoolTxid(i), hash: mempoolTxid(i),
				fees: { base, modified: base, ancestor: base + parent, descendant: base },
				depends: depends(i).map(mempoolTxid), spentby: [], "bip125-replaceable": false, unbroadcast: false
			});
		}

		case "getblocktemplate": {
			const entries = Array.from({ length: MEMPOOL_SIZE }, (_, i) => i);

			return result({
				capabilities: ["proposal"], version: 536870912, rules: ["csv", "!segwit", "blake2b"], vbavailable: {}, vbrequired: 0,
				previousblockhash: tip.hash,
				transactions: entries.map(i => ({
					data: "", txid: mempoolTxid(i), hash: mempoolTxid(i), depends: depends(i).map(parent => parent + 1),
					fee: feeSats(i), sigops: 1, weight: vsize(i) * 4
				})),
				coinbaseaux: {}, coinbasevalue: 312500000 + entries.reduce((sum, i) => sum + feeSats(i), 0), longpollid: tip.hash + "0",
				mintime: tip.time - 3000, mutable: ["time", "transactions", "prevblock"], noncerange: "00000000ffffffff",
				sigoplimit: 80000, sizelimit: 4000000, weightlimit: 4000000, curtime: tip.time + 300, bits: tip.bits, height: tip.height + 1,
				default_witness_commitment: "6a24aa21a9ed" + "00".repeat(32)
			});
		}

		// the made-up mempool transactions and what they spend (any other transaction is recorded)
		case "getrawtransaction": {
			const mempool = parseMempoolTxid(params[0]);
			const funding = parseFundingTxid(params[0]);

			if (mempool !== null) {
				return result({
					txid: mempoolTxid(mempool), hash: mempoolTxid(mempool), version: 2, size: vsize(mempool), vsize: vsize(mempool), weight: vsize(mempool) * 4, locktime: 0,
					vin: [{ txid: fundingTxid(mempool), vout: 0, scriptSig: { asm: "", hex: "" }, txinwitness: ["30".repeat(72), "02".repeat(33)], sequence: 4294967293 }],
					vout: [
						{ value: FIRST_SATS / 1e8, n: 0, scriptPubKey: script },
						{ value: (FUNDING_SATS - FIRST_SATS - feeSats(mempool)) / 1e8, n: 1, scriptPubKey: script }
					],
					hex: ("02000000" + mempoolTxid(mempool)).padEnd(vsize(mempool) * 2, "0")
				});
			}

			if (funding !== null) {
				return result({
					txid: fundingTxid(funding), hash: fundingTxid(funding), version: 2, size: 150, vsize: 150, weight: 600, locktime: 0,
					vin: [{ coinbase: "00", sequence: 4294967295 }],
					vout: [{ value: FUNDING_SATS / 1e8, n: 0, scriptPubKey: script }],
					hex: ("02000000" + fundingTxid(funding)).padEnd(300, "0"),
					blockhash: tip.hash, confirmations: 10, time: tip.time - 6000, blocktime: tip.time - 6000
				});
			}

			return undefined;
		}

		case "gettxout":
			// the outputs of the made-up transactions are unspent
			return parseFundingTxid(params[0]) !== null
				? result({ bestblock: tip.hash, confirmations: 10, value: FUNDING_SATS / 1e8, scriptPubKey: script, coinbase: false })
				: (parseMempoolTxid(params[0]) !== null ? result(null) : undefined);

		case "help":
			// the list of methods (with a method, it is recorded)
			return params.length === 0 ? result(HELP) : undefined;

		default:
			return undefined;
	}
}
