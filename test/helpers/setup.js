'use strict';

// The explorer's modules expect some globals that app.js normally sets up. Require this
// file before any module from app/.

// no in-memory RPC cache: each test sets its own RPC answers and must see them
process.env.BTCEXP_NO_INMEMORY_RPC_CACHE = 'true';

global.cacheStats = {};
global.appEventStats = {};
global.activeBlockchain = 'main';
global.btcNodeSemver = '29.4.2';
global.rpcConnected = true;
global.txindexAvailable = true;
global.cacheId = 'test';

const config = require('../../app/config.js');
const coins = require('../../app/coins.js');

global.coinConfig = coins[config.coin];

// Replace the RPC client with one that answers from `handlers`: an object mapping an RPC
// method name to a function (params) => result, or => { error: { code, message } }.
function fakeRpc(handlers) {
	const calls = [];

	const client = {
		request: async (method, params) => {
			calls.push({ method, params });

			if (!handlers[method]) {
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

module.exports = { fakeRpc, config };
