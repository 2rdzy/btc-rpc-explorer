'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { rpcCacheKeyComponent } = require('../app/rpcCacheKey.js');

const node = { host: '127.0.0.1', port: 8332, authType: 'cookie' };

describe('rpcCacheKeyComponent', () => {
	test('is eight hex characters', () => assert.match(rpcCacheKeyComponent(node), /^[0-9a-f]{8}$/));

	test('is the same for the same node', () => assert.equal(rpcCacheKeyComponent(node), rpcCacheKeyComponent({ ...node })));

	test('differs by host, by port and by how the explorer logs in', () => {
		const keys = new Set([
			rpcCacheKeyComponent(node),
			rpcCacheKeyComponent({ ...node, host: '10.0.0.2' }),
			rpcCacheKeyComponent({ ...node, port: 18332 }),
			rpcCacheKeyComponent({ ...node, authType: 'usernamePassword' })
		]);

		assert.equal(keys.size, 4);
	});

	test('does not depend on any secret: a password, a username or a cookie file path changes nothing', () => {
		const base = rpcCacheKeyComponent(node);

		assert.equal(rpcCacheKeyComponent({ ...node, password: 'hunter2', username: 'rpc', authCookieFilepath: '/x/.cookie' }), base);
		assert.equal(rpcCacheKeyComponent({ ...node, password: 'another' }), base);
	});

	test('treats a port given as a string like the same port as a number', () => {
		assert.equal(rpcCacheKeyComponent({ ...node, port: '8332' }), rpcCacheKeyComponent(node));
	});
});
