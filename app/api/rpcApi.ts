import debug from "debug";
import async from "async";
import semver from "semver";

import config from "../config.js";
import coins from "../coins.js";
import * as statTracker from "../statTracker.js";
import { logError } from "../helpers/errors.js";
import { getBlockTotalFeesFromCoinbaseTxAndBlockHeight, identifyMiner } from "../helpers/mining.js";

const debugLog = debug("btcexp:rpc");

const coinConfig = coins[config.coin];

// What the node answers is JSON that varies by method and node version, so it stays loosely typed here. The
// callers pick out the fields they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcData = any;

export interface RpcRequest {
	method: string,
	parameters?: unknown[]
}

interface RpcTask {
	rpcCall: (callback: () => void) => Promise<void>
}

// the node is asked a few things at a time, not everything at once
const rpcQueue = async.queue<RpcTask>(function(task, callback) {
	task.rpcCall(function() {
		callback();
	});

}, config.rpcConcurrency);

export const minRpcVersions = {
	getblockstats: "0.17.0",
	getindexinfo: "0.21.0",
	getdeploymentinfo: "23.0.0"
};

global.rpcStats = {};

export async function getBlockchainInfo(): Promise<RpcData> {
	const getblockchaininfo = await getRpcData("getblockchaininfo");

	// keep global.pruneHeight updated
	if (getblockchaininfo.pruned) {
		global.pruneHeight = getblockchaininfo.pruneheight;
	}

	return getblockchaininfo;
}

export function getBlockCount(): Promise<RpcData> {
	return getRpcData("getblockcount");
}

export function getNetworkInfo(): Promise<RpcData> {
	return getRpcData("getnetworkinfo");
}

export function getNetTotals(): Promise<RpcData> {
	return getRpcData("getnettotals");
}

export function getMempoolInfo(): Promise<RpcData> {
	return getRpcData("getmempoolinfo");
}

export function getMiningInfo(): Promise<RpcData> {
	return getRpcData("getmininginfo");
}

export function getIndexInfo(): Promise<RpcData> {
	if (semver.gte(global.btcNodeSemver, minRpcVersions.getindexinfo)) {
		return getRpcData("getindexinfo");

	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getindexinfo);
	}
}

export function getDeploymentInfo(): Promise<RpcData> {
	if (semver.gte(global.btcNodeSemver, minRpcVersions.getdeploymentinfo)) {
		return getRpcData("getdeploymentinfo");

	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getdeploymentinfo);
	}
}

export function getUptimeSeconds(): Promise<RpcData> {
	return getRpcData("uptime");
}

export function getPeerInfo(): Promise<RpcData> {
	return getRpcData("getpeerinfo");
}

export function getBlockTemplate(): Promise<RpcData> {
	return getRpcDataWithParams({method:"getblocktemplate", parameters:[{"rules": ["segwit", "blake2b"]}]});
}

export function getAllMempoolTxids(): Promise<RpcData> {
	return getRpcDataWithParams({method:"getrawmempool", parameters:[false]});
}

export function getSmartFeeEstimate(mode = "CONSERVATIVE", confTargetBlockCount?: number): Promise<RpcData> {
	return getRpcDataWithParams({method:"estimatesmartfee", parameters:[confTargetBlockCount, mode]});
}

export function getNetworkHashrate(blockCount = 144): Promise<RpcData> {
	return getRpcDataWithParams({method:"getnetworkhashps", parameters:[blockCount]});
}

export function getBlockStats(hash: string): Promise<RpcData> {
	if (semver.gte(global.btcNodeSemver, minRpcVersions.getblockstats)) {
		if (hash == coinConfig.genesisBlockHashesByNetwork[global.activeBlockchain] && coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]) {
			return Promise.resolve(coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]);

		} else {
			return getRpcDataWithParams({method:"getblockstats", parameters:[hash]});
		}
	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getblockstats);
	}
}

export function getBlockStatsByHeight(height: number): Promise<RpcData> {
	if (semver.gte(global.btcNodeSemver, minRpcVersions.getblockstats)) {
		if (height == 0 && coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]) {
			return Promise.resolve(coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]);

		} else {
			return getRpcDataWithParams({method:"getblockstats", parameters:[height]});
		}
	} else {
		// unsupported
		return unsupportedPromise(minRpcVersions.getblockstats);
	}
}

export function getUtxoSetSummary(useCoinStatsIndexIfAvailable = true): Promise<RpcData> {
	if (useCoinStatsIndexIfAvailable && global.getindexinfo && global.getindexinfo.coinstatsindex) {
		return getRpcDataWithParams({method:"gettxoutsetinfo", parameters:["muhash"]});

	} else {
		return getRpcData("gettxoutsetinfo");
	}
}

