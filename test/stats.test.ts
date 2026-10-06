import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import * as statTracker from "../app/statTracker.js";
import * as appStats from "../app/appStats.js";
import type { Stat } from "../app/statTracker.js";

// hand everything gathered to collectors, which also resets the tracker
function drain() {
	const performance: Record<string, Stat> = {};
	const values: Record<string, Stat> = {};
	const events: Record<string, { count: number }> = {};

	statTracker.processAndReset((name, stat) => { performance[name] = stat; }, (name, stat) => { values[name] = stat; }, (name, stat) => { events[name] = stat; });

	return { performance, values, events };
}

describe('statTracker', () => {
	beforeEach(() => drain());

	test('tracks the minimum, maximum, sum, count and average of a performance figure', () => {
		statTracker.trackPerformance('action.block', 30);
		statTracker.trackPerformance('action.block', 10);
		statTracker.trackPerformance('action.block', 20);

		const stat = drain().performance['action.block'];

		assert.equal(stat.min, 10);
		assert.equal(stat.max, 30);
		assert.equal(stat.sum, 60);
		assert.equal(stat.count, 3);
		assert.equal(stat.avg, 20);
		assert.ok(stat.firstDate instanceof Date && stat.lastDate instanceof Date);
	});

	test('keeps values apart from performance figures, and names apart from each other', () => {
		statTracker.trackValue('mem', 5);
		statTracker.trackValue('cpu', 1);
		statTracker.trackPerformance('mem', 99);

		const { performance, values } = drain();

		assert.deepEqual(Object.keys(values).sort(), ['cpu', 'mem']);
		assert.equal(values.mem.max, 5);
		assert.equal(performance.mem.max, 99);
	});

	test('counts events, by one or by a given amount', () => {
		statTracker.trackEvent('hit');
		statTracker.trackEvent('hit');
		statTracker.trackEvent('hit', 5);
		statTracker.trackEvent('miss');

		assert.deepEqual(drain().events, { hit: { count: 7 }, miss: { count: 1 } });
	});

	test('currentStats shows what has been gathered so far', () => {
		statTracker.trackEvent('x', 2);
		statTracker.trackValue('y', 3);
		statTracker.trackPerformance('z', 4);

		const current = statTracker.currentStats();

		assert.deepEqual(current.event, { x: 2 });
		assert.equal(current.value.y.max, 3);
		assert.equal(current.performance.z.max, 4);
	});

	test('processAndReset starts again from nothing', () => {
		statTracker.trackEvent('x');
		drain();

		assert.deepEqual(statTracker.currentStats(), { performance: {}, event: {}, value: {} });
		assert.deepEqual(drain(), { performance: {}, values: {}, events: {} });
	});
});

describe('appStats', () => {
	test('ignores names it does not keep, and statistics without a maximum', () => {
		appStats.trackAppStats('something.else', { max: 5 });
		appStats.trackAppStats('process.cpu', {});

		const all = appStats.getAllAppStats();

		assert.equal('something.else' in all, false);
		assert.deepEqual(all['process.cpu'], []);
	});

	test('keeps the maxima it is given, per name', () => {
		appStats.trackAppStats('process.cpu', { max: 12 });
		appStats.trackAppStats('process.cpu', { max: 7 });
		appStats.trackAppStats('mem.heap.used', { max: 100 });

		const all = appStats.getAllAppStats();

		assert.deepEqual(all['process.cpu'].map(p => p.value), [12, 7]);
		assert.deepEqual(all['mem.heap.used'].map(p => p.value), [100]);
		assert.ok(all['process.cpu'].every(p => typeof p.time === 'number'));
	});

	test('keeps the recent points as they came, and folds the oldest six into their maximum', () => {
		for (let i = 1; i <= 100; i++) {
			appStats.trackAppStats('os.loadavg.1min', { max: i === 3 ? 999 : i });
		}

		const points = appStats.getAllAppStats()['os.loadavg.1min'];

		// the newest point is the 100th, as it came
		assert.equal(points[points.length - 1].value, 100);

		// older points were folded: the first one stands for points 1 to 6, and holds their largest value
		assert.equal(points[0].value, 999);
		assert.ok(points.length < 100);
	});
});
