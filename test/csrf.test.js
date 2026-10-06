'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');

const { csrfProtection, forceCsrf, generateToken } = require('../app/csrf.js');

let server;
let base;

before(async () => {
	const app = express();

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: false }));
	app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
	app.use(csrfProtection, (req, res, next) => {
		res.locals.csrfToken = generateToken(req);

		next();
	});

	app.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
	app.get('/page', (req, res) => res.send('page'));
	app.post('/action', (req, res) => res.send('done'));
	app.get('/strict', forceCsrf, (req, res) => res.send('strict done'));

	// the same shape as the explorer's own error handler: errors carry a status
	app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.code || err.message }));

	server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

// a minimal client with its own session cookie
function client() {
	let cookie = '';

	const request = async (path, options = {}) => {
		const response = await fetch(base + path, { ...options, headers: { ...options.headers, cookie } });
		const setCookie = response.headers.get('set-cookie');

		if (setCookie) {
			cookie = setCookie.split(';')[0];
		}

		return response;
	};

	const token = async () => (await (await request('/token')).json()).token;

	return { request, token };
}

const form = fields => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const json = (fields, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(fields) });

describe('CSRF protection', () => {
	test('a session keeps the same token across requests', async () => {
		const c = client();

		assert.equal(await c.token(), await c.token());
		assert.match(await c.token(), /\S{20,}/);
	});

	test('different sessions get different tokens', async () => {
		assert.notEqual(await client().token(), await client().token());
	});

	test('a post with no token is refused with 403', async () => {
		const response = await client().request('/action', form({}));

		assert.equal(response.status, 403);
		assert.equal((await response.json()).error, 'EBADCSRFTOKEN');
	});

	test('a post with the token in a form field is accepted', async () => {
		const c = client();

		assert.equal((await c.request('/action', form({ _csrf: await c.token() }))).status, 200);
	});

	test('a post with the token in a JSON body is accepted (what the terminal pages send)', async () => {
		const c = client();

		assert.equal((await c.request('/action', json({ _csrf: await c.token(), cmd: 'help' }))).status, 200);
	});

	for (const header of ['csrf-token', 'xsrf-token', 'x-csrf-token', 'x-xsrf-token']) {
		test(`a post with the token in the ${header} header is accepted`, async () => {
			const c = client();

			assert.equal((await c.request('/action', json({}, { [header]: await c.token() }))).status, 200);
		});
	}

	test('a post with a wrong token is refused', async () => {
		const c = client();
		await c.token();

		assert.equal((await c.request('/action', form({ _csrf: 'not-the-token' }))).status, 403);
	});

	test('a token from another session is refused', async () => {
		const other = await client().token();
		const c = client();
		await c.token();

		assert.equal((await c.request('/action', form({ _csrf: other }))).status, 403);
	});

	test('a post without a session at all is refused', async () => {
		const response = await fetch(`${base}/action`, form({ _csrf: 'anything' }));

		assert.equal(response.status, 403);
	});

	test('a plain GET needs no token', async () => {
		assert.equal((await client().request('/page')).status, 200);
	});

	test('forceCsrf checks GET requests too', async () => {
		const c = client();
		const token = await c.token();

		assert.equal((await c.request('/strict')).status, 403);
		assert.equal((await c.request(`/strict?_csrf=${encodeURIComponent(token)}`)).status, 200);
		assert.equal((await c.request('/strict?_csrf=wrong')).status, 403);
	});
});
