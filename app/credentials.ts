import os from "os";
import path from "path";
import url from "url";
import fs from "fs";

import debug from "debug";
const debugLog = debug("btcexp:config");

// the URI that can hold all the connection details (BTCEXP_BITCOIND_URI); an empty one when it is not set
const btcUri: Pick<url.UrlWithParsedQuery, "query"> & Partial<url.UrlWithParsedQuery> =
	process.env.BTCEXP_BITCOIND_URI ? url.parse(process.env.BTCEXP_BITCOIND_URI, true) : { query: {} };
const btcAuth = btcUri.auth ? btcUri.auth.split(':') : [];

// a query parameter of that URI is a string, unless it was given more than once
const queryValue = (name: string): string | undefined => {
	const value = btcUri.query[name];

	return typeof value === "string" ? value : undefined;
};




export function loadFreshRpcCredentials() {
	let username = btcAuth[0] || process.env.BTCEXP_BITCOIND_USER;
	let password = btcAuth[1] || process.env.BTCEXP_BITCOIND_PASS;

	const authCookieFilepath = queryValue("cookie") || process.env.BTCEXP_BITCOIND_COOKIE || path.join(os.homedir(), '.bitcoin', '.cookie');

	let authType = "usernamePassword";

	if (!username && !password && fs.existsSync(authCookieFilepath)) {
		authType = "cookie";
	}

	if (authType == "cookie") {
		debugLog(`Loading RPC cookie file: ${authCookieFilepath}`);
		
		[ username, password ] = fs.readFileSync(authCookieFilepath).toString().trim().split(':', 2);
		
		if (!password) {
			throw new Error(`Cookie file ${authCookieFilepath} in unexpected format`);
		}
	}

	return {
		host: btcUri.hostname || process.env.BTCEXP_BITCOIND_HOST || "127.0.0.1",
		port: btcUri.port || process.env.BTCEXP_BITCOIND_PORT || 8332,

		authType: authType,

		username: username,
		password: password,
		
		authCookieFilepath: authCookieFilepath,
		
		timeout: parseInt(String(queryValue("timeout") || process.env.BTCEXP_BITCOIND_RPC_TIMEOUT || 5000)),
	};
}

export const rpc = loadFreshRpcCredentials();

// optional: enter your api access key from ipstack.com below
// to include a map of the estimated locations of your node's
// peers
// format: "ID_FROM_IPSTACK"
export const ipStackComApiAccessKey = process.env.BTCEXP_IPSTACK_APIKEY;

// optional: enter your api access key from mapbox.com below
// to enable the tiles for map of the estimated locations of
// your node's peers
// format: "APIKEY_FROM_MAPBOX"
export const mapBoxComApiAccessKey = process.env.BTCEXP_MAPBOX_APIKEY;

// optional: GA tracking code
// format: "UA-..."
export const googleAnalyticsTrackingId = process.env.BTCEXP_GANALYTICS_TRACKING;

// optional: sentry.io error-tracking url
// format: "SENTRY_IO_URL"
export const sentryUrl = process.env.BTCEXP_SENTRY_URL;
