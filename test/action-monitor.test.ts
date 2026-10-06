import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import express from "express";

import "./helpers/setup.js";
import actionPerformanceMonitor from "../app/actionPerformanceMonitor.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

describe('action performance monitor', () => {
	let server: Server;
	let base: string;
	const performance: [string, number][] = [];
	const events: string[] = [];

	const statTracker = {
		trackPerformance: (name: string, ms: number) => { performance.push([name, ms]); },
		trackEvent: (name: string) => { events.push(name); }
	};

	before(async () => {
		const app = express();

		app.use(actionPerformanceMonitor(statTracker, { normalizeAction: (action: string) => action.replace(/\/block\/.*/, '/block') }));
		app.get('/block/:hash', (req, res) => res.send('block'));
		app.get('/fast', (req, res) => res.send('fast'));
		app.get('/style.css', (req, res) => res.type('css').send('x'));
		app.get('/missing-page', (req, res) => res.sendStatus(404));

		server = app.listen(0, '127.0.0.1');
		await new Promise(resolve => server.once('listening', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
