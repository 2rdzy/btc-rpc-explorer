import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import basicAuth from "basic-auth";

// compares in constant time: both are padded to the same length, and the lengths are compared after, so the time does
// not depend on how much of the password was right
const sameSecret = (given: string, expected: string): boolean => {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	const length = Math.max(a.length, b.length, 1);
	const paddedA = Buffer.alloc(length);
	const paddedB = Buffer.alloc(length);

	a.copy(paddedA);
	b.copy(paddedB);

	return crypto.timingSafeEqual(paddedA, paddedB) && a.length === b.length;
};

export = (pass: string) => (req: Request, res: Response, next: NextFunction) => {
	const cred = basicAuth(req);

	if (cred && sameSecret(cred.pass, pass)) {
		req.authenticated = true;
		return next();
	}

	res.set('WWW-Authenticate', `Basic realm="Private Area"`)
		.sendStatus(401);
};
