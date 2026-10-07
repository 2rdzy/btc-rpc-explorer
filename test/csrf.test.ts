import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import bodyParser from "body-parser";
import express from "express";
import session from "express-session";

import { csrfProtection, forceCsrf, generateToken } from "../app/csrf.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";

let server: Server;
let base: string;

before(async () => {
	const app = express();

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: false }));
	// the session cookie is secure, as in the explorer; the client below says it came over HTTPS
	app.set('trust proxy', true);
	app.use(session({ secret: 'test', resave: false, saveUninitialized: true, cookie: { secure: true, httpOnly: true, sameSite: 'lax' } }));
	app.use(csrfProtection, (req, res, next) => {
		res.locals.csrfToken = generateToken(req);

		next();
	});

	app.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
	app.get('/page', (req, res) => res.send('page'));
	app.post('/action', (req, res) => res.send('done'));
	app.get('/strict', forceCsrf, (req, res) => res.send('strict done'));

	// the same shape as the explorer's own error handler: errors carry a status
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	app.use((err: { statusCode?: number, code?: string, message: string }, req: Request, res: Response, next: NextFunction) => res.status(err.statusCode || 500).json({ error: err.code || err.message }));

	server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

// a minimal client with its own session cookie
function client() {
	let cookie = '';

	const request = async (path: string, options: RequestInit = {}) => {
		const response = await fetch(base + path, { ...options, headers: { ...(options.headers as Record<string, string>), cookie, 'x-forwarded-proto': 'https' } });
		const setCookie = response.headers.get('set-cookie');

		if (setCookie) {
			cookie = setCookie.split(';')[0];
		}

		return response;
	};

	const token = async () => (await (await request('/token')).json()).token;

	return { request, token };
}

const form = (fields: string | Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString() });
const json = (fields: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(fields) });

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

	test('a post with the token repeated (so an array) or as an object is refused', async () => {
		const c = client();
		const token = await c.token();

		assert.equal((await c.request('/action', form(`_csrf=${token}&_csrf=${token}`))).status, 403);
		assert.equal((await c.request('/action', json({ _csrf: [token] }))).status, 403);
		assert.equal((await c.request('/action', json({ _csrf: { a: token } }))).status, 403);
	});

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
