import fs from "fs";
import debug from "debug";
import axios from "axios";
import qrcode from "qrcode";
import config from "../config.js";
import coins from "../coins.js";
import * as redisCache from "../redisCache.js";
import { logError } from "./errors.js";

const debugLog = debug("btcexp:utils");

// Gets the exchange rates (and the gold price) from the coin's data sources, into global.exchangeRates and
// global.goldExchangeRates. A failure is logged and leaves the earlier rates in place.
export async function refreshExchangeRates(): Promise<void> {
	if (!config.queryExchangeRates) {
		return;
	}

	if (coins[config.coin].exchangeRateData) {
		try {
			const response = await axios.get(coins[config.coin].exchangeRateData.jsonUrl);

			const exchangeRates = coins[config.coin].exchangeRateData.responseBodySelectorFunction(response.data);
			if (exchangeRates != null) {
				global.exchangeRates = exchangeRates;
				global.exchangeRatesUpdateTime = new Date();

				debugLog("Using exchange rates: " + JSON.stringify(global.exchangeRates) + " starting at " + global.exchangeRatesUpdateTime);

			} else {
				debugLog("Unable to get exchange rate data");
			}
		} catch (err) {
			logError("39r7h2390fgewfgds", err);
		}
	}

	if (coins[config.coin].goldExchangeRateData) {
		if (process.env.NODE_ENV == "local") {
			global.goldExchangeRates = {usd: 1731.2};
			global.goldExchangeRatesUpdateTime = new Date();

			debugLog("Using DEBUG gold exchange rates: " + JSON.stringify(global.goldExchangeRates) + " starting at " + global.goldExchangeRatesUpdateTime);

		} else {
			try {
				const response = await axios.get(coins[config.coin].goldExchangeRateData.jsonUrl);

				const exchangeRates = coins[config.coin].goldExchangeRateData.responseBodySelectorFunction(response.data);
				if (exchangeRates != null) {
					global.goldExchangeRates = exchangeRates;
					global.goldExchangeRatesUpdateTime = new Date();

					debugLog("Using gold exchange rates: " + JSON.stringify(global.goldExchangeRates) + " starting at " + global.goldExchangeRatesUpdateTime);

				} else {
					debugLog("Unable to get gold exchange rate data");
				}
			} catch (err) {
				logError("34082yt78yewewe", err);
			}
		}
	}
}

// IP address lookups are cached in memory, in a file (saved once a minute when something is new) and in Redis
// when it is configured.
let ipMemoryCache: Record<string, unknown> = {};

let ipRedisCache: ReturnType<typeof redisCache.createCache> | null = null;
if (redisCache.active) {
	const onRedisCacheEvent = function(_cacheType: string, eventType: string) {
		global.cacheStats.redis[eventType]++;
	};

	ipRedisCache = redisCache.createCache("v0", onRedisCacheEvent);
}

let ipMemoryCacheNewItems = false;
const ipCacheFile = `${config.filesystemCacheDir}/ip-address-cache.json`;

if (fs.existsSync(ipCacheFile)) {
	try {
		const rawData = fs.readFileSync(ipCacheFile);

		ipMemoryCache = JSON.parse(rawData.toString());

		debugLog(`Loaded ip address cache (${rawData.length.toLocaleString()} bytes)`);

	} catch {
		// failed to read cache file, delete it in case it's corrupted
		fs.unlinkSync(ipCacheFile);
	}
}

// unref'd so that this timer alone does not keep a process alive (it matters for tests and scripts)
setInterval(() => {
	if (ipMemoryCacheNewItems) {
		try {
			if (!fs.existsSync(config.filesystemCacheDir)){
				fs.mkdirSync(config.filesystemCacheDir);
			}

			debugLog(`Saved updated ip address cache`);

			fs.writeFileSync(ipCacheFile, JSON.stringify(ipMemoryCache, null, 4));

		} catch (e) {
			logError("24308tew7hgde", e);
		}

		ipMemoryCacheNewItems = false;
	}
}, 60000).unref();

