// The explorer's modules expect some globals that app.ts normally sets up. Import this
// file before any module from app/.

import "./env.js";
import config from "../../app/config.js";
import coins from "../../app/coins.js";
import type { RpcData } from "../../app/api/rpcApi.js";

global.cacheStats = {};
global.appEventStats = {};
global.activeBlockchain = 'main';
global.btcNodeSemver = '29.4.2';
global.rpcConnected = true;
global.txindexAvailable = true;
global.cacheId = 'test';

global.coinConfig = coins[config.coin];
global.SATS_PER_BTC = global.coinConfig.baseCurrencyUnit.multiplier;

export interface RpcCall {
	method: string,
	params: RpcData[]
}

// an RPC method's answer: its result, or { error: { code, message } }
export type RpcHandlers = Record<string, (params: RpcData[]) => RpcData>;

// Replace the RPC client with one that answers from `handlers`: an object mapping an RPC
// method name to a function (params) => result, or => { error: { code, message } }.
// Returns the calls that were made.
function fakeRpc(handlers: RpcHandlers): RpcCall[] {
	const calls: RpcCall[] = [];

	const client = {
		request: async (method: string, params: RpcData[]) => {
			calls.push({ method, params });

			if (!Object.hasOwn(handlers, method)) {
				return { result: null, error: { code: -32601, message: `Method not found: ${method}` } };
			}

			const answer = handlers[method](params);

			return (answer && answer.error) ? { result: null, error: answer.error } : { result: answer, error: null };
		}
	};

	global.rpcClient = client;
	global.rpcClientNoTimeout = client;

	return calls;
}

export { fakeRpc, config };
