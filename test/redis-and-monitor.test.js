'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');

// run a script that needs the explorer's modules in a child process with exactly the environment given
function run(env, script) {
	const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('BTCEXP_')));

	return spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: root, env: { ...cleanEnv, HOME: os.tmpdir(), ...env }, encoding: 'utf8', timeout: 30000 });
}

describe('redisCache', () => {
	test('is not active unless BTCEXP_REDIS_URL is set', () => {
		const result = run({}, "process.stdout.write(String(require('./app/redisCache.ts').active))");

		assert.equal(result.stdout, 'false');
	});

	test('is active when BTCEXP_REDIS_URL is set (it connects only when it is used)', () => {
		const result = run({ BTCEXP_REDIS_URL: 'redis://127.0.0.1:1' }, "process.stdout.write(String(require('./app/redisCache.ts').active))");

		assert.equal(result.stdout, 'true');
		assert.equal(result.status, 0);
	});

	test('a cache made without Redis configured says so when it is used, instead of failing obscurely', () => {
		const script = "require('./app/redisCache.ts').createCache('p', () => {}).get('k').then(() => console.log('NO ERROR'), e => console.log('ERROR: ' + e.message))";
		const result = run({}, script);

		assert.match(result.stdout, /ERROR: Redis is not configured \(BTCEXP_REDIS_URL\)/);
	});

	test('a Redis that cannot be reached is an error from get, which the tiered cache passes on', () => {
		const script = `
			const redisCache = require('./app/redisCache.ts');
			const { createTieredCache } = require('./app/cacheUtils.ts');
			const events = [];
			const tiered = createTieredCache([redisCache.createCache('p', (c, e) => events.push(e))]);
			tiered.get('k').then(() => console.log('NO ERROR'), e => console.log('REJECTED'));
			setTimeout(() => process.exit(0), 5000);
		`;
		const result = run({ BTCEXP_REDIS_URL: 'redis://127.0.0.1:1' }, script);

		assert.match(result.stdout, /REJECTED/);
	});
});

describe('systemMonitor', () => {
	test('loads without keeping the process running, and without failing', () => {
		const started = Date.now();
		const result = run({ SYSTEM_MONITOR_INTERVAL: '100000' }, "require('./app/systemMonitor.ts'); console.log('loaded')");

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /loaded/);
		assert.ok(Date.now() - started < 20000);
	});

	test('records process figures in the stat tracker once its interval has passed', () => {
		const script = `
			const statTracker = require('./app/statTracker.ts');
			require('./app/systemMonitor.ts');
			setTimeout(() => { const names = Object.keys(statTracker.currentStats().value); console.log(JSON.stringify(names.sort())); process.exit(0); }, 600);
		`;
		const result = run({ SYSTEM_MONITOR_INTERVAL: '100' }, script);
		const names = JSON.parse(result.stdout.trim().split('\n').pop());

		assert.ok(names.includes('process.cpu'), result.stdout);
		assert.ok(names.includes('mem.heap.used'));
		assert.ok(names.includes('os.loadavg.1min'));
	});
});
