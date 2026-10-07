import "./electrumSockets.js";
import debug from "debug";
import sha256 from "crypto-js/sha256";
import hexEnc from "crypto-js/enc-hex";
import ElectrumClient from "electrum-client";
type HistoryItem = { tx_hash: string, height: number };
type Balance = { confirmed: number, unconfirmed?: number };

import config from "../config.js";
import coins from "../coins.js";
import * as statTracker from "../statTracker.js";
import { logError } from "../helpers/errors.js";
import { ellipsize } from "../helpers/text.js";
import { reflectPromise } from "../helpers/timing.js";
import { balanceKey, balanceSummary, chooseAnswer, historyKey, historySummary } from "./electrumConsensus.js";
import type { AddressDetails, AddressDetailsResult } from "./addressDetails.js";
import type { ServerConflict } from "./electrumConsensus.js";

const debugLog = debug("btcexp:electrum");

const coinConfig = coins[config.coin];

// electrum-client has no type declarations (see types/electrum-client.d.ts), so what it returns is loose
type Client = ElectrumClient;
type ServerResult<T> = { result: T, server: string | null };

const electrumClients: Client[] = [];

global.electrumStats = {
	base: {
		connect: { count: 0, firstSeenAt: null, lastSeenAt: null },
		disconnect: { count: 0, firstSeenAt: null, lastSeenAt: null },
		error: { count: 0, firstSeenAt: null, lastSeenAt: null }
	},
	rpc: {}
};

const noConnectionsErrorText = "No Electrum connection available. This could mean that the connection was lost or that the Electrum server is processing transactions and therefore not accepting requests. This tool will try to reconnect. If you manage your own Electrum server you may want to check your server's logs.";

// Connects to every configured Electrum server. The clients reconnect by themselves when a connection is lost.
export async function connectToServers(): Promise<void> {
	const promises: Promise<void>[] = [];

	for (let i = 0; i < config.electrumServers.length; i++) {
		const { host, port, protocol } = config.electrumServers[i];

		promises.push(connectToServer(host, port, protocol));
	}

	try {
		await Promise.all(promises);

	} catch (err) {
		logError("120387rygxx231gwe40", err);

		throw err;
	}
}

function connectToServer(host: string | null, port: number, protocol?: string | null): Promise<void> {
	return new Promise(function(resolve, reject) {
		// default protocol is 'tcp' if port is 50001, which is the default unencrypted port for electrum
		const defaultProtocol = port === 50001 ? 'tcp' : 'tls';

		const electrumConfig = { client:"btc-rpc-explorer-v2", version:"1.4" };
		const electrumPersistencePolicy: { retryPeriod: number, maxRetry: number, callback: (() => void) | null } = { retryPeriod: 10000, maxRetry: 1000, callback: null };

		const onConnect = function(client: Client, versionInfo: unknown) {
			debugLog(`Connected to Electrum Server @ ${host}:${port} (${JSON.stringify(versionInfo)})`);

			global.electrumStats.base.connect.count++;
			global.electrumStats.base.connect.lastSeenAt = new Date();

			if (global.electrumStats.base.connect.firstSeenAt == null) {
				global.electrumStats.base.connect.firstSeenAt = new Date();
			}

			statTracker.trackEvent("electrum.connected");

			electrumClients.push(client);

			resolve();
		};

		const onClose = function(client: Client) {
			debugLog(`Disconnected from Electrum Server @ ${host}:${port}`);

			global.electrumStats.base.disconnect.count++;
			global.electrumStats.base.disconnect.lastSeenAt = new Date();

			if (global.electrumStats.base.disconnect.firstSeenAt == null) {
				global.electrumStats.base.disconnect.firstSeenAt = new Date();
			}

			statTracker.trackEvent("electrum.disconnected");

			const index = electrumClients.indexOf(client);

			if (index > -1) {
				electrumClients.splice(index, 1);
			}
		};

		const onError = function(err: unknown) {
			debugLog(`Electrum error: ${JSON.stringify(err)}`);

			global.electrumStats.base.error.count++;
			global.electrumStats.base.error.lastSeenAt = new Date();

			if (global.electrumStats.base.error.firstSeenAt == null) {
				global.electrumStats.base.error.firstSeenAt = new Date();
			}

			statTracker.trackEvent("electrum.connection-error");

			logError("937gf47dsyde", err, {host:host, port:port, protocol:protocol});
		};

		const onLog = function(str: string) {
			debugLog(str);
		};

		const electrumCallbacks = {
			onConnect: onConnect,
			onClose: onClose,
			onError: onError,
			onLog: onLog
		};

		const electrumOptions = {
			tls: config.electrumTls,
			requestTimeout: 120000
		};

		const electrumClient = new ElectrumClient(port, host, protocol || defaultProtocol, electrumOptions, electrumCallbacks);

		electrumClient.initElectrum(electrumConfig, electrumPersistencePolicy).then(function() {
			// success handled by onConnect callback

		}).catch(function(err: unknown) {
			debugLog(`Error connecting to Electrum Server @ ${host}:${port}`);

			reject(err);
		});
	});
}

