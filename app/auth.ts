import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import basicAuth from "basic-auth";

// compares the digests, which are always the same length, so neither the time nor the length gives anything away
const sameSecret = (a: string, b: string): boolean =>
	crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());

export = (pass: string) => (req: Request, res: Response, next: NextFunction) => {
	const cred = basicAuth(req);

	if (cred && sameSecret(cred.pass, pass)) {
		req.authenticated = true;
		return next();
	}

	res.set('WWW-Authenticate', `Basic realm="Private Area"`)
		.sendStatus(401);
};
