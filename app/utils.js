"use strict";

const fs = require("fs");

const debug = require("debug");
const debugLog = debug("btcexp:utils");

const { Decimal } = require("decimal.js");
const axios = require("axios").default;
const qrcode = require("qrcode");
const bs58check = require("bs58check");
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const moment = require("moment");
const { bech32, bech32m } = require("bech32");

// You must wrap a tiny-secp256k1 compatible implementation
const bip32 = BIP32Factory(ecc);

const bitcoinjs = require('bitcoinjs-lib');




const config = require("./config.js");
const coins = require("./coins.js");
const coinConfig = coins[config.coin];
const redisCache = require("./redisCache.js");
const statTracker = require("./statTracker.js");
const { formatHex, getRandomString, addThousandsSeparators, ellipsize, ellipsizeMiddle, parseExponentStringDouble, summarizeDuration } = require("./helpers/text.js");
const { splitArrayIntoChunks, splitArrayIntoChunksByChunkCount, objectProperties, objHasProperty, stringifySimple, obfuscateProperties, sleep } = require("./helpers/collections.js");
const { seededRandom, seededRandomIntBetween, randomInt } = require("./helpers/random.js");
const { rgbToHsl, colorHexToRgb, colorHexToHsl } = require("./helpers/color.js");
const { parseNodeVersion, getDifficulty, isBlake2bDifficulty } = require("./helpers/node.js");
const { logError } = require("./helpers/errors.js");
const { formatLargeNumber, formatLargeNumberSignificant, formatCurrencyAmountWithForcedDecimalPlaces, formatCurrencyAmount, formatCurrencyAmountInSmallestUnits, satoshisPerUnitOfLocalCurrency, getExchangedCurrencyFormatData, formatExchangedCurrency } = require("./helpers/currency.js");
const { outputTypeAbbreviation, outputTypeName, asHash, asHashOrHeight, asAddress } = require("./helpers/outputTypes.js");



const crawlerBotUserAgentStrings = {
	"google": new RegExp("adsbot-google|Googlebot|mediapartners-google", "i"),
	"microsoft": new RegExp("Bingbot|bingpreview|msnbot", "i"),
	"yahoo": new RegExp("Slurp", "i"),
	"duckduckgo": new RegExp("DuckDuckBot", "i"),
	"baidu": new RegExp("Baidu", "i"),
	"yandex": new RegExp("YandexBot", "i"),
	"teoma": new RegExp("teoma", "i"),
	"sogou": new RegExp("Sogou", "i"),
	"exabot": new RegExp("Exabot", "i"),
	"facebook": new RegExp("facebot", "i"),
	"alexa": new RegExp("ia_archiver", "i"),
	"aol": new RegExp("aolbuild", "i"),
	"moz": new RegExp("dotbot", "i"),
	"semrush": new RegExp("SemrushBot", "i"),
	"majestic": new RegExp("MJ12bot", "i"),
	"python-requests": new RegExp("python-requests", "i"),
	"openai": new RegExp("OAI-SearchBot", "i"),
	"unidentifiedCrawler": new RegExp("Test Certificate Info", "i"),
	"amazon": new RegExp("amazonbot", "i"),
	"bytedance": new RegExp("bytespider", "i"),
	"scrapy": new RegExp("Scrapy", "i"),
};

let ipMemoryCache = {};

let ipRedisCache = null;
if (redisCache.active) {
	const onRedisCacheEvent = function(cacheType, eventType, cacheKey) {
		global.cacheStats.redis[eventType]++;
		//debugLog(`cache.${cacheType}.${eventType}: ${cacheKey}`);
	}

	ipRedisCache = redisCache.createCache("v0", onRedisCacheEvent);
}

let ipMemoryCacheNewItems = false;
const ipCacheFile = `${config.filesystemCacheDir}/ip-address-cache.json`;