async function runOnServer<T>(electrumClient: Client, f: (client: Client) => Promise<T>): Promise<ServerResult<T>> {
	try {
		const result = await f(electrumClient);

		return {result:result, server:`${electrumClient.host}:${electrumClient.port}`};

	} catch (err) {
		logError("ElectrumServerError", err, {host:electrumClient.host, port:electrumClient.port});

		throw err;
	}
}

function runOnAllServers<T>(f: (client: Client) => Promise<T>): Promise<ServerResult<T>[]> {
	const promises: Promise<ServerResult<T>>[] = [];

	for (let i = 0; i < electrumClients.length; i++) {
		promises.push(runOnServer(electrumClients[i], f));
	}

	return Promise.all(promises);
}

// The address's transactions (as txids with their block heights) and balance, as the Electrum servers say.
// Rejects with {error, userText} when there is no server connection. A failed lookup shows up in `errors`.
export async function getAddressDetails(address: string, scriptPubkey: string, sort: string, limit: number, offset: number): Promise<AddressDetailsResult> {
	if (electrumClients.length == 0) {
		throw {error: "No Electrum Server Connection", userText: noConnectionsErrorText};
	}

	const addrScripthash = (hexEnc.stringify(sha256(hexEnc.parse(scriptPubkey))).match(/.{2}/g) as string[]).reverse().join("");

	// set when the answers come in below (an answer that failed leaves them empty)
	let txidData = null as HistoryItem[] | null;
	let balanceData = null as Balance | null;
	const conflicts: ServerConflict[] = [];

	const promises: Promise<void>[] = [];

	promises.push(getAddressTxids(addrScripthash).then(function({ chosen, conflict }) {
		txidData = chosen.result;

		if (conflict) {
			conflicts.push(conflict);
		}

	}).catch(function(err) {
		err.userData = {address:address, sort:sort, limit:limit, offset:offset};

		logError("2397wgs0sgse", err);

		throw err;
	}));

	promises.push(getAddressBalance(addrScripthash).then(function({ chosen, conflict }) {
		balanceData = chosen.result;

		if (conflict) {
			conflicts.push(conflict);
		}

	}).catch(function(err) {
		err.userData = {address:address, sort:sort, limit:limit, offset:offset};

		logError("21307ws70sg", err);

		throw err;
	}));

	const results = await Promise.all(promises.map(reflectPromise));

	const addressDetails: AddressDetails = {};

	if (txidData) {
		addressDetails.txCount = txidData.length;

		addressDetails.txids = [];
		addressDetails.blockHeightsByTxid = {};

		if (sort == "desc") {
			txidData.reverse();
		}

		for (let i = offset; i < Math.min(txidData.length, limit + offset); i++) {
			addressDetails.txids.push(txidData[i].tx_hash);
			addressDetails.blockHeightsByTxid[txidData[i].tx_hash] = txidData[i].height;
		}
	}

	if (balanceData) {
		addressDetails.balanceSat = balanceData.confirmed;

		if (balanceData.unconfirmed) {
			addressDetails.unconfirmedBalanceSat = balanceData.unconfirmed;
		}
	}

	// each distinct failure once
	const errors: unknown[] = [];
	const errorStrs: string[] = [];
	results.forEach(function(x) {
		if (x.status == "rejected" && !errorStrs.includes(JSON.stringify(x))) {
			errors.push(x);
			errorStrs.push(JSON.stringify(x));
		}
	});

	return conflicts.length > 0 ? {addressDetails:addressDetails, errors:errors, conflicts:conflicts} : {addressDetails:addressDetails, errors:errors};
}