// Every transaction in the mempool, with its mempool entry, by txid. Transactions that left the mempool meanwhile are left out.
export async function getRawMempool(): Promise<RpcData> {
	const txids = await getRpcDataWithParams({method:"getrawmempool", parameters:[false]});

	const results = await Promise.all(txids.map((txid: string) => getRawMempoolEntry(txid)));

	const finalResult: Record<string, RpcData> = {};

	for (let i = 0; i < results.length; i++) {
		if (results[i] != null) {
			finalResult[results[i].txid] = results[i];
		}
	}

	return finalResult;
}

async function getRawMempoolEntry(txid: string): Promise<RpcData> {
	try {
		const result = await getRpcDataWithParams({method:"getmempoolentry", parameters:[txid]});

		result.txid = txid;

		return result;

	} catch {
		return null;
	}
}

export function getChainTxStats(blockCount: number, blockhashEnd: string | null = null): Promise<RpcData> {
	const params: unknown[] = [blockCount];
	if (blockhashEnd) {
		params.push(blockhashEnd);
	}

	return getRpcDataWithParams({method:"getchaintxstats", parameters:params});
}

export async function getBlockByHeight(blockHeight: number): Promise<RpcData> {
	const blockhash = await getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]});

	return await getBlockByHash(blockhash);
}

export function getBlockHeaderByHash(blockhash: string): Promise<RpcData> {
	return getRpcDataWithParams({method:"getblockheader", parameters:[blockhash]});
}

export async function getBlockHeaderByHeight(blockHeight: number): Promise<RpcData> {
	const blockhash = await getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]});

	return await getBlockHeaderByHash(blockhash);
}

export function getBlockHashByHeight(blockHeight: number): Promise<RpcData> {
	return getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]});
}

// The block with its coinbase transaction, fees and miner. A pruned block comes back as its header, without transactions.
export async function getBlockByHash(blockHash: string): Promise<RpcData> {
	let block: RpcData;

	try {
		block = await getRpcDataWithParams({method:"getblock", parameters:[blockHash]});

		const tx = await getRawTransaction(block.tx[0], blockHash);

		block.coinbaseTx = tx;
		block.totalFees = getBlockTotalFeesFromCoinbaseTxAndBlockHeight(tx, block.height);
		block.miner = identifyMiner(tx, block.height);

	} catch (err) {
		// the block is pruned, use `getblockheader` instead
		debugLog('getblock failed, falling back to getblockheader', blockHash, err);

		block = await getRpcDataWithParams({method:"getblockheader", parameters:[blockHash]});
		block.tx = [];
	}

	block.subsidy = coinConfig.blockRewardFunction(block.height, global.activeBlockchain);

	return block;
}

export function getAddress(address: string): Promise<RpcData> {
	return getRpcDataWithParams({method:"validateaddress", parameters:[address]});
}

export async function getRawTransaction(txid: string, blockhash?: string): Promise<RpcData> {
	const genesisTxid = coinConfig.genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain];

	if (genesisTxid && txid == genesisTxid) {
		// copy the "confirmations" field from genesis block to the genesis-coinbase tx
		const blockchainInfoResult = await getBlockchainInfo();

		const result = coinConfig.genesisCoinbaseTransactionsByNetwork[global.activeBlockchain];
		result.confirmations = blockchainInfoResult.blocks;

		// hack: default regtest node returns "0" for number of blocks, despite including a genesis block;
		// to display this block without errors, tag it with 1 confirmation
		if (global.activeBlockchain == "regtest" && result.confirmations == 0) {
			result.confirmations = 1;
		}

		return result;
	}

	try {
		const extra_params = blockhash ? [ blockhash ] : [];
		const result = await getRpcDataWithParams({method:"getrawtransaction", parameters:[txid, 1, ...extra_params]});

		if (result == null || result.code && result.code < 0) {
			throw result;
		}

		return result;

	} catch (err) {
		if (!global.txindexAvailable) {
			return await noTxIndexTransactionLookup(txid, !!blockhash);
		}

		throw err;
	}
}

