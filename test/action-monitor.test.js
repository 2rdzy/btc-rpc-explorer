'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const express = require('express');

require('./helpers/setup.js');
const actionPerformanceMonitor = require('../app/actionPerformanceMonitor.js');

describe('action performance monitor', () => {
	let server;
	let base;
	const performance = [];
	const events = [];

	const statTracker = {
		trackPerformance: (name, ms) => performance.push([name, ms]),
		trackEvent: name => events.push(name)
	};

	before(async () => {
		const app = express();

		app.use(actionPerformanceMonitor(statTracker, { normalizeAction: action => action.replace(/\/block\/.*/, '/block') }));
		app.get('/block/:hash', (req, res) => res.send('block'));
		app.get('/fast', (req, res) => res.send('fast'));
		app.get('/style.css', (req, res) => res.type('css').send('x'));
		app.get('/missing-page', (req, res) => res.sendStatus(404));

		server = app.listen(0, '127.0.0.1');
		await new Promise(resolve => server.once('listening', resolve));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	after(() => new Promise(resolve => server.close(resolve)));

	const reset = () => { performance.length = 0; events.length = 0; };

	test('records how long an action took, under its normalised name and under the total', async () => {
		reset();
		await fetch(`${base}/block/abc123`);

		assert.deepEqual(performance.map(p => p[0]), ['action./block', 'action.*']);
		assert.ok(performance.every(p => typeof p[1] === 'number' && p[1] >= 0 && p[1] < 5000));
	});

	test('counts the status of each action by hundreds', async () => {
		reset();
		await fetch(`${base}/fast`);
		await fetch(`${base}/missing-page`);

		assert.deepEqual(events.filter(e => e.startsWith('action-status.')), [
			'action-status./fast.200', 'action-status.*.200', 'action-status./missing-page.400', 'action-status.*.400']);
	});

	test('ignores static files', async () => {
		reset();
		await fetch(`${base}/style.css`);

		assert.deepEqual(performance, []);
		assert.deepEqual(events, []);
	});

	test('records which crawler asked, when it is a known one', async () => {
		reset();
		await fetch(`${base}/fast`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });

		assert.ok(events.some(e => e.startsWith('site-crawl.')), JSON.stringify(events));
	});

	test('exposes itself as .middleware too', () => {
		const middleware = actionPerformanceMonitor(statTracker);

		assert.equal(middleware.middleware, middleware);
		assert.equal(typeof middleware, 'function');
	});
});
