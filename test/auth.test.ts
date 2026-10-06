import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NextFunction, Request, Response } from "express";

import auth from "../app/auth.js";

// run the middleware for a request with the given Authorization header, and report what it did
function run(password: string, authorization?: string) {
	const result: { next: boolean, status: number | null, challenge: string | null } = { next: false, status: null, challenge: null };
	const req = { headers: authorization === undefined ? {} : { authorization }, authenticated: false } as unknown as Request;
	const res = {
		set: (name: string, value: string) => { if (name === 'WWW-Authenticate') result.challenge = value; return res; },
		sendStatus: (code: number) => { result.status = code; }
	} as unknown as Response;

	auth(password)(req, res, (() => { result.next = true; }) as NextFunction);

	return { ...result, authenticated: req.authenticated };
}

const basic = (password: string) => 'Basic ' + Buffer.from(`user:${password}`).toString('base64');

describe('Basic auth middleware', () => {
	test('lets the right password in, and marks the request', () => {
		assert.deepEqual(run('secret', basic('secret')), { next: true, status: null, challenge: null, authenticated: true });
	});

	test('refuses a wrong password, with a challenge', () => {
		const result = run('secret', basic('wrong'));

		assert.equal(result.next, false);
		assert.equal(result.status, 401);
		assert.match(result.challenge!, /^Basic realm=/);
		assert.equal(result.authenticated, false);
	});

	test('refuses a password that starts like the right one, or is longer, or is empty, or only differs by trailing zero bytes', () => {
		for (const attempt of ['secre', 'secret!', 'secretsecret', '', 'SECRET', 'secret\0', 'secret\0\0']) {
			assert.equal(run('secret', basic(attempt)).status, 401, attempt);
		}
	});

	test('refuses a request with no credentials, or ones that are not Basic', () => {
		assert.equal(run('secret').status, 401);
		assert.equal(run('secret', 'Bearer secret').status, 401);
		assert.equal(run('secret', 'Basic !!!').status, 401);
	});

	test('the user name does not matter', () => {
		assert.equal(run('secret', 'Basic ' + Buffer.from(':secret').toString('base64')).next, true);
	});
});