async function noTxIndexTransactionLookup(txid: string, walletOnly: boolean): Promise<RpcData> {
	// Try looking up with an external Electrum server, using 'get_confirmed_blockhash'.
	// This is only available in Electrs and requires enabling BTCEXP_ELECTRUM_TXINDEX.
	if (!walletOnly && (config.addressApi == "electrum" || config.addressApi == "electrumx") && config.electrumTxIndex) {
		try {
			// loaded here because electrumAddressApi needs this module
			const electrumAddressApi = await import("./electrumAddressApi.js");

			const blockhash = await electrumAddressApi.lookupTxBlockHash(txid);

			return await getRawTransaction(txid, blockhash);

		} catch (err) {
			debugLog(`Electrs blockhash lookup failed for ${txid}:`, err);
		}
	}

	// Try looking up in wallet transactions
	for (const wallet of await listWallets()) {
		try { return await getWalletTransaction(wallet, txid); }
		catch { /* not in this wallet */ }
	}

	// Try looking up in recent blocks
	if (!walletOnly) {
		const tip_height = await getRpcDataWithParams({method:"getblockcount", parameters:[]});
		for (let height=tip_height; height>Math.max(tip_height - config.noTxIndexSearchDepth, 0); height--) {
			const blockhash = await getRpcDataWithParams({method:"getblockhash", parameters:[height]});
			try { return await getRawTransaction(txid, blockhash); }
			catch { /* not in this block */ }
		}
	}

	throw new Error(`The requested tx ${txid} cannot be found in wallet transactions, mempool transactions, or recently confirmed transactions`);
}

function listWallets(): Promise<RpcData> {
	return getRpcDataWithParams({method:"listwallets", parameters:[]});
}

async function getWalletTransaction(wallet: string, txid: string): Promise<RpcData> {
	global.rpcClient.wallet = wallet;
	try {
		const wtx = await getRpcDataWithParams({method:"gettransaction", parameters:[ txid, true, true ]});

		return { ...wtx, ...wtx.decoded, decoded: null };
	} finally {
		global.rpcClient.wallet = null;
	}
}

// The unspent output, or "0" when it is spent (or never existed).
export async function getUtxo(txid: string, outputIndex: number): Promise<RpcData> {
	const result = await getRpcDataWithParams({method:"gettxout", parameters:[txid, outputIndex]});

	if (result == null) {
		return "0";
	}

	if (result.code && result.code < 0) {
		throw result;
	}

	return result;
}

export async function getMempoolTxDetails(txid: string, includeAncDec = true): Promise<RpcData> {
	const promises: Promise<void>[] = [];

	const mempoolDetails: RpcData = {};

	promises.push(getRpcDataWithParams({method:"getmempoolentry", parameters:[txid]}).then(function(result) {
		mempoolDetails.entry = result;
	}));

	if (includeAncDec) {
		promises.push(getRpcDataWithParams({method:"getmempoolancestors", parameters:[txid]}).then(function(result) {
			mempoolDetails.ancestors = result;
		}));

		promises.push(getRpcDataWithParams({method:"getmempooldescendants", parameters:[txid]}).then(function(result) {
			mempoolDetails.descendants = result;
		}));
	}

	await Promise.all(promises);

	return mempoolDetails;
}

export function getTxOut(txid: string, vout: number): Promise<RpcData> {
	return getRpcDataWithParams({method:"gettxout", parameters:[txid, vout]});
}

export function getHelp(): Promise<RpcData> {
	return getRpcData("help");
}

export function getRpcMethodHelp(methodName: string): Promise<RpcData> {
	return getRpcDataWithParams({method:"help", parameters:[methodName]});
}

// RPC methods whose reply is never legitimately empty: when the node answers
// with an error for one of these, fail loudly instead of resolving null.
// (Methods like getrawtransaction rely on a null result for "not found".)
const methodsThatMustSucceed = new Set([
	"getblockchaininfo",
	"getblocktemplate",
	"getdeploymentinfo",
	"getmempoolinfo",
	"getmininginfo",
	"getnetworkhashps",
	"getnetworkinfo"
]);

function checkRpcError(method: string, rpcResult: RpcData): void {
	if (!rpcResult || !rpcResult.error) {
		return;
	}

	const rpcError = rpcResult.error;

	debugLog(`RPC error: method=${method}, code=${rpcError.code}, message=${rpcError.message}`);

	if (methodsThatMustSucceed.has(method)) {
		throw Object.assign(new Error(`RPC ${method} failed: ${rpcError.message} (code ${rpcError.code})`), {rpcCode: rpcError.code});
	}
}

// the error, with what was asked attached (it is shown on the error page)
function withUserData(err: unknown, userData: unknown): unknown {
	if (err && typeof err === "object") {
		(err as { userData?: unknown }).userData = userData;
	}

	return err;
}

