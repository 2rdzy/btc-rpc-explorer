"use strict";

const basicAuth = require('basic-auth');

/** @param {string} pass */
module.exports = pass => (/** @type {import("express").Request} */ req, /** @type {import("express").Response} */ res, /** @type {import("express").NextFunction} */ next) => {
	var cred = basicAuth(req);

	if (cred && cred.pass === pass) {
		req.authenticated = true;
		return next();
	}

	res.set('WWW-Authenticate', `Basic realm="Private Area"`)
		.sendStatus(401);
}
