//
// IMPORTANT MESSAGE!!!
//
// Dear contributor, please take great care when modifying this code.
// It was written defensively with attention to a lot of details in order to prevent security issues.
// As a result of such care it avoided a problem that occurred in RTL which had similar but subtly broken logic
// see https://github.com/Ride-The-Lightning/RTL/issues/610
//
// So before you change anything, please think twice about the consequences.

import crypto from "crypto";
import fs from "fs";
import type { NextFunction, Request, Response } from "express";
import utils from "./utils.js";

const authCookieName = "btcexp_auth";

function generateToken(): string {
	// Normally we would use 16 => 128 bits of entropy which is sufficiennt
	// But since we're going to base64 it and there would be padding (==),
	// It's a wasted space, why not use padding for some additional entropy? :)
	// The replacing is to make it URL-safe
	return crypto.randomBytes(18).toString("base64").replace(/\+/g, '-').replace(/\//g, '_')
}

function updateToken(tokenFile: string): string {
	// This implements atomic update of the token file to avoid corrupted tokens causing trouble
	// If first saves the token into a temporary file and then moves it over. The move is atomic.
	// The token could also be synced but since the next boot overwrites it anyway, disk corruption
	// is not an issue.
	const newToken = generateToken();
	const tmpFileName = tokenFile + ".tmp";
	// It is important that we use the generated token, and NOT read back what was written.
	// This avoids using predictable token if filesystem gets corrupted (e.g. in case of ENOSPC).
	fs.writeFileSync(tmpFileName, newToken);
	fs.renameSync(tmpFileName, tokenFile);
	
	return newToken;
}

export = (tokenFile: string, loginRedirect?: string | null) => {
	// Reinitializing the token at start is important due to same reason we don't read it back.
	// It also avoids races when another process binds the same port and reads the token in order to later use
	// it to attack this app.
	let token = updateToken(tokenFile);
	const cookies = new Set<string>();

	return (req: Request, res: Response, next: NextFunction) => {
		if (req.cookies && cookies.has(req.cookies[authCookieName])) {
			req.authenticated = true;

			return next();
		}

		
		let matchingToken = false;
		const queryToken = req.query.token;

		// only a string can be the token (a repeated ?token= parameter gives an array, ?token[a]= an object)
		if (typeof queryToken === "string" && queryToken) {
			try {
				// We use timingSafeEqual to avoid timing attacks
				matchingToken = crypto.timingSafeEqual(Buffer.from(queryToken, "utf8"), Buffer.from(token, "utf8"));

			} catch (e) {
				utils.logError("23rheuweesaa", e);
			}
		}

		if (matchingToken) {
			req.authenticated = true;
			token = updateToken(tokenFile);
			const cookie = generateToken();
			cookies.add(cookie);
			res.cookie(authCookieName, cookie);

			return next();
		}

		if (loginRedirect) {
			res.redirect(loginRedirect);

		} else {
			res.sendStatus(401);
		}
	};
}
