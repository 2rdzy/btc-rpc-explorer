"use strict";

// Rate limit failed logins, so that a Basic auth password or an SSO token cannot be guessed at full speed.
//
// The general rate limiter runs after authentication (and after static files), so it never sees a request
// that was refused. This one runs before authentication and only counts the refused requests: a 401, or
// the redirect to the SSO login page. Requests that log in are not counted, so a user is not slowed down,
// and once an IP address has failed too often it gets a 429, even for the right password, until the
// window ends.

const { rateLimit } = require("express-rate-limit");

/**
 * Whether the response refused a login: a 401, or a redirect to the configured SSO login page.
 * @param {import("express").Response} res
 * @param {string | null | undefined} loginRedirect
 */
function isFailedLogin(res, loginRedirect) {
	if (res.statusCode === 401) {
		return true;
	}

	return !!loginRedirect && res.statusCode >= 300 && res.statusCode < 400 && res.getHeader("location") === loginRedirect;
}

/**
 * @param {{windowMs: number, maxFailures: number, loginRedirect?: string | null}} options
 */
function createLoginRateLimiter({ windowMs, maxFailures, loginRedirect }) {
	return rateLimit({
		windowMs: windowMs,
		limit: maxFailures,
		standardHeaders: "draft-7",
		legacyHeaders: false,
		skipSuccessfulRequests: true,
		requestWasSuccessful: (req, res) => !isFailedLogin(res, loginRedirect),
		handler: (req, res) => {
			res.status(429).json({
				message: "Too many failed login attempts, please try again later."
			});
		}
	});
}

module.exports = {
	createLoginRateLimiter: createLoginRateLimiter,
	isFailedLogin: isFailedLogin
};
