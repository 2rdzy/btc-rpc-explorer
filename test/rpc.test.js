'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { fakeRpc } = require('./helpers/setup.js');
const rpcApi = require('../app/api/rpcApi.js');

describe('RPC errors', () => {
	test('getblocktemplate asks for the blake2b rule', async () => {
		const calls = fakeRpc({ getblocktemplate: () => ({ transactions: [] }) });

		await rpcApi.getBlockTemplate();

		assert.deepEqual(calls[0].params, [{ rules: ['segwit', 'blake2b'] }]);
	});

	test('a node error on a status call rejects with the node message and code', async () => {
		fakeRpc({ getblocktemplate: () => ({ error: { code: -8, message: "Support for 'blake2b' rule requires explicit client support" } }) });

		await assert.rejects(rpcApi.getBlockTemplate(), err => {
			assert.match(err.message, /getblocktemplate failed: Support for 'blake2b' rule/);
			assert.equal(err.rpcCode, -8);

			return true;
		});
	});

	for (const method of ['getblockchaininfo', 'getmininginfo', 'getnetworkinfo']) {
		test(`a node error on ${method} rejects`, async () => {
			fakeRpc({ [method]: () => ({ error: { code: -1, message: 'boom' } }) });

			const call = { getblockchaininfo: () => rpcApi.getBlockchainInfo(), getmininginfo: () => rpcApi.getMiningInfo(), getnetworkinfo: () => rpcApi.getNetworkInfo() }[method];

			await assert.rejects(call(), /boom/);
		});
	}

	test('a node error on a call that can legitimately miss resolves null instead of rejecting', async () => {
		fakeRpc({ gettxout: () => ({ error: { code: -5, message: 'No such mempool or blockchain transaction' } }) });

		assert.equal(await rpcApi.getRpcDataWithParams({ method: 'gettxout', parameters: ['00', 0] }), null);
	});

	test('a successful reply resolves with its result', async () => {
		fakeRpc({ getblockchaininfo: () => ({ blocks: 5, difficulty_blake2b: 1e19 }) });

		assert.deepEqual(await rpcApi.getBlockchainInfo(), { blocks: 5, difficulty_blake2b: 1e19 });
	});
});
