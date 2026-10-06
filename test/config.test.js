'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');

// config and credentials read the environment when they are loaded, so each case runs the real module in a
// child process with exactly the environment it names (and no BTCEXP_ variable of this machine)
function run(env, expression) {
	const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('BTCEXP_') && name !== 'PORT'));

	const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', `process.stdout.write(JSON.stringify((${expression})))`], {
		cwd: root,
		env: { ...cleanEnv, HOME: os.tmpdir(), ...env },
		encoding: 'utf8'
	});

	return { status: result.status, stdout: result.stdout, stderr: result.stderr, value: result.status === 0 ? JSON.parse(result.stdout) : undefined };
}

const config = (env, property) => {
	const result = run(env, `require('./app/config.ts')${property ? '.' + property : ''}`);

	assert.equal(result.status, 0, result.stderr);

	return result.value;
};

describe('config defaults', () => {
	test('the server listens on localhost:3002 with the base url /', () => {
		const c = config({});

		assert.equal(c.host, '127.0.0.1');
		assert.equal(c.port, 3002);
		assert.equal(c.baseUrl, '/');
		assert.equal(c.coin, 'BTC');
	});

	test('privacy, demo and the in-memory cache switch default to off; rates and slow device mode to on', () => {
		const c = config({});

		assert.equal(c.privacyMode, false);
		assert.equal(c.demoSite, false);
		assert.equal(c.noInmemoryRpcCache, false);
		assert.equal(c.slowDeviceMode, true);
		assert.equal(c.queryExchangeRates, false);
	});

	test('slow device mode picks the small page sizes', () => {
		assert.equal(config({}, 'site.blockTxPageSize'), 10);
		assert.equal(config({ BTCEXP_SLOW_DEVICE_MODE: 'false' }, 'site.blockTxPageSize'), 20);
		assert.equal(config({}, 'rpcConcurrency'), 3);
		assert.equal(config({ BTCEXP_SLOW_DEVICE_MODE: 'false' }, 'rpcConcurrency'), 10);
	});

	test('rate limits default to 200 requests per 15 minutes and 20 failed logins', () => {
		assert.deepEqual(config({}, 'rateLimiting'), { windowMinutes: 15, windowMaxRequests: 200, loginMaxFailures: 20 });
	});

	test('the Electrum server list is empty, and the TLS settings are verified by default', () => {
		assert.deepEqual(config({}, 'electrumServers'), []);
		assert.deepEqual(config({}, 'electrumTls'), {});
	});
});

