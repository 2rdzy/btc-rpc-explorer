// CSRF protection. Each session gets one token (kept in the session), and requests that can change
// things must send it back, as the "_csrf" field of the body or query, or in one of the usual headers.

import type { Request } from "express";
import { csrfSync } from "csrf-sync";

// the token sent with the request; only a string can be one (a repeated parameter gives an array)
const getTokenFromRequest = (req: Request): string | undefined => {
	const token = (req.body && req.body._csrf)
		|| (req.query && req.query._csrf)
		|| req.headers["csrf-token"]
		|| req.headers["xsrf-token"]
		|| req.headers["x-csrf-token"]
		|| req.headers["x-xsrf-token"];

	return typeof token === "string" ? token : undefined;
};

// the usual protection: GET, HEAD and OPTIONS requests are not checked
const standard = csrfSync({ getTokenFromRequest });

// for the few GET requests that do something (such as running an RPC command): check every method
const strict = csrfSync({ getTokenFromRequest, ignoredMethods: [] });

export const csrfProtection = standard.csrfSynchronisedProtection;
export const forceCsrf = strict.csrfSynchronisedProtection;
export const generateToken = standard.generateToken;