if (fs.existsSync(ipCacheFile)) {
	try {
		let rawData = fs.readFileSync(ipCacheFile);

		ipMemoryCache = JSON.parse(rawData.toString());

		debugLog(`Loaded ip address cache (${rawData.length.toLocaleString()} bytes)`);

	} catch (err) {
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
	get:function(key) {
		return new Promise(function(resolve, reject) {
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
	set:function(key, value, expirationMillis) {
		ipMemoryCache[key] = value;

		ipMemoryCacheNewItems = true;

		if (ipRedisCache != null) {
			ipRedisCache.set("ip-" + key, value, expirationMillis);
		}
	}
};



function redirectToConnectPageIfNeeded(req, res) {
	if (!req.session.host) {
		req.session.redirectUrl = req.originalUrl;
		
		res.redirect("/");
		res.end();
		
		return true;
	}
	
	return false;
}




















function logMemoryUsage() {
	let mbUsed = process.memoryUsage().heapUsed / 1024 / 1024;
	mbUsed = Math.round(mbUsed * 100) / 100;

	let mbTotal = process.memoryUsage().heapTotal / 1024 / 1024;
	mbTotal = Math.round(mbTotal * 100) / 100;

	//debugLog("memoryUsage: heapUsed=" + mbUsed + ", heapTotal=" + mbTotal + ", ratio=" + parseInt(mbUsed / mbTotal * 100));
}

function identifyMiner(coinbaseTx, blockHeight) {
	if (coinbaseTx == null || coinbaseTx.vin == null || coinbaseTx.vin.length == 0) {
		return null;
	}
	
	if (global.miningPoolsConfigs) {
		for (let i = 0; i < global.miningPoolsConfigs.length; i++) {
			let miningPoolsConfig = global.miningPoolsConfigs[i];

			for (let payoutAddress in miningPoolsConfig.payout_addresses) {
				if (miningPoolsConfig.payout_addresses.hasOwnProperty(payoutAddress)) {
					if (coinbaseTx.vout && coinbaseTx.vout.length > 0) {
						if (getVoutAddresses(coinbaseTx.vout[0]).includes(payoutAddress)) {
							let minerInfo = miningPoolsConfig.payout_addresses[payoutAddress];
							minerInfo.identifiedBy = "payout address " + payoutAddress;

							return minerInfo;
						}
					}
				}
			}

			for (let coinbaseTag in miningPoolsConfig.coinbase_tags) {
				if (miningPoolsConfig.coinbase_tags.hasOwnProperty(coinbaseTag)) {
					if (formatHex(coinbaseTx.vin[0].coinbase, "utf8").indexOf(coinbaseTag) != -1) {
						let minerInfo = miningPoolsConfig.coinbase_tags[coinbaseTag];
						minerInfo.identifiedBy = "coinbase tag '" + coinbaseTag + "'";

						return minerInfo;
					}
				}
			}

			for (let blockHash in miningPoolsConfig.block_hashes) {
				if (blockHash == coinbaseTx.blockhash) {
					let minerInfo = miningPoolsConfig.block_hashes[blockHash];
					minerInfo.identifiedBy = "known block hash '" + blockHash + "'";

					return minerInfo;
				}
			}

			if (global.activeBlockchain == "main" && miningPoolsConfig.block_heights) {
				for (let minerName in miningPoolsConfig.block_heights) {
					let minerInfo = miningPoolsConfig.block_heights[minerName];
					minerInfo.name = minerName;

					if (minerInfo.heights.includes(blockHeight)) {
						minerInfo.identifiedBy = "known block height #" + blockHeight;

						return minerInfo;
					}
				}
			}
		}
	}

	if (coinbaseTx.vout && coinbaseTx.vout.length > 0) {
		for (let i = 0; i < coinbaseTx.vout.length; i++) {
			const vout = coinbaseTx.vout[i];

			const voutValue = new Decimal(vout.value);
			if (voutValue.gt(0)) {
				const address = getVoutAddress(vout);

				if (address) {
					return {
						name: address,
						type: "address-only",
						identifiedBy: "payout address " + address,
					};
				}
			}
		}
	}

	return null;
}

function getTxTotalInputOutputValues(tx, txInputs, blockHeight) {
	let totalInputValue = new Decimal(0);
	let totalOutputValue = new Decimal(0);

	try {
		if (txInputs) {
			for (let i = 0; i < tx.vin.length; i++) {
				if (tx.vin[i].coinbase) {
					totalInputValue = totalInputValue.plus(new Decimal(coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain)));

				} else {
					let txInput = txInputs[i];

					if (txInput) {
						try {
							let vout = txInput;

							if (vout.value) {
								totalInputValue = totalInputValue.plus(new Decimal(vout.value));
							}
						} catch (err) {
							logError("2397gs0gsse", err, {txid:tx.txid, vinIndex:i});
						}
					}
				}
			}
		} else {
			totalInputValue = null
		}

		for (let i = 0; i < tx.vout.length; i++) {
			totalOutputValue = totalOutputValue.plus(new Decimal(tx.vout[i].value));
		}
	} catch (err) {
		logError("2308sh0sg44", err, {tx:tx, txInputs:txInputs, blockHeight:blockHeight});
	}

	return {input:totalInputValue, output:totalOutputValue};
}

function getBlockTotalFeesFromCoinbaseTxAndBlockHeight(coinbaseTx, blockHeight) {
	if (coinbaseTx == null) {
		return 0;
	}

	let blockReward = coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

	let totalOutput = new Decimal(0);
	for (let i = 0; i < coinbaseTx.vout.length; i++) {
		let outputValue = coinbaseTx.vout[i].value;
		if (outputValue > 0) {
			totalOutput = totalOutput.plus(new Decimal(outputValue));
		}
	}

	if (blockReward < 1e-8 || blockReward == null) {
		return totalOutput;
		
	} else {
		return totalOutput.minus(new Decimal(blockReward));
	}
}

function estimatedSupply(height) {
	const checkpoint = coinConfig.utxoSetCheckpointsByNetwork[global.activeBlockchain];

	let checkpointHeight = 0;
	let checkpointSupply = new Decimal(50);

	if (checkpoint && checkpoint.height <= height) {
		//console.log("using checkpoint");
		checkpointHeight = checkpoint.height;
		checkpointSupply = new Decimal(checkpoint.total_amount);
	}

	let halvingBlockInterval = coinConfig.halvingBlockIntervalsByNetwork[global.activeBlockchain];

	let supply = checkpointSupply;

	let i = checkpointHeight;
	while (i < height) {
		let nextHalvingHeight = halvingBlockInterval * Math.floor(i / halvingBlockInterval) + halvingBlockInterval;
		
		if (height < nextHalvingHeight) {
			let heightDiff = height - i;

			//console.log(`adding(${heightDiff}): ` + new Decimal(heightDiff).times(coinConfig.blockRewardFunction(i, global.activeBlockchain)));
			return supply.plus(new Decimal(heightDiff).times(coinConfig.blockRewardFunction(i, global.activeBlockchain)));
		}

		let heightDiff = nextHalvingHeight - i;

		supply = supply.plus(new Decimal(heightDiff).times(coinConfig.blockRewardFunction(i, global.activeBlockchain)));
		
		i += heightDiff;
	}

	return supply;
}

async function refreshExchangeRates() {
	if (!config.queryExchangeRates) {
		return;
	}

	if (coins[config.coin].exchangeRateData) {
		try {
			const response = await axios.get(coins[config.coin].exchangeRateData.jsonUrl);

			let exchangeRates = coins[config.coin].exchangeRateData.responseBodySelectorFunction(response.data);
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

				let exchangeRates = coins[config.coin].goldExchangeRateData.responseBodySelectorFunction(response.data);
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

// Uses ipstack.com API
function geoLocateIpAddresses(ipAddresses, provider) {
	return new Promise(function(resolve, reject) {
		if (config.privacyMode || config.credentials.ipStackComApiAccessKey === undefined) {
			resolve({});

			return;
		}

		let ipDetails = {ips:ipAddresses, detailsByIp:{}};

		let promises = [];
		for (let i = 0; i < ipAddresses.length; i++) {
			let ipStr = ipAddresses[i];

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
			
			promises.push(new Promise(function(resolve2, reject2) {
				ipCache.get(ipStr).then(async function(result) {
					if (result.value == null) {
						let apiUrl = "http://api.ipstack.com/" + result.key + "?access_key=" + config.credentials.ipStackComApiAccessKey;
						
						try {
							const response = await axios.get(apiUrl);

							let ip = response.data.ip;

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

		Promise.all(promises).then(function(results) {
			resolve(ipDetails);

		}).catch(function(err) {
			logError("80342hrf78wgehdf07gds", err);

			reject(err);
		});
	});
}











// https://stackoverflow.com/a/31424853/673828
const reflectPromise = p => p.then(v => ({v, status: "resolved" }),
							e => ({e, status: "rejected" }));




function buildQrCodeUrls(strings) {
	return new Promise(function(resolve, reject) {
		let promises = [];
		let qrcodeUrls = {};

		for (let i = 0; i < strings.length; i++) {
			promises.push(new Promise(function(resolve2, reject2) {
				buildQrCodeUrl(strings[i], qrcodeUrls).then(function() {
					resolve2();

				}).catch(function(err) {
					reject2(err);
				});
			}));
		}

		Promise.all(promises).then(function(results) {
			resolve(qrcodeUrls);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function buildQrCodeUrl(str, results) {
	return new Promise(function(resolve, reject) {
		qrcode.toDataURL(str, function(err, url) {
			if (err) {
				logError("2q3ur8fhudshfs", err, str);

				reject(err);

				return;
			}

			results[str] = url;

			resolve();
		});
	});
}






const arrayFromHexString = hexString =>
	new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

const getCrawlerFromUserAgentString = userAgentString => {
	for (const [name, regex] of Object.entries(crawlerBotUserAgentStrings)) {
		if (regex.test(userAgentString)) {
			return name;
		}
	}

	return null;
};

const safePromise = async (uid, promise) => {
	try {
		const response = await promise();

		return response;

	} catch (e) {
		logError(uid, e);
	}
};

const timePromise = async (name, promise, perfResults=null) => {
	const startTime = startTimeNanos();

	try {
		const response = await promise();

		const responseTimeMillis = dtMillis(startTime);

		statTracker.trackPerformance(name, responseTimeMillis);

		if (perfResults) {
			perfResults[name] = Math.max(1, Math.trunc(responseTimeMillis));
		}

		return response;

	} catch (e) {
		const responseTimeMillis = dtMillis(startTime);

		statTracker.trackPerformance(`${name}_error`, responseTimeMillis);

		if (perfResults) {
			perfResults[`${name}_error`] = Math.max(1, Math.trunc(responseTimeMillis));
		}

		throw e;
	}
};

const timeFunction = (uid, f, perfResults=null) => {
	const startTime = startTimeNanos();

	f();

	const responseTimeMillis = dtMillis(startTime);

	statTracker.trackPerformance(uid, responseTimeMillis);

	if (perfResults) {
		perfResults[uid] = responseTimeMillis;
	}
};

const fileCache = (cacheDir, cacheName, cacheVersion=1) => {
	const filename = (version) => { return ((version > 1) ? [cacheName, `v${version}`].join("-") : cacheName) + ".json"; };
	const filepath = `${cacheDir}/${filename(cacheVersion)}`;

	if (cacheVersion > 1) {
		// remove old versions
		for (let i = 1; i < cacheVersion; i++) {
			if (fs.existsSync(`${cacheDir}/${filename(i)}`)) {
				fs.unlinkSync(`${cacheDir}/${filename(i)}`);
			}
		}
	}

	return {
		tryLoadJson: () => {
			if (fs.existsSync(filepath)) {
				let rawData = fs.readFileSync(filepath);

				try {
					return JSON.parse(rawData.toString());

				} catch (e) {
					logError("378y43edewe", e);

					fs.unlinkSync(filepath);

					return null;
				}
			}

			return null;
		},
		writeJson: (obj) => {
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir);
			}

			fs.writeFileSync(filepath, JSON.stringify(obj, null, 4));
		}
	};
};

const startTimeNanos = () => {
	return process.hrtime.bigint();
};

const dtMillis = (startTimeNanos) => {
	const dtNanos = process.hrtime.bigint() - startTimeNanos;

	return Number(dtNanos) * 1e-6;
};





function getVoutAddress(vout) {
	if (vout && vout.scriptPubKey) {
		if (vout.scriptPubKey.address) {
			return vout.scriptPubKey.address;

		} else if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.length > 0) {
			return vout.scriptPubKey.addresses[0];
		}
	}

	return null;
}

function getVoutAddresses(vout) {
	if (vout && vout.scriptPubKey) {
		if (vout.scriptPubKey.address) {
			return [vout.scriptPubKey.address];

		} else if (vout.scriptPubKey.addresses) {
			return vout.scriptPubKey.addresses;
		}
	}

	return [];
}

const xpubPrefixes = new Map([
	['xpub', '0488b21e'],
	['ypub', '049d7cb2'],
	['Ypub', '0295b43f'],
	['zpub', '04b24746'],
	['Zpub', '02aa7ed3'],
	['tpub', '043587cf'],
	['upub', '044a5262'],
	['Upub', '024289ef'],
	['vpub', '045f1cf6'],
	['Vpub', '02575483'],
]);

const bip32TestnetNetwork = {
	messagePrefix: '\x18Bitcoin Signed Message:\n',
	bech32: 'tb',
	bip32: {
		public: 0x043587cf,
		private: 0x04358394,
	},
	pubKeyHash: 0x6f,
	scriptHash: 0xc4,
	wif: 0xEF,
};

// ref: https://github.com/ExodusMovement/xpub-converter/blob/master/src/index.js
function xpubChangeVersionBytes(xpub, targetFormat) {
	if (!xpubPrefixes.has(targetFormat)) {
		throw new Error("Invalid target version");
	}

	// trim whitespace
	xpub = xpub.trim();

	let data = bs58check.default.decode(xpub);
	data = data.slice(4);
	data = Buffer.concat([Buffer.from(xpubPrefixes.get(targetFormat), 'hex'), data]);

	return bs58check.default.encode(data);
}

// HD wallet addresses
function bip32Addresses(extPubkey, addressType, account, limit=10, offset=0) {
	let network = null;
	if (!extPubkey.match(/^(xpub|ypub|zpub|Ypub|Zpub).*$/)) {
		network = bip32TestnetNetwork;
	}

	let bip32object = bip32.fromBase58(extPubkey, network);

	let addresses = [];
	for (let i = offset; i < (offset + limit); i++) {
		let bip32Child = bip32object.derive(account).derive(i);
		let publicKey = bip32Child.publicKey;

		if (addressType == "p2pkh") {
			addresses.push(bitcoinjs.payments.p2pkh({ pubkey: publicKey, network: network }).address);

		} else if (addressType == "p2sh(p2wpkh)") {
			addresses.push(bitcoinjs.payments.p2sh({ redeem: bitcoinjs.payments.p2wpkh({ pubkey: publicKey, network: network })}).address);

		} else if (addressType == "p2wpkh") {
			addresses.push(bitcoinjs.payments.p2wpkh({ pubkey: publicKey, network: network }).address);

		} else {
			throw new Error(`Unknown address type: "${addressType}" (should be one of ["p2pkh", "p2sh(p2wpkh)", "p2wpkh"])`)
		}
	}

	return addresses;
}

function expressRequestToJson(req) {
	return {
		method: req.method,
		url: req.url,
		headers: req.headers,
		query: req.query,
		params: req.params,
		body: req.body,
		cookies: req.cookies,
		signedCookies: req.signedCookies,
		ip: req.ip,
		ips: req.ips,
		protocol: req.protocol,
		secure: req.secure,
		originalUrl: req.originalUrl,
		hostname: req.hostname,
		baseUrl: req.baseUrl,
	};
}

function difficultyAdjustmentEstimates(eraStartBlockHeader, currentBlockHeader) {
	let difficultyPeriod = Math.trunc(Math.floor(currentBlockHeader.height / coinConfig.difficultyAdjustmentBlockCount));
	let blocksUntilDifficultyAdjustment = ((difficultyPeriod + 1) * coinConfig.difficultyAdjustmentBlockCount) - currentBlockHeader.height;

	let heightDiff = currentBlockHeader.height - eraStartBlockHeader.height;
	let blockCount = heightDiff + 1;
	let timeDiff = currentBlockHeader.mediantime - eraStartBlockHeader.mediantime;
	let timePerBlock = timeDiff / heightDiff;
	let timePerBlockDuration = moment.duration(timePerBlock * 1000);
	let daysUntilAdjustment = new Decimal(blocksUntilDifficultyAdjustment).times(timePerBlock).dividedBy(60 * 60 * 24);
	let hoursUntilAdjustment = new Decimal(blocksUntilDifficultyAdjustment).times(timePerBlock).dividedBy(60 * 60);
	let duaDP1 = daysUntilAdjustment.toDP(1);
	let daysUntilAdjustmentStr = daysUntilAdjustment.gt(1) ? `~${duaDP1} day${duaDP1.eq(1) ? "" : "s"}` : "< 1 day";
	let hoursUntilAdjustmentStr = hoursUntilAdjustment.gt(1) ? `~${hoursUntilAdjustment.toDP(0)} hr${hoursUntilAdjustment.toDP(1).eq(1) ? "" : "s"}` : "< 1 hr";
	let nowTime = new Date().getTime() / 1000;
	let dt = nowTime - eraStartBlockHeader.time;
	let timePerBlock2 = dt / heightDiff;
	let predictedBlockCount = dt / coinConfig.targetBlockTimeSeconds;

	let blockRatioPercent = new Decimal(blockCount / predictedBlockCount).times(100);
	if (blockRatioPercent.gt(400)) {
		blockRatioPercent = new Decimal(400);
	}
	if (blockRatioPercent.lt(25)) {
		blockRatioPercent = new Decimal(25);
	}


	let diffAdjPercent = blockRatioPercent.minus(new Decimal(100));
	let diffAdjText = `Blocks during the current difficulty epoch have taken this long, on average, to be mined. If this pace continues, then in ${blocksUntilDifficultyAdjustment.toLocaleString()} block${blocksUntilDifficultyAdjustment == 1 ? "" : "s"} (${daysUntilAdjustmentStr}) the difficulty will adjust upward: +${diffAdjPercent.toDP(1)}%`;
	let diffAdjSign = "+";
	let textColorClass = "text-success";

	if (predictedBlockCount > blockCount) {
		diffAdjPercent = new Decimal(100).minus(blockRatioPercent).times(-1);
		diffAdjText = `Blocks during the current difficulty epoch have taken this long, on average, to be mined. If this pace continues, then in ${blocksUntilDifficultyAdjustment.toLocaleString()} block${blocksUntilDifficultyAdjustment == 1 ? "" : "s"} (${daysUntilAdjustmentStr}) the difficulty will adjust downward: -${diffAdjPercent.toDP(1)}%`;
		diffAdjSign = "-";
		textColorClass = "text-danger";
	}

	return {
		estimateAvailable: blockCount > 30 && !diffAdjPercent.isNaN(),

		blockCount: blockCount,
		blocksLeft: blocksUntilDifficultyAdjustment,
		daysLeftStr: daysUntilAdjustmentStr,
		timeLeftStr: (daysUntilAdjustment.lt(1) ? hoursUntilAdjustmentStr : daysUntilAdjustmentStr),
		calculationBlockCount: heightDiff,
		currentEpoch: difficultyPeriod,

		delta: diffAdjPercent,
		sign: diffAdjSign,

		timePerBlock: timePerBlock,
		firstBlockTime: eraStartBlockHeader.time,
		nowTime: nowTime,
		dt: dt,
		predictedBlockCount: predictedBlockCount,

		//nameDesc: `Estimate for the difficulty adjustment that will occur in ${blocksUntilDifficultyAdjustment.toLocaleString()} block${blocksUntilDifficultyAdjustment == 1 ? "" : "s"} (${daysUntilAdjustmentStr}). This is calculated using the average block time over the last ${heightDiff} block(s). This estimate becomes more reliable as the difficulty epoch nears its end.`,
	};
}

function nextHalvingEstimates(eraStartBlockHeader, currentBlockHeader, difficultyAdjustmentDataArg=null) {
	let blockCount = currentBlockHeader.height;
	let halvingBlockInterval = coinConfig.halvingBlockIntervalsByNetwork[global.activeBlockchain];
	let halvingCount = Math.trunc(blockCount / halvingBlockInterval);
	let nextHalvingIndex = halvingCount + 1;
	let targetBlockTimeSeconds = coinConfig.targetBlockTimeSeconds;
	let nextHalvingBlock = (halvingBlockInterval * nextHalvingIndex);
	let blocksUntilNextHalving = nextHalvingBlock - blockCount;
	
	let terminalHalvingCount = coinConfig.terminalHalvingCountByNetwork[global.activeBlockchain];
	if (nextHalvingIndex > terminalHalvingCount) {
		halvingCount = terminalHalvingCount;
		nextHalvingIndex = -1;

		return {
			halvingCount: terminalHalvingCount,
			nextHalvingIndex: -1
		};
	}

	let difficultyAdjustmentData = difficultyAdjustmentDataArg;
	if (!difficultyAdjustmentData) {
		difficultyAdjustmentData = difficultyAdjustmentEstimates(eraStartBlockHeader, currentBlockHeader);
	}

	let blockCountAffectedByCurrentDifficultyDelta = Math.min(difficultyAdjustmentData.blocksLeft, blocksUntilNextHalving);
	let currDifficultyEraTimeDifferential = (coinConfig.targetBlockTimeSeconds - difficultyAdjustmentData.timePerBlock) * blockCountAffectedByCurrentDifficultyDelta;


	let secondsUntilNextHalving = blocksUntilNextHalving * targetBlockTimeSeconds - currDifficultyEraTimeDifferential;
	let daysUntilNextHalving = secondsUntilNextHalving / 60 / 60 / 24;
	let nextHalvingDate = new Date(new Date().getTime() + secondsUntilNextHalving * 1000);

	return {
		blockCount: blockCount,
		halvingBlockInterval: halvingBlockInterval,
		halvingCount: halvingCount,
		nextHalvingIndex: nextHalvingIndex,
		terminalHalvingCount: terminalHalvingCount,
		nextHalvingBlock: nextHalvingBlock,
		blocksUntilNextHalving: blocksUntilNextHalving,
		targetBlockTimeSeconds: targetBlockTimeSeconds,
		daysUntilNextHalving: daysUntilNextHalving,
		nextHalvingDate: nextHalvingDate,

		difficultyAdjustmentData: difficultyAdjustmentData
	};
}

function tryParseAddress(address) {
	let base58Error = null;
	let bech32Error = null;
	let bech32mError = null;

	/** @type {any} */
	let parsedAddress = null;

	let b58prefix = (global.activeBlockchain == "main" ? /^[13].*$/ : /^[2mn].*$/);
	if (address.match(b58prefix)) {
		try {
			parsedAddress = bitcoinjs.address.fromBase58Check(address);
			parsedAddress.hash = parsedAddress.hash.toString("hex");

			return {
				encoding: "base58",
				parsedAddress: parsedAddress
			};

		} catch (err) {
			base58Error = err;
		}
	}

	try {
		parsedAddress = bitcoinjs.address.fromBech32(address);
		parsedAddress.data = parsedAddress.data.toString("hex");

		return {
			encoding: "bech32",
			parsedAddress: parsedAddress
		};

	} catch (err) {
		bech32Error = err;
	}


	try {
		parsedAddress = bech32m.decode(address);
		parsedAddress.words = Buffer.from(parsedAddress.words).toString("hex");

		return {
			encoding: "bech32m",
			parsedAddress: parsedAddress
		};

	} catch (err) {
		bech32mError = err;
	}
	

	let returnVal = {errors:[]};

	if (base58Error) {
		returnVal.errors.push(base58Error);
	}

	if (bech32Error) {
		returnVal.errors.push(bech32Error);
	}

	if (bech32mError) {
		returnVal.errors.push(bech32mError);
	}

	return returnVal;
}



const awaitPromises = async (promises) => {
	const promiseResults = await Promise.allSettled(promises);

	promiseResults.forEach(x => {
		if (x.status == "rejected") {
			if (x.reason) {
				logError("awaitPromises_rejected", x.reason);
			}
		}
	});

	return promiseResults;
};


const perfLog = [];
let perfLogItemCount = 0;
const perfLogMaxItems = 100;
const perfLogNewItem = (tags) => {
	const newItem = tags;

	newItem.id = getRandomString(12, "aA#");
	newItem.date = new Date();
	newItem.results = {};
	newItem.index = perfLogItemCount;

	perfLogItemCount++;

	perfLog.splice(0, 0, newItem);

	while (perfLog.length > perfLogMaxItems) {
		perfLog.splice(perfLog.length - 1, 1);
	}

	return {
		perfId:newItem.id,
		perfResults:newItem.results
	};
};

function trackAppEvent(name, count=1, params=null) {
	if (!global.appEventStats[name]) {
		global.appEventStats[name] = {count:0};
	}

	global.appEventStats[name].count += count;
	global.appEventStats[name].last = new Date();

	if (params != null) {
		if (global.appEventStats[name].params == null) {
			global.appEventStats[name].params = {};
		}

		let props = objectProperties(params);

		props.forEach(prop => {
			if (global.appEventStats[name].params[`${prop}[${params[prop]}]`] == null) {
				global.appEventStats[name].params[`${prop}[${params[prop]}]`] = {count: 0};
			}

			global.appEventStats[name].params[`${prop}[${params[prop]}]`].count += count;
		});
	}
}

module.exports = {
	reflectPromise: reflectPromise,
	redirectToConnectPageIfNeeded: redirectToConnectPageIfNeeded,
	formatHex: formatHex,
	splitArrayIntoChunks: splitArrayIntoChunks,
	splitArrayIntoChunksByChunkCount: splitArrayIntoChunksByChunkCount,
	getRandomString: getRandomString,
	formatCurrencyAmount: formatCurrencyAmount,
	formatCurrencyAmountWithForcedDecimalPlaces: formatCurrencyAmountWithForcedDecimalPlaces,
	formatExchangedCurrency: formatExchangedCurrency,
	getExchangedCurrencyFormatData: getExchangedCurrencyFormatData,
	satoshisPerUnitOfLocalCurrency: satoshisPerUnitOfLocalCurrency,
	addThousandsSeparators: addThousandsSeparators,
	formatCurrencyAmountInSmallestUnits: formatCurrencyAmountInSmallestUnits,
	seededRandom: seededRandom,
	seededRandomIntBetween: seededRandomIntBetween,
	randomInt: randomInt,
	logMemoryUsage: logMemoryUsage,
	identifyMiner: identifyMiner,
	getBlockTotalFeesFromCoinbaseTxAndBlockHeight: getBlockTotalFeesFromCoinbaseTxAndBlockHeight,
	estimatedSupply: estimatedSupply,
	refreshExchangeRates: refreshExchangeRates,
	parseExponentStringDouble: parseExponentStringDouble,
	parseNodeVersion: parseNodeVersion,
	getDifficulty: getDifficulty,
	isBlake2bDifficulty: isBlake2bDifficulty,
	formatLargeNumber: formatLargeNumber,
	formatLargeNumberSignificant: formatLargeNumberSignificant,
	geoLocateIpAddresses: geoLocateIpAddresses,
	getTxTotalInputOutputValues: getTxTotalInputOutputValues,
	tryParseAddress: tryParseAddress,
	rgbToHsl: rgbToHsl,
	colorHexToRgb: colorHexToRgb,
	colorHexToHsl: colorHexToHsl,
	logError: logError,
	buildQrCodeUrls: buildQrCodeUrls,
	ellipsize: ellipsize,
	ellipsizeMiddle: ellipsizeMiddle,
	summarizeDuration: summarizeDuration,
	outputTypeAbbreviation: outputTypeAbbreviation,
	outputTypeName: outputTypeName,
	asHash: asHash,
	asHashOrHeight: asHashOrHeight,
	asAddress: asAddress,
	arrayFromHexString: arrayFromHexString,
	getCrawlerFromUserAgentString: getCrawlerFromUserAgentString,
	timePromise: timePromise,
	timeFunction: timeFunction,
	startTimeNanos: startTimeNanos,
	dtMillis: dtMillis,
	objectProperties: objectProperties,
	objHasProperty: objHasProperty,
	stringifySimple: stringifySimple,
	safePromise: safePromise,
	getVoutAddress: getVoutAddress,
	getVoutAddresses: getVoutAddresses,
	xpubChangeVersionBytes: xpubChangeVersionBytes,
	bip32Addresses: bip32Addresses,
	difficultyAdjustmentEstimates: difficultyAdjustmentEstimates,
	nextHalvingEstimates: nextHalvingEstimates,
	sleep: sleep,
	obfuscateProperties: obfuscateProperties,
	awaitPromises: awaitPromises,
	perfLogNewItem: perfLogNewItem,
	perfLog: perfLog,
	fileCache: fileCache,
	expressRequestToJson: expressRequestToJson,
	trackAppEvent: trackAppEvent
};