// The result of an RPC call without parameters. Rejects when the node cannot be reached or (for some calls) answers
// with an error.
export function getRpcData(cmd: string, verifyingConnection = false): Promise<RpcData> {
	const startTime = new Date().getTime();

	if (!verifyingConnection && !global.rpcConnected) {
		return Promise.reject(new Error("No RPC connection available. Check your connection/authentication parameters."));
	}

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${cmd}`);

		const rpcCall = async function(callback: () => void) {
			const client = (cmd == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);

			try {
				const rpcResult = await client.request(cmd, []);
				checkRpcError(cmd, rpcResult);

				const result = rpcResult.result;

				if (Array.isArray(result) && result.length == 1) {
					const result0 = result[0];

					if (result0 && result0.name && result0.name == "RpcError") {
						logStats(cmd, false, new Date().getTime() - startTime, false);

						debugLog("RpcErrorResult-01: " + JSON.stringify(result0));

						throw new Error(`RpcError: type=errorResponse-01`);
					}
				}

				if (result && result.name && result.name == "RpcError") {
					logStats(cmd, false, new Date().getTime() - startTime, false);

					debugLog("RpcErrorResult-02: " + JSON.stringify(result));

					throw new Error(`RpcError: type=errorResponse-02`);
				}

				resolve(result);

				logStats(cmd, false, new Date().getTime() - startTime, true);

				callback();

			} catch (err) {
				withUserData(err, {request:cmd});

				logError("RpcError-001", err, {request:cmd});

				logStats(cmd, false, new Date().getTime() - startTime, false);

				reject(err);

				callback();
			}
		};

		rpcQueue.push({rpcCall:rpcCall});
	});
}

// The result of an RPC call with parameters: see getRpcData.
export function getRpcDataWithParams(request: RpcRequest, verifyingConnection = false): Promise<RpcData> {
	const startTime = new Date().getTime();

	if (!verifyingConnection && !global.rpcConnected) {
		return Promise.reject(new Error("No RPC connection available. Check your connection/authentication parameters."));
	}

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${JSON.stringify(request)}`);

		const rpcCall = async function(callback: () => void) {
			const client = (request.method == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);

			try {
				const rpcResult = await client.request(request.method, request.parameters);
				checkRpcError(request.method, rpcResult);

				const result = rpcResult.result;

				if (Array.isArray(result) && result.length == 1) {
					const result0 = result[0];

					if (result0 && result0.name && result0.name == "RpcError") {
						logStats(request.method, true, new Date().getTime() - startTime, false);

						debugLog("RpcErrorResult-03: request=" + JSON.stringify(request) + ", result=" + JSON.stringify(result0));

						throw new Error(`RpcError: type=errorResponse-03`);
					}
				}

				if (result && result.name && result.name == "RpcError") {
					logStats(request.method, true, new Date().getTime() - startTime, false);

					debugLog("RpcErrorResult-04: " + JSON.stringify(result));

					throw new Error(`RpcError: type=errorResponse-04`);
				}

				resolve(result);

				logStats(request.method, true, new Date().getTime() - startTime, true);

				callback();

			} catch (err) {
				withUserData(err, {request:request});

				logError("RpcError-002", err, {request:`${request.method}${request.parameters ? ("(" + JSON.stringify(request.parameters) + ")") : ""}`});

				logStats(request.method, true, new Date().getTime() - startTime, false);

				reject(err);

				callback();
			}
		};

		rpcQueue.push({rpcCall:rpcCall});
	});
}

function unsupportedPromise(minRpcVersionNeeded: string): Promise<RpcData> {
	return Promise.resolve({success:false, error:"Unsupported", minRpcVersionNeeded:minRpcVersionNeeded});
}

function logStats(cmd: string, hasParams: boolean, dt: number, success: boolean) {
	if (!global.rpcStats[cmd]) {
		global.rpcStats[cmd] = {count:0, withParams:0, time:0, successes:0, failures:0};
	}

	global.rpcStats[cmd].count++;
	global.rpcStats[cmd].time += dt;

	statTracker.trackPerformance(`rpc.${cmd}`, dt);
	statTracker.trackPerformance(`rpc.*`, dt);

	if (hasParams) {
		global.rpcStats[cmd].withParams++;
	}

	if (success) {
		global.rpcStats[cmd].successes++;
		statTracker.trackEvent(`rpc-result.${cmd}.success`);
		statTracker.trackEvent(`rpc-result.*.success`);

	} else {
		global.rpcStats[cmd].failures++;
		statTracker.trackEvent(`rpc-result.${cmd}.failure`);
		statTracker.trackEvent(`rpc-result.*.failure`);
	}
}
