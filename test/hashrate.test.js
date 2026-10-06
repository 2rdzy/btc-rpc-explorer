'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { fakeRpc } = require('./helpers/setup.js');
const coreApi = require('../app/api/coreApi.js');

const forkHeight = 961640;
const tip = 975700;

describe('network hashrate and the BLAKE2b fork', () => {
	test('a window that stays after the fork is reported', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ deployments: {}, blake2b: { height: forkHeight, active: true } }),
			getblockchaininfo: () => ({ blocks: tip }),
			getnetworkhashps: ([blocks]) => 4.4e16 + blocks
		});

		assert.equal(await coreApi.getNetworkHashrate(1008), 4.4e16 + 1008);
		assert.equal(await coreApi.getNetworkHashrate(4320), 4.4e16 + 4320);
	});

	test('a window that reaches back before the fork is not reported', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ deployments: {}, blake2b: { height: forkHeight, active: true } }),
			getblockchaininfo: () => ({ blocks: tip }),
			getnetworkhashps: () => 1e16
		});

		assert.equal(await coreApi.getNetworkHashrate(52560), null);
	});

	test('the window that ends exactly at the fork height is still allowed', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ deployments: {}, blake2b: { height: forkHeight, active: true } }),
			getblockchaininfo: () => ({ blocks: forkHeight + 500 }),
			getnetworkhashps: () => 2e16
		});

		assert.equal(await coreApi.getNetworkHashrate(500), 2e16);
		assert.equal(await coreApi.getNetworkHashrate(501), null);
	});

	test('without fork information every window is reported', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ deployments: {} }),
			getblockchaininfo: () => ({ blocks: tip }),
			getnetworkhashps: () => 3e20
		});

		assert.equal(await coreApi.getNetworkHashrate(60000), 3e20);
	});

	test('a fork that has not taken effect yet does not restrict windows', async () => {
		fakeRpc({
			getdeploymentinfo: () => ({ deployments: {}, blake2b: { height: forkHeight, active: false } }),
			getblockchaininfo: () => ({ blocks: forkHeight - 10 }),
			getnetworkhashps: () => 5e20
		});

		assert.equal(await coreApi.getNetworkHashrate(70000), 5e20);
	});
});