const ipCache = {
	get: function(key: string): Promise<{ key: string, value: unknown }> {
		return new Promise(function(resolve) {
			if (ipMemoryCache[key] != null) {
				resolve({key:key, value:ipMemoryCache[key]});

				return;
			}

			if (ipRedisCache != null) {
				ipRedisCache.get("ip-" + key).then(function(redisResult) {
					if (redisResult != null) {
						resolve({key:key, value:redisResult});

						return;
					}

					resolve({key:key, value:null});
				});

			} else {
				resolve({key:key, value:null});
			}
		});
	},
	set: function(key: string, value: unknown, expirationMillis: number) {
		ipMemoryCache[key] = value;

		ipMemoryCacheNewItems = true;

		if (ipRedisCache != null) {
			ipRedisCache.set("ip-" + key, value, expirationMillis);
		}
	}
};

// The location details of IPv4 addresses (not Tor or local ones), from ipstack.com. Resolves to {} when privacy mode is
// on or there is no API key. An address that fails to look up is logged and left out.
export interface IpLocations { ips?: string[], detailsByIp?: Record<string, unknown> }

export function geoLocateIpAddresses(ipAddresses: string[]): Promise<IpLocations> {
	return new Promise(function(resolve, reject) {
		if (config.privacyMode || config.credentials.ipStackComApiAccessKey === undefined) {
			resolve({});

			return;
		}

		const ipDetails: { ips: string[], detailsByIp: Record<string, unknown> } = {ips:ipAddresses, detailsByIp:{}};

		const promises: Promise<void>[] = [];
		for (let i = 0; i < ipAddresses.length; i++) {
			const ipStr = ipAddresses[i];

			if (ipStr.endsWith(".onion")) {
				// tor, no location possible
				continue;
			}

			if (ipStr == "127.0.0.1") {
				// skip
				continue;
			}

			if (!ipStr.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)) {
				// non-IPv4, skip it
				continue;
			}

			promises.push(new Promise(function(resolve2) {
				ipCache.get(ipStr).then(async function(result) {
					if (result.value == null) {
						const apiUrl = "http://api.ipstack.com/" + result.key + "?access_key=" + config.credentials.ipStackComApiAccessKey;

						try {
							const response = await axios.get(apiUrl);

							const ip = response.data.ip;

							ipDetails.detailsByIp[ip] = response.data;

							if (response.data.latitude && response.data.longitude) {
								debugLog(`Successful IP-geo-lookup: ${ip} -> (${response.data.latitude}, ${response.data.longitude})`);

							} else {
								debugLog(`Unknown location for IP-geo-lookup: ${ip}`);
							}

							ipCache.set(ip, response.data, 1000 * 60 * 60 * 24 * 365);

							resolve2();

						} catch (err) {
							debugLog("Failed IP-geo-lookup: " + result.key);

							logError("39724gdge33a", err, {ip: result.key});

							// we failed to get what we wanted, but there's no meaningful recourse,
							// so we log the failure and continue without objection
							resolve2();
						}

					} else {
						ipDetails.detailsByIp[result.key] = result.value;

						resolve2();
					}
				});
			}));
		}

		Promise.all(promises).then(function() {
			resolve(ipDetails);

		}).catch(function(err) {
			logError("80342hrf78wgehdf07gds", err);

			reject(err);
		});
	});
}

function buildQrCodeUrl(str: string, results: Record<string, string>): Promise<void> {
	return new Promise(function(resolve, reject) {
		qrcode.toDataURL(str, function(err, url) {
			if (err) {
				logError("2q3ur8fhudshfs", err, {qrString: str});

				reject(err);

				return;
			}

			results[str] = url;

			resolve();
		});
	});
}

// The QR code of each string, as a data URL, keyed by the string.
export function buildQrCodeUrls(strings: string[]): Promise<Record<string, string>> {
	return new Promise(function(resolve, reject) {
		const promises: Promise<void>[] = [];
		const qrcodeUrls: Record<string, string> = {};

		for (let i = 0; i < strings.length; i++) {
			promises.push(buildQrCodeUrl(strings[i], qrcodeUrls));
		}

		Promise.all(promises).then(function() {
			resolve(qrcodeUrls);

		}).catch(function(err) {
			reject(err);
		});
	});
}
