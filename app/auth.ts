import type { NextFunction, Request, Response } from "express";
import basicAuth from "basic-auth";

export = (pass: string) => (req: Request, res: Response, next: NextFunction) => {
	const cred = basicAuth(req);

	if (cred && cred.pass === pass) {
		req.authenticated = true;
		return next();
	}

	res.set('WWW-Authenticate', `Basic realm="Private Area"`)
		.sendStatus(401);
};
