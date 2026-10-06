import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import "./helpers/setup.js";
import sso from "../app/sso.js";
import type { Request, RequestHandler, Response } from "express";

describe('SSO token middleware', () => {
	let dir: string;
	let tokenFile: string;
	let middleware: RequestHandler;

	// run the middleware for a request and report what it did
	function run(req: { cookies?: Record<string, unknown>, query?: Record<string, unknown> }) {
		const result: { next: boolean, status: number | null, redirect: string | null, cookie: { name: string, value: string } | null } = { next: false, status: null, redirect: null, cookie: null };
		const res = {
			sendStatus: (code: number) => { result.status = code; },
			redirect: (url: string) => { result.redirect = url; },
			cookie: (name: string, value: string) => { result.cookie = { name, value }; }
		};

		middleware({ cookies: {}, query: {}, ...req } as unknown as Request, res as unknown as Response, () => { result.next = true; });

		return result;
	}

	const currentToken = () => fs.readFileSync(tokenFile, 'utf8');

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-test-'));
		tokenFile = path.join(dir, 'token');
		middleware = sso(tokenFile, null);
	});

	after(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('writes a token file at start', () => {
		assert.ok(currentToken().length >= 20);
	});

	test('refuses a request with no token', () => {
		assert.deepEqual(run({}), { next: false, status: 401, redirect: null, cookie: null });
	});

	test('refuses a wrong token', () => {
		assert.equal(run({ query: { token: 'not-the-token' } }).status, 401);
	});

	test('refuses an empty token', () => {
		assert.equal(run({ query: { token: '' } }).status, 401);
	});

	test('refuses a token sent as an array or an object, without failing', () => {
		const token = currentToken();

		assert.equal(run({ query: { token: [token] } }).status, 401);
		assert.equal(run({ query: { token: [token, token] } }).status, 401);
		assert.equal(run({ query: { token: { a: token } } }).status, 401);
	});

	test('refuses a token that has the right start but is too long or too short', () => {
		const token = currentToken();

		assert.equal(run({ query: { token: token + 'x' } }).status, 401);
		assert.equal(run({ query: { token: token.slice(0, -1) } }).status, 401);
	});

	test('accepts the right token once: it sets a cookie, and the token changes', () => {
		const token = currentToken();
		const accepted = run({ query: { token } });

		assert.equal(accepted.next, true);
		assert.equal(accepted.cookie!.name, 'btcexp_auth');
		assert.ok(accepted.cookie!.value.length >= 20);
		assert.notEqual(currentToken(), token);

		// the same token no longer works
		assert.equal(run({ query: { token } }).status, 401);

		// the cookie does
		const withCookie = run({ cookies: { btcexp_auth: accepted.cookie!.value } });

		assert.equal(withCookie.next, true);
	});

	test('a cookie that was never issued is refused', () => {
		assert.equal(run({ cookies: { btcexp_auth: 'made-up' } }).status, 401);
	});

	test('with a login page configured, a refused request is redirected to it', () => {
		const other = sso(path.join(dir, 'token2'), 'https://login.example/');
		const result: { redirect: string | null } = { redirect: null };

		other({ cookies: {}, query: {} } as unknown as Request, { redirect: (url: string) => { result.redirect = url; } } as unknown as Response, () => {});

		assert.equal(result.redirect, 'https://login.example/');
	});
});
