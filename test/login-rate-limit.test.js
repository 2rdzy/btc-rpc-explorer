'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, describe, test } = require('node:test');

const express = require('express');

require('./helpers/setup.js');
const auth = require('../app/auth.js');
const sso = require('../app/sso.js');
const { createLoginRateLimiter, isFailedLogin } = require('../app/loginRateLimit.js');

const servers = [];

after(() => Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))));

async function serve(app) {
	const server = app.listen(0, '127.0.0.1');

	servers.push(server);
	await new Promise(resolve => server.once('listening', resolve));

	return `http://127.0.0.1:${server.address().port}`;
}

const basic = password => ({ headers: { authorization: 'Basic ' + Buffer.from(`:${password}`).toString('base64') } });

describe('failed login rate limit with Basic auth', () => {
	async function start(maxFailures) {
		const app = express();

		app.use(createLoginRateLimiter({ windowMs: 60000, maxFailures }));
		app.use(auth('secret'));
		app.get('/', (req, res) => res.send('page'));

		return serve(app);
	}

	test('counts wrong passwords, then refuses further attempts with 429, even the right password', async () => {
		const base = await start(3);

		for (let i = 0; i < 3; i++) {
			assert.equal((await fetch(base, basic('wrong'))).status, 401);
		}

		assert.equal((await fetch(base, basic('wrong'))).status, 429);
		assert.equal((await fetch(base, basic('secret'))).status, 429);
		assert.equal((await fetch(base)).status, 429);
	});

	test('a request with no credentials counts as a failure too', async () => {
		const base = await start(2);

		assert.equal((await fetch(base)).status, 401);
		assert.equal((await fetch(base)).status, 401);
		assert.equal((await fetch(base)).status, 429);
	});

	test('requests that log in are not counted, however many there are', async () => {
		const base = await start(3);

		for (let i = 0; i < 20; i++) {
			assert.equal((await fetch(base, basic('secret'))).status, 200);
		}

		// and the failures still have their whole allowance
		assert.equal((await fetch(base, basic('wrong'))).status, 401);
	});

	test('only the failures are counted when they are mixed with logins', async () => {
		const base = await start(3);

		assert.equal((await fetch(base, basic('wrong'))).status, 401);
		assert.equal((await fetch(base, basic('secret'))).status, 200);
		assert.equal((await fetch(base, basic('wrong'))).status, 401);
		assert.equal((await fetch(base, basic('secret'))).status, 200);
		assert.equal((await fetch(base, basic('wrong'))).status, 401);
		assert.equal((await fetch(base, basic('secret'))).status, 429);
	});

	test('the refusal says what happened and sends the rate limit headers', async () => {
		const base = await start(1);

		await fetch(base, basic('wrong'));
		const response = await fetch(base, basic('wrong'));

		assert.equal(response.status, 429);
		assert.match((await response.json()).message, /Too many failed login attempts/);
		assert.ok(response.headers.get('ratelimit'));
	});
});

describe('failed login rate limit with an SSO token', () => {
	async function start(maxFailures, loginRedirect) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-limit-'));
		const tokenFile = path.join(dir, 'token');
		const app = express();

		app.use(createLoginRateLimiter({ windowMs: 60000, maxFailures, loginRedirect }));
		app.use(sso(tokenFile, loginRedirect));
		app.get('/', (req, res) => res.send('page'));

		return { base: await serve(app), tokenFile };
	}

	test('wrong tokens are counted (refused with 401), then 429', async () => {
		const { base } = await start(2, null);

		assert.equal((await fetch(`${base}/?token=wrong`)).status, 401);
		assert.equal((await fetch(`${base}/?token=wrong2`)).status, 401);
		assert.equal((await fetch(`${base}/?token=wrong3`)).status, 429);
	});

	test('with a login page, refusals are redirects to it, and they are counted', async () => {
		const { base } = await start(2, 'https://login.example/');

		assert.equal((await fetch(`${base}/?token=wrong`, { redirect: 'manual' })).status, 302);
		assert.equal((await fetch(`${base}/?token=wrong2`, { redirect: 'manual' })).status, 302);
		assert.equal((await fetch(`${base}/?token=wrong3`, { redirect: 'manual' })).status, 429);
	});

	test('the right token is not counted', async () => {
		const { base, tokenFile } = await start(2, null);

		assert.equal((await fetch(`${base}/?token=wrong`)).status, 401);
		assert.equal((await fetch(`${base}/?token=${fs.readFileSync(tokenFile, 'utf8')}`)).status, 200);
		assert.equal((await fetch(`${base}/?token=wrong`)).status, 401);
		assert.equal((await fetch(`${base}/?token=wrong`)).status, 429);
	});
});

describe('isFailedLogin', () => {
	const response = (statusCode, headers = {}) => ({ statusCode, getHeader: name => headers[name] });

	test('a 401 is a failure', () => assert.equal(isFailedLogin(response(401), null), true));
	test('success, not found and server errors are not', () => {
		for (const code of [200, 204, 304, 404, 500]) {
			assert.equal(isFailedLogin(response(code), null), false, `${code}`);
		}
	});
	test('a redirect to the login page is a failure, any other redirect is not', () => {
		assert.equal(isFailedLogin(response(302, { location: 'https://login.example/' }), 'https://login.example/'), true);
		assert.equal(isFailedLogin(response(302, { location: '/somewhere' }), 'https://login.example/'), false);
		assert.equal(isFailedLogin(response(302, { location: 'https://login.example/' }), null), false);
	});
});