describe('config from the environment', () => {
	test('the base url gets a leading and a trailing slash', () => {
		assert.equal(config({ BTCEXP_BASEURL: 'explorer' }, 'baseUrl'), '/explorer/');
		assert.equal(config({ BTCEXP_BASEURL: ' /x ' }, 'baseUrl'), '/x/');
	});

	test('numbers are read as numbers; a value that is not a number falls back to the default', () => {
		assert.deepEqual(
			config({ BTCEXP_RATE_LIMIT_WINDOW_MINUTES: '5', BTCEXP_RATE_LIMIT_WINDOW_MAX_REQUESTS: '50', BTCEXP_RATE_LIMIT_LOGIN_FAILURES: '3' }, 'rateLimiting'),
			{ windowMinutes: 5, windowMaxRequests: 50, loginMaxFailures: 3 });
		assert.deepEqual(config({ BTCEXP_RATE_LIMIT_WINDOW_MINUTES: 'abc', BTCEXP_RATE_LIMIT_LOGIN_FAILURES: 'x' }, 'rateLimiting'), { windowMinutes: 15, windowMaxRequests: 200, loginMaxFailures: 20 });
		assert.equal(config({ BTCEXP_RATE_LIMIT_WINDOW_MINUTES: '-1' }, 'rateLimiting.windowMinutes'), -1);
		assert.equal(config({ BTCEXP_RPC_CONCURRENCY: '7' }, 'rpcConcurrency'), 7);
		assert.equal(config({ BTCEXP_RPC_CONCURRENCY: 'many' }, 'rpcConcurrency'), 3);
	});

	test('switches are read case-insensitively', () => {
		assert.equal(config({ BTCEXP_PRIVACY_MODE: 'TRUE' }, 'privacyMode'), true);
		assert.equal(config({ BTCEXP_DEMO: 'True' }, 'demoSite'), true);
		assert.equal(config({ BTCEXP_NO_RATES: 'false' }, 'queryExchangeRates'), true);
		assert.equal(config({ BTCEXP_NO_RATES: 'false', BTCEXP_PRIVACY_MODE: 'true' }, 'queryExchangeRates'), false);
	});

	test('dangerous RPC commands are blocked unless everything is allowed or a list is given', () => {
		const blocked = config({}, 'rpcBlacklist');

		assert.ok(blocked.includes('stop') && blocked.includes('dumpprivkey') && blocked.includes('sendtoaddress'));
		assert.deepEqual(config({ BTCEXP_RPC_ALLOWALL: 'true' }, 'rpcBlacklist'), []);
		assert.deepEqual(config({ BTCEXP_RPC_BLACKLIST: 'stop,,getinfo' }, 'rpcBlacklist'), ['stop', 'getinfo']);
	});

	test('Electrum servers are parsed from their URIs', () => {
		assert.deepEqual(
			config({ BTCEXP_ELECTRUM_SERVERS: 'tls://192.168.1.5:50002,tcp://localhost:50001' }, 'electrumServers'),
			[{ protocol: 'tls', host: '192.168.1.5', port: 50002 }, { protocol: 'tcp', host: 'localhost', port: 50001 }]);
		assert.equal(config({ BTCEXP_ELECTRUMX_SERVERS: 'tcp://a:1' }, 'electrumServers.length'), 1);
	});

	test('an Electrum server without a protocol is a clear error', () => {
		for (const server of ['192.168.1.5:50002', 'localhost', 'tls:/missing-slash:50002']) {
			const result = run({ BTCEXP_ELECTRUM_SERVERS: server }, "require('./app/config.ts')");

			assert.notEqual(result.status, 0, server);
			assert.match(result.stderr, /Invalid Electrum server .*needs a protocol/, server);
		}
	});

	test('the Electrum TLS settings: a pinned fingerprint, a trusted certificate, or switching verification off', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
		const ca = path.join(dir, 'ca.pem');

		fs.writeFileSync(ca, 'PEM-DATA');

		try {
			assert.deepEqual(config({ BTCEXP_ELECTRUM_TLS_FINGERPRINT: ' AB:CD ' }, 'electrumTls'), { fingerprint256: 'AB:CD' });
			assert.equal(config({ BTCEXP_ELECTRUM_TLS_CA: ca }, 'electrumTls.ca.length'), 8);
			assert.deepEqual(config({ BTCEXP_ELECTRUM_TLS_ALLOW_UNVERIFIED: 'true' }, 'electrumTls'), { rejectUnauthorized: false });

			const missing = run({ BTCEXP_ELECTRUM_TLS_CA: path.join(dir, 'nope.pem') }, "require('./app/config.ts')");

			assert.notEqual(missing.status, 0);
			assert.match(missing.stderr, /Unable to read BTCEXP_ELECTRUM_TLS_CA/);

		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('an unverified TLS setting prints a warning', () => {
		const result = run({ BTCEXP_ELECTRUM_TLS_ALLOW_UNVERIFIED: 'true' }, "require('./app/config.ts').electrumTls");

		assert.match(result.stderr, /WARNING: BTCEXP_ELECTRUM_TLS_ALLOW_UNVERIFIED=true/);
	});
});

describe('RPC credentials', () => {
	const rpc = (env, property) => {
		const result = run(env, `require('./app/credentials.ts').rpc${property ? '.' + property : ''}`);

		assert.equal(result.status, 0, result.stderr);

		return result.value;
	};

	test('default to localhost:8332, with no user and the cookie file of the default data directory', () => {
		const c = rpc({});

		assert.equal(c.host, '127.0.0.1');
		assert.equal(c.port, 8332);
		assert.equal(c.authType, 'usernamePassword');
		assert.equal(c.timeout, 5000);
		assert.equal(c.authCookieFilepath, path.join(os.tmpdir(), '.bitcoin', '.cookie'));
	});

	test('come from the user, password, host, port and timeout settings', () => {
		const c = rpc({ BTCEXP_BITCOIND_USER: 'rpc', BTCEXP_BITCOIND_PASS: 'pw', BTCEXP_BITCOIND_HOST: '10.0.0.2', BTCEXP_BITCOIND_PORT: '18332', BTCEXP_BITCOIND_RPC_TIMEOUT: '9000' });

		const { authCookieFilepath, ...rest } = c;

		assert.ok(authCookieFilepath);
		assert.deepEqual(rest, { host: '10.0.0.2', port: '18332', authType: 'usernamePassword', username: 'rpc', password: 'pw', timeout: 9000 });
	});

	test('come from a single URI when one is given', () => {
		const c = rpc({ BTCEXP_BITCOIND_URI: 'bitcoin://alice:s3cret@192.168.0.9:8444?timeout=1234' });

		assert.equal(c.host, '192.168.0.9');
		assert.equal(c.port, '8444');
		assert.equal(c.username, 'alice');
		assert.equal(c.password, 's3cret');
		assert.equal(c.timeout, 1234);
	});

	test('are read from the cookie file when there is no user or password', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
		const cookie = path.join(dir, '.cookie');

		fs.writeFileSync(cookie, '__cookie__:abc123\n');

		try {
			const c = rpc({ BTCEXP_BITCOIND_COOKIE: cookie });

			assert.equal(c.authType, 'cookie');
			assert.equal(c.username, '__cookie__');
			assert.equal(c.password, 'abc123');

			// a user and password win over the cookie
			assert.equal(rpc({ BTCEXP_BITCOIND_COOKIE: cookie, BTCEXP_BITCOIND_USER: 'u', BTCEXP_BITCOIND_PASS: 'p' }, 'authType'), 'usernamePassword');

			// a cookie file in the wrong format is an error
			fs.writeFileSync(cookie, 'no-colon-here');

			const bad = run({ BTCEXP_BITCOIND_COOKIE: cookie }, "require('./app/credentials.ts').rpc");

			assert.notEqual(bad.status, 0);
			assert.match(bad.stderr, /in unexpected format/);

		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('the cookie is read again each time they are loaded (bitcoind makes a new one on every start)', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
		const cookie = path.join(dir, '.cookie');

		fs.writeFileSync(cookie, '__cookie__:first');

		try {
			// the cookie's path is already in the child's environment, so the script reads it from there instead of having it pasted in
			const script = "(() => { const c = require('./app/credentials.ts'); const before = c.loadFreshRpcCredentials().password; require('fs').writeFileSync(process.env.BTCEXP_BITCOIND_COOKIE, '__cookie__:second'); return [before, c.loadFreshRpcCredentials().password]; })()";
			const result = run({ BTCEXP_BITCOIND_COOKIE: cookie }, script);

			assert.deepEqual(result.value, ['first', 'second']);

		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
