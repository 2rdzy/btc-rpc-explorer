"use strict";

const crypto = require("crypto");

// A short identifier of the node an instance talks to, used as part of every Redis cache key, so that
// several instances (for example mainnet and testnet) can share one Redis without mixing their data.
//
// It is made from the node's address and how the explorer logs in to it, and nothing secret: it used to be
// a hash of the whole credentials object, password included, so anyone who could list the Redis keys saw
// a checksum of the RPC password.
/**
 * @param {{host?: string | number, port?: string | number, authType?: string}} rpcCredentials
 * @returns {string} eight hex characters
 */
function rpcCacheKeyComponent(rpcCredentials) {
	const identity = `${rpcCredentials.host}:${rpcCredentials.port}:${rpcCredentials.authType}`;

	return crypto.createHash("sha256").update(identity).digest("hex").substring(0, 8);
}

module.exports = {
	rpcCacheKeyComponent: rpcCacheKeyComponent
};
