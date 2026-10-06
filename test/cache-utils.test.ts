import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMemoryLruCache, createTieredCache, lruCache } from "../app/cacheUtils.js";

function memory() {
	const events: string[] = [];
	const cache = createMemoryLruCache('test', lruCache(100), (type, event, key) => { events.push(`${type}.${event}:${key}`); });

	return { cache, events };
}

describe('memory cache', () => {
	test('a missing key is a miss, a stored one a hit', async () => {
		const { cache, events } = memory();

		assert.equal(await cache.get('a'), undefined);

		cache.set('a', { n: 1 }, 1000);

		assert.deepEqual(await cache.get('a'), { n: 1 });
		assert.deepEqual(events, ['memory.try:a', 'memory.miss:a', 'memory.set:a', 'memory.try:a', 'memory.hit:a']);
	});

	test('an entry expires after its time', async () => {
		const { cache } = memory();

		cache.set('a', 1, 30);

		assert.equal(await cache.get('a'), 1);

		await new Promise(resolve => setTimeout(resolve, 60));

		assert.equal(await cache.get('a'), undefined);
	});

	test('a value stored with no time does not expire', async () => {
		const { cache } = memory();

		cache.set('a', 1);
		await new Promise(resolve => setTimeout(resolve, 40));

		assert.equal(await cache.get('a'), 1);
	});

	test('del removes an entry', async () => {
		const { cache, events } = memory();

		cache.set('a', 1, 1000);
		cache.del('a');

		assert.equal(await cache.get('a'), undefined);
		assert.ok(events.includes('memory.del:a'));
	});

	test('the least recently used entry goes when the cache is full', async () => {
		const small = createMemoryLruCache('small', lruCache(2), () => {});

		small.set('a', 1, 1000);
		small.set('b', 2, 1000);
		await small.get('a');
		small.set('c', 3, 1000);

		assert.equal(await small.get('b'), undefined);
		assert.equal(await small.get('a'), 1);
		assert.equal(await small.get('c'), 3);
	});
});

describe('tiered cache', () => {
	const fake = (data: Record<string, unknown> = {}) => ({ data, gets: 0, sets: [] as unknown[][], get(key: string) { this.gets++; return Promise.resolve(data[key] ?? null); }, set(key: string, value: unknown, maxAge?: number) { this.sets.push([key, value, maxAge]); data[key] = value; } });

	test('looks in each cache in turn and stops at the first hit', async () => {
		const first = fake();
		const second = fake({ a: 'from second' });
		const third = fake({ a: 'from third' });

		assert.equal(await createTieredCache([first, second, third]).get('a'), 'from second');
		assert.deepEqual([first.gets, second.gets, third.gets], [1, 1, 0]);
	});

	test('gives null when no cache has the key, and when there are no caches', async () => {
		assert.equal(await createTieredCache([fake(), fake()]).get('a'), null);
		assert.equal(await createTieredCache([]).get('a'), null);
	});

	test('stores to every cache, with the same time', () => {
		const first = fake();
		const second = fake();

		createTieredCache([first, second]).set('k', 'v', 500);

		assert.deepEqual(first.sets, [['k', 'v', 500]]);
		assert.deepEqual(second.sets, [['k', 'v', 500]]);
	});

	test('a cache that fails fails the lookup, instead of leaving it waiting for ever', async () => {
		const broken = { get: () => Promise.reject(new Error('redis is down')), set() {} };

		await assert.rejects(createTieredCache([fake(), broken, fake({ a: 1 })]).get('a'), /redis is down/);
	});

	test('a memory cache in front of another makes the second one unnecessary for repeat lookups', async () => {
		const front = memory().cache;
		const back = fake({ a: 'slow' });
		const tiered = createTieredCache([front, back]);

		assert.equal(await tiered.get('a'), 'slow');

		front.set('a', 'slow', 1000);

		assert.equal(await tiered.get('a'), 'slow');
		assert.equal(back.gets, 1);
	});
});