// Both of these answer with what most servers say, and report it when the servers did not all agree.

async function getAddressTxids(addrScripthash: string): Promise<{ chosen: ServerResult<HistoryItem[]>, conflict?: ServerConflict }> {
	const startTime = new Date().getTime();

	try {
		const results = await runOnAllServers(function(electrumClient) {
			return electrumClient.blockchainScripthash_getHistory(addrScripthash);
		});

		debugLog(`getAddressTxids=${ellipsize(JSON.stringify(results), 200)}`);

		logStats("blockchainScripthash_getHistory", new Date().getTime() - startTime, true);

		if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
			for (let i = 0; i < results.length; i++) {
				results[i].result.unshift({tx_hash:coinConfig.genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain], height:0});
			}
		}

		return chooseAnswer(results, "transaction history", historyKey, historySummary);

	} catch (err) {
		logStats("blockchainScripthash_getHistory", new Date().getTime() - startTime, false);

		throw err;
	}
}

async function getAddressBalance(addrScripthash: string): Promise<{ chosen: ServerResult<Balance>, conflict?: ServerConflict }> {
	const startTime = new Date().getTime();

	try {
		const results = await runOnAllServers(function(electrumClient) {
			return electrumClient.blockchainScripthash_getBalance(addrScripthash);
		});

		debugLog(`getAddressBalance=${JSON.stringify(results)}`);

		logStats("blockchainScripthash_getBalance", new Date().getTime() - startTime, true);

		if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
			for (let i = 0; i < results.length; i++) {
				const coinbaseBlockReward = coinConfig.blockRewardFunction(0, global.activeBlockchain);

				results[i].result.confirmed += (Number(coinbaseBlockReward) * Number(coinConfig.baseCurrencyUnit.multiplier));
			}
		}

		return chooseAnswer(results, "balance", balanceKey, balanceSummary);

	} catch (err) {
		logStats("blockchainScripthash_getBalance", new Date().getTime() - startTime, false);

		throw err;
	}
}

// Lookup the confirming block hash of a given txid. This only works with Electrs.
// https://github.com/romanz/electrs/commit/a0a3d4f9392e21f9e92fdc274c88fed6d0634794
export async function lookupTxBlockHash(txid: string): Promise<string> {
	if (electrumClients.length == 0) {
		throw { error: "No Electrum Server Connection", userText: noConnectionsErrorText };
	}

	const results = await runOnAllServers(function(electrumClient) {
		return electrumClient.request('blockchain.transaction.get_confirmed_blockhash', [txid]) as Promise<string>;
	});

	const blockhash = results[0].result;
	if (results.slice(1).every(({ result }) => result == blockhash)) {
		return blockhash;
	} else {
		throw {conflictedResults:results};
	}
}

function logStats(cmd: string, dt: number, success: boolean) {
	if (!global.electrumStats.rpc[cmd]) {
		global.electrumStats.rpc[cmd] = {count:0, time:0, successes:0, failures:0};
	}

	global.electrumStats.rpc[cmd].count++;
	global.electrumStats.rpc[cmd].time += dt;

	statTracker.trackPerformance(`electrum.${cmd}`, dt);
	statTracker.trackPerformance(`electrum.*`, dt);

	if (success) {
		global.electrumStats.rpc[cmd].successes++;
		statTracker.trackEvent(`electrum-result.${cmd}.success`);
		statTracker.trackEvent(`electrum-result.*.success`);

	} else {
		global.electrumStats.rpc[cmd].failures++;
		statTracker.trackEvent(`electrum-result.${cmd}.failure`);
		statTracker.trackEvent(`electrum-result.*.failure`);
	}
}
