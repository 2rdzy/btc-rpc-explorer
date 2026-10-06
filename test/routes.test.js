'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

require('./helpers/setup.js');
const baseRouter = require('../routes/baseRouter.js');

const registered = baseRouter.stack
	.filter(layer => layer.route)
	.flatMap(layer => Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route.path}`));

describe('routes', () => {
	test('the pages are registered', () => {
		assert.ok(registered.includes('GET /'));
		assert.ok(registered.includes('GET /next-block'));
		assert.ok(registered.includes('GET /node-details'));
	});

	// These two used to let any request replace or null the shared RPC client (a one-request
	// denial of service). They must stay gone.
	for (const route of ['POST /connect', 'GET /connect', 'GET /disconnect', 'POST /disconnect']) {
		test(`${route} is not registered`, () => {
			assert.ok(!registered.includes(route), `${route} should not exist`);
		});
	}
});
