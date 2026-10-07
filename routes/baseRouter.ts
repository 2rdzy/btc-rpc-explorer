import debug from "debug";
const debugLog = debug("btcexp:router");

import express from "express";
import { forceCsrf } from "../app/csrf.js";
const router = express.Router();
import qrcode from "qrcode";
import * as bitcoinjs from "bitcoinjs-lib";
import sha256 from "crypto-js/sha256";
import hexEnc from "crypto-js/enc-hex";
import { Decimal } from "decimal.js";
import semver from "semver";
import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt();
import asyncHandler from "express-async-handler";

import * as utils from "../app/utils.js";
import { NotFoundError } from "../app/helpers/errors.js";
import { isValidSetting, settingsFromCookie } from "../app/helpers/settings.js";
import { queryInt, queryString, queryStringList } from "../app/request.js";
import coins from "../app/coins.js";
import config from "../app/config.js";
import * as coreApi from "../app/api/coreApi.js";
import * as addressApi from "../app/api/addressApi.js";
import * as rpcApi from "../app/api/rpcApi.js";
import btcQuotes from "../app/coins/btcQuotes.js";
import type { RpcData } from "../app/api/rpcApi.js";
import type { AddressDetails } from "../app/api/addressDetails.js";

const noTxIndexMsg = "\n\nYour node does not have **txindex** enabled. Without it, you can only lookup wallet, mempool, and recently confirmed transactions by their **txid**. Searching for non-wallet transactions that were confirmed more than "+config.noTxIndexSearchDepth+" blocks ago is only possible if the confirmed block height is available.";

router.get("/", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"homepage"});
		res.locals.perfId = perfId;

		res.locals.homepage = true;
		
		// don't need timestamp on homepage "blocks-list", this flag disables
		res.locals.hideTimestampColumn = true;


		// variables used by blocks-list.pug
		res.locals.offset = 0;
		res.locals.sort = "desc";

		const feeConfTargets = [1, 6, 144, 1008];
		res.locals.feeConfTargets = feeConfTargets;


		const promises = [];

		promises.push(utils.timePromise("homepage.getMempoolInfo", async () => {
			res.locals.mempoolInfo = await coreApi.getMempoolInfo();
		}, perfResults));

		promises.push(utils.timePromise("homepage.getMiningInfo", async () => {
			res.locals.miningInfo = await coreApi.getMiningInfo();
		}, perfResults));

		promises.push(utils.timePromise("homepage.getSmartFeeEstimates", async () => {
			const rawSmartFeeEstimates = await coreApi.getSmartFeeEstimates("CONSERVATIVE", feeConfTargets);

			const smartFeeEstimates: Record<number, string | number> = {};

			for (let i = 0; i < feeConfTargets.length; i++) {
				const rawSmartFeeEstimate = rawSmartFeeEstimates[i];

				if (rawSmartFeeEstimate.errors) {
					smartFeeEstimates[feeConfTargets[i]] = "?";

				} else {
					smartFeeEstimates[feeConfTargets[i]] = new Decimal(rawSmartFeeEstimate.feerate).times(coinConfig.baseCurrencyUnit.multiplier).dividedBy(1000).trunc().toNumber();
				}
			}

			res.locals.smartFeeEstimates = smartFeeEstimates;
		}, perfResults));

		promises.push(utils.timePromise("homepage.getNetworkHashrate", async () => {
			res.locals.hashrate7d = await coreApi.getNetworkHashrate(1008);
		}, perfResults));

		promises.push(utils.timePromise("homepage.getNetworkHashrate", async () => {
			res.locals.hashrate30d = await coreApi.getNetworkHashrate(4320);
		}, perfResults));



		const getblockchaininfo = await utils.timePromise("homepage.getBlockchainInfo", async () => {
			return await coreApi.getBlockchainInfo();
		}, perfResults);


		res.locals.getblockchaininfo = getblockchaininfo;

		res.locals.difficultyPeriod = Math.trunc(Math.floor(getblockchaininfo.blocks / coinConfig.difficultyAdjustmentBlockCount));
			

		const blockHeights: number[] = [];
		if (getblockchaininfo.blocks) {
			// +1 to page size here so we have the next block to calculate T.T.M.
			for (let i = 0; i < (config.site.homepage.recentBlocksCount + 1); i++) {
				blockHeights.push(getblockchaininfo.blocks - i);
			}
		} else if (global.activeBlockchain == "regtest") {
			// hack: default regtest node returns getblockchaininfo.blocks=0, despite
			// having a genesis block; hack this to display the genesis block
			blockHeights.push(0);
		}

		promises.push(utils.timePromise("homepage.getBlocksStatsByHeight", async () => {
			const rawblockstats = await coreApi.getBlocksStatsByHeight(blockHeights);

			if (rawblockstats && rawblockstats.length > 0 && rawblockstats[0] != null) {
				res.locals.blockstatsByHeight = {};

				for (let i = 0; i < rawblockstats.length; i++) {
					const blockstats = rawblockstats[i];

					res.locals.blockstatsByHeight[blockstats.height] = blockstats;
				}
			}
		}, perfResults));

		promises.push(utils.timePromise("homepage.getBlockHeaderByHeight", async () => {
			const h = coinConfig.difficultyAdjustmentBlockCount * res.locals.difficultyPeriod;
			res.locals.difficultyPeriodFirstBlockHeader = await coreApi.getBlockHeaderByHeight(h);
		}, perfResults));

		promises.push(utils.timePromise("homepage.getBlocksByHeight", async () => {
			const latestBlocks = await coreApi.getBlocksByHeight(blockHeights);
			
			res.locals.latestBlocks = latestBlocks;
			res.locals.blocksUntilDifficultyAdjustment = ((res.locals.difficultyPeriod + 1) * coinConfig.difficultyAdjustmentBlockCount) - latestBlocks[0].height;
		}));

		
		const targetBlocksPerDay = 24 * 60 * 60 / global.coinConfig.targetBlockTimeSeconds;
		res.locals.targetBlocksPerDay = targetBlocksPerDay;

		// eslint-disable-next-line no-constant-condition, no-constant-binary-expression
		if (false && getblockchaininfo.chain !== 'regtest') {
			/*promises.push(new Promise(async (resolve, reject) => {
				res.locals.txStats = await utils.timePromise("homepage.getTxStats", coreApi.getTxStats(targetBlocksPerDay / 4, -targetBlocksPerDay, "latest"));
				
				resolve();
			}));*/

			const chainTxStatsIntervals = [ [targetBlocksPerDay, "24 hours"], [7 * targetBlocksPerDay, "7 days"], [30 * targetBlocksPerDay, "30 days"] ]
				.filter(dat => dat[0] <= getblockchaininfo.blocks);

			res.locals.chainTxStats = {};
			for (let i = 0; i < chainTxStatsIntervals.length; i++) {
				promises.push(utils.timePromise(`homepage.getChainTxStats.${chainTxStatsIntervals[i][0]}`, async () => {
					res.locals.chainTxStats[chainTxStatsIntervals[i][0]] = await coreApi.getChainTxStats(chainTxStatsIntervals[i][0]);
				}, perfResults));
			}

			chainTxStatsIntervals.push([-1, "All time"]);
			res.locals.chainTxStatsIntervals = chainTxStatsIntervals;

			promises.push(utils.timePromise("homepage.getChainTxStats.allTime", async () => {
				res.locals.chainTxStats[-1] = await coreApi.getChainTxStats(getblockchaininfo.blocks - 1);
			}, perfResults));
		}

		/*promises.push(utils.timePromise("homepage.getblocktemplate", async () => {
			let nextBlockEstimate = await utils.timePromise("homepage.getNextBlockEstimate", async () => {
				return await coreApi.getNextBlockEstimate();
			}, perfResults);


			res.locals.nextBlockTemplate = nextBlockEstimate.blockTemplate;
			res.locals.nextBlockFeeRateGroups = nextBlockEstimate.feeRateGroups;

			res.locals.nextBlockMinFeeRate = nextBlockEstimate.minFeeRate;
			res.locals.nextBlockMaxFeeRate = nextBlockEstimate.maxFeeRate;
			res.locals.nextBlockMinFeeTxid = nextBlockEstimate.minFeeTxid;
			res.locals.nextBlockMaxFeeTxid = nextBlockEstimate.maxFeeTxid;

			res.locals.nextBlockTotalFees = nextBlockEstimate.totalFees;
		
		}, perfResults));*/


		await utils.awaitPromises(promises);



		const eraStartBlockHeader = res.locals.difficultyPeriodFirstBlockHeader;
		const currentBlock = res.locals.latestBlocks[0];

		res.locals.difficultyAdjustmentData = utils.difficultyAdjustmentEstimates(eraStartBlockHeader, currentBlock);

		res.locals.nextHalvingData = utils.nextHalvingEstimates(
			res.locals.difficultyPeriodFirstBlockHeader,
			res.locals.latestBlocks[0],
			res.locals.difficultyAdjustmentData);



		res.locals.perfResults = perfResults;


		await utils.timePromise("homepage.render", async () => {
			res.render("index");
		}, perfResults);

		next();

	} catch (err) {
		utils.logError("238023hw87gddd", err);
					
		res.locals.userMessage = "Error building page: " + err;

		await utils.timePromise("homepage.render", async () => {
			res.render("index");
		});

		next();
	}
}));

router.get("/node-details", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"node-details"});
		res.locals.perfId = perfId;

		const promises = [];

		promises.push(utils.timePromise("node-details.getBlockchainInfo", async () => {
			res.locals.getblockchaininfo = await coreApi.getBlockchainInfo();
		}, perfResults));

		promises.push(utils.timePromise("node-details.getDeploymentInfo", async () => {
			res.locals.getdeploymentinfo = await coreApi.getDeploymentInfo();
		}, perfResults));

		promises.push(utils.timePromise("node-details.getNetworkInfo", async () => {
			res.locals.getnetworkinfo = await coreApi.getNetworkInfo();
		}, perfResults));

		promises.push(utils.timePromise("node-details.getUptimeSeconds", async () => {
			res.locals.uptimeSeconds = await coreApi.getUptimeSeconds();
		}, perfResults));

		promises.push(utils.timePromise("node-details.getNetTotals", async () => {
			res.locals.getnettotals = await coreApi.getNetTotals();
		}, perfResults));


		await utils.awaitPromises(promises);


		res.locals.perfResults = perfResults;

		await utils.timePromise("node-details.render", async () => {
			res.render("node-details");
		}, perfResults);
		
		next();

	} catch (err) {
		utils.logError("32978efegdde", err);
					
		res.locals.userMessage = "Error building page: " + err;

		await utils.timePromise("node-details.render", async () => {
			res.render("node-details");
		});

		next();
	}
}));

router.get("/mempool-summary", asyncHandler(async (req, res, next) => {
	try {
		res.locals.satoshiPerByteBucketMaxima = coinConfig.feeSatoshiPerByteBucketMaxima;

		await utils.timePromise("mempool-summary/render", async () => {
			res.render("mempool-summary");
		});

		next();

	} catch (err) {
		utils.logError("390824yw7e332", err);
					
		res.locals.userMessage = "Error building page: " + err;

		res.render("mempool-summary");

		next();
	}
}));

router.get("/peers", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"peers"});
		res.locals.perfId = perfId;

		const promises = [];

		promises.push(utils.timePromise("peers.getPeerSummary", async () => {
			res.locals.peerSummary = await coreApi.getPeerSummary();
		}, perfResults));

		
		await utils.awaitPromises(promises);

		const peerSummary = res.locals.peerSummary;

		const peerIps: string[] = [];
		for (let i = 0; i < peerSummary.getpeerinfo.length; i++) {
			const ipWithPort = peerSummary.getpeerinfo[i].addr;
			if (ipWithPort.lastIndexOf(":") >= 0) {
				const ip = ipWithPort.substring(0, ipWithPort.lastIndexOf(":"));
				if (ip.trim().length > 0) {
					peerIps.push(ip.trim());
				}
			}
		}

		if (peerIps.length > 0) {
			res.locals.peerIpSummary = await utils.timePromise("peers.geoLocateIpAddresses", async () => {
				return await utils.geoLocateIpAddresses(peerIps)
			}, perfResults);
			
			res.locals.mapBoxComApiAccessKey = config.credentials.mapBoxComApiAccessKey;
		}


		await utils.timePromise("peers.render", async () => {
			res.render("peers");
		}, perfResults);

		next();

	} catch (err) {
		utils.logError("394rhweghe", err);
					
		res.locals.userMessage = "Error: " + err;

		await utils.timePromise("peers.render", async () => {
			res.render("peers");
		});

		next();
	}
}));

router.get("/changeSetting", function(req, res) {
	if (req.query.name) {
		if (!req.session.userSettings) {
			req.session.userSettings = Object.create(null);
		}

		// (the settings end up in pages and scripts: only plain values are kept)
		if (!isValidSetting(req.query.name, req.query.value)) {
			res.redirect(req.headers.referer || "/");

			return;
		}

		const name = req.query.name as string;
		const value = req.query.value;

		req.session.userSettings[name] = value;

		const userSettings = settingsFromCookie(req.cookies["user-settings"]);
		userSettings[name] = value;

		res.cookie("user-settings", JSON.stringify(userSettings));
	}

	res.redirect(req.headers.referer || "/");
});

router.get("/session-data", function(req, res) {
	if (req.query.action && req.query.data) {
		const action = req.query.action;
		const data = req.query.data;

		if (action == "add-rpc-favorite") {
			if (!req.session.favoriteRpcCommands) {
				req.session.favoriteRpcCommands = [];
			}

			if (!req.session.favoriteRpcCommands.includes(data)) {
				req.session.favoriteRpcCommands.push(data);
			}

			req.session.favoriteRpcCommands.sort();
		}

		if (action == "remove-rpc-favorite") {
			if (!req.session.favoriteRpcCommands) {
				req.session.favoriteRpcCommands = [];
			}

			if (req.session.favoriteRpcCommands.includes(data)) {
				req.session.favoriteRpcCommands.splice(req.session.favoriteRpcCommands.indexOf(data), 1);
			}
		}
	}

	res.redirect(req.headers.referer || "/");
});

router.get("/user-settings", asyncHandler(async (req, res, next) => {
	await utils.timePromise("user-settings.render", async () => {
		res.render("user-settings");
	});

	next();
}));

router.get("/blocks", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"blocks"});
		res.locals.perfId = perfId;

		let limit = config.site.browseBlocksPageSize;
		let offset = 0;
		let sort = "desc";

		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		if (req.query.sort) {
			sort = queryString(req.query, "sort", sort);
		}

		res.locals.limit = limit;
		res.locals.offset = offset;
		res.locals.sort = sort;
		res.locals.paginationBaseUrl = "./blocks";

		// if pruning is active, global.pruneHeight is used when displaying this page
		// global.pruneHeight is updated whenever we send a getblockchaininfo RPC to the node

		const getblockchaininfo = await utils.timePromise("blocks.geoLocateIpAddresses", coreApi.getBlockchainInfo, perfResults);

		res.locals.blockCount = getblockchaininfo.blocks;
		res.locals.blockOffset = offset;

		let blockHeights = [];
		if (sort == "desc") {
			for (let i = (getblockchaininfo.blocks - offset); i > (getblockchaininfo.blocks - offset - limit - 1); i--) {
				if (i >= 0) {
					blockHeights.push(i);
				}
			}
		} else {
			for (let i = offset - 1; i < (offset + limit); i++) {
				if (i >= 0) {
					blockHeights.push(i);
				}
			}
		}

		blockHeights = blockHeights.filter((h) => {
			return h >= 0 && h <= getblockchaininfo.blocks;
		});


		const promises = [];

		promises.push(utils.timePromise("blocks.getBlocksByHeight", async () => {
			res.locals.blocks = await coreApi.getBlocksByHeight(blockHeights);
		}, perfResults));

		
		promises.push(utils.timePromise("blocks.getBlocksByHeight", async () => {
			try {
				const rawblockstats = await coreApi.getBlocksStatsByHeight(blockHeights);

				if (rawblockstats != null && rawblockstats.length > 0 && rawblockstats[0] != null) {
					res.locals.blockstatsByHeight = {};

					for (let i = 0; i < rawblockstats.length; i++) {
						const blockstats = rawblockstats[i];

						res.locals.blockstatsByHeight[blockstats.height] = blockstats;
					}
				}
			} catch (err) {
				if (!global.prunedBlockchain) {
					throw err;

				} else {
					// failure may be due to pruning, let it pass (the block stats are left out of the page)
					utils.logError("blocksBlockStatsPruned", err);
				}
			}
		}, perfResults));


		await utils.awaitPromises(promises);

		await utils.timePromise("blocks.render", async () => {
			res.render("blocks");
		}, perfResults);

		next();

	} catch (err) {
		res.locals.pageErrors.push(utils.logError("32974hrbfbvc", err));

		res.locals.userMessage = "Error: " + err;

		await utils.timePromise("blocks.render", async () => {
			res.render("blocks");
		});

		next();
	}
}));

router.get("/mining-summary", asyncHandler(async (req, res, next) => {
	try {
		const getblockchaininfo = await utils.timePromise("mining-summary.getBlockchainInfo", coreApi.getBlockchainInfo);

		res.locals.currentBlockHeight = getblockchaininfo.blocks;

		await utils.timePromise("mining-summary.render", async () => {
			res.render("mining-summary");
		});

		next();

	} catch (err) {
		res.locals.pageErrors.push(utils.logError("39342heuges", err));

		res.locals.userMessage = "Error: " + err;

		res.render("mining-summary");

		next();
	}
}));

router.get("/xyzpub/:extendedPubkey", asyncHandler(async (req, res, next) => {
	try {
		const extendedPubkey = req.params.extendedPubkey;
		res.locals.extendedPubkey = extendedPubkey;

		
		let limit = 20;
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}
		res.locals.limit = limit;

		let offset = 0;
		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}
		res.locals.offset = offset;

		
		res.locals.paginationBaseUrl = `./xyzpub/${extendedPubkey}`;

		res.locals.metaTitle = `Extended Public Key: ${utils.ellipsizeMiddle(extendedPubkey, 24)}`;


		res.locals.relatedKeys = [];

		const xpub_tpub = global.activeBlockchain == "main" ? "xpub" : "tpub";
		const ypub_upub = global.activeBlockchain == "main" ? "ypub" : "upub";
		const zpub_vpub = global.activeBlockchain == "main" ? "zpub" : "vpub";

		res.locals.pubkeyType = "Unknown";
		res.locals.bip32Path = "Unknown";
		res.locals.pubkeyTypeDesc = null;
		res.locals.keyType = extendedPubkey.substring(0, 4);

		// if xpub/ypub/zpub convert to address under path m/0/0
		if (extendedPubkey.match(/^(xpub|tpub).*$/)) {
			res.locals.pubkeyType = "P2PKH";
			res.locals.pubkeyTypeDesc = "Pay to Public Key Hash";
			res.locals.bip32Path = "m/44'/0'";

			
			let xpub = extendedPubkey;
			if (!extendedPubkey.startsWith(xpub_tpub)) {
				xpub = utils.xpubChangeVersionBytes(extendedPubkey, xpub_tpub);
			}

			res.locals.receiveAddresses = utils.bip32Addresses(extendedPubkey, "p2pkh", 0, limit, offset);
			res.locals.changeAddresses = utils.bip32Addresses(extendedPubkey, "p2pkh", 1, limit, offset);

			if (!extendedPubkey.startsWith(xpub_tpub)) {
				res.locals.relatedKeys.push({
					keyType: xpub_tpub,
					key: utils.xpubChangeVersionBytes(xpub, xpub_tpub),
					bip32Path: "m/44'/0'",
					outputType: "P2PKH",
					firstAddresses: utils.bip32Addresses(xpub, "p2pkh", 0, 3, 0)
				});
			}

			res.locals.relatedKeys.push({
				keyType: xpub_tpub,
				key: extendedPubkey,
				bip32Path: "m/44'/0'",
				outputType: "P2PKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2pkh", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: ypub_upub,
				key: utils.xpubChangeVersionBytes(xpub, ypub_upub),
				bip32Path: "m/49'/0'",
				outputType: "P2WPKH in P2SH",
				firstAddresses: utils.bip32Addresses(xpub, "p2sh(p2wpkh)", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: zpub_vpub,
				key: utils.xpubChangeVersionBytes(xpub, zpub_vpub),
				bip32Path: "m/84'/0'",
				outputType: "P2WPKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2wpkh", 0, 3, 0)
			});

		} else if (extendedPubkey.match(/^(ypub|upub).*$/)) {
			res.locals.pubkeyType = "P2WPKH in P2SH";
			res.locals.pubkeyTypeDesc = "Pay to Witness Public Key Hash (P2WPKH) wrapped inside Pay to Script Hash (P2SH), aka Wrapped Segwit";
			res.locals.bip32Path = "m/49'/0'";

			const xpub = utils.xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

			res.locals.receiveAddresses = utils.bip32Addresses(xpub, "p2sh(p2wpkh)", 0, limit, offset);
			res.locals.changeAddresses = utils.bip32Addresses(xpub, "p2sh(p2wpkh)", 1, limit, offset);

			res.locals.relatedKeys.push({
				keyType: xpub_tpub,
				key: xpub,
				bip32Path: "m/44'/0'",
				outputType: "P2PKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2pkh", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: ypub_upub,
				key: extendedPubkey,
				bip32Path: "m/49'/0'",
				outputType: "P2WPKH in P2SH",
				firstAddresses: utils.bip32Addresses(xpub, "p2sh(p2wpkh)", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: zpub_vpub,
				key: utils.xpubChangeVersionBytes(xpub, zpub_vpub),
				bip32Path: "m/84'/0'",
				outputType: "P2WPKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2wpkh", 0, 3, 0)
			});

		} else if (extendedPubkey.match(/^(zpub|vpub).*$/)) {
			res.locals.pubkeyType = "P2WPKH";
			res.locals.pubkeyTypeDesc = "Pay to Witness Public Key Hash, aka Native Segwit";
			res.locals.bip32Path = "m/84'/0'";

			const xpub = utils.xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

			res.locals.receiveAddresses = utils.bip32Addresses(xpub, "p2wpkh", 0, limit, offset);
			res.locals.changeAddresses = utils.bip32Addresses(xpub, "p2wpkh", 1, limit, offset);

			res.locals.relatedKeys.push({
				keyType: xpub_tpub,
				key: xpub,
				bip32Path: "m/44'/0'",
				outputType: "P2PKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2pkh", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: ypub_upub,
				key: utils.xpubChangeVersionBytes(xpub, ypub_upub),
				bip32Path: "m/49'/0'",
				outputType: "P2WPKH in P2SH",
				firstAddresses: utils.bip32Addresses(xpub, "p2sh(p2wpkh)", 0, 3, 0)
			});

			res.locals.relatedKeys.push({
				keyType: zpub_vpub,
				key: extendedPubkey,
				bip32Path: "m/84'/0'",
				outputType: "P2WPKH",
				firstAddresses: utils.bip32Addresses(xpub, "p2wpkh", 0, 3, 0)
			});

		} else if (extendedPubkey.startsWith("Ypub")) {
			res.locals.pubkeyType = "Multi-Sig P2WSH in P2SH";
			res.locals.bip32Path = "-";

		} else if (extendedPubkey.startsWith("Zpub")) {
			res.locals.pubkeyType = "Multi-Sig P2WSH";
			res.locals.bip32Path = "-";
		}

		// Cumulate balanceSat of all addresses
		res.locals.balanceSat = 0;

		// Loop over the 2 types addresses (first receive and then change)
		const allAddresses = [res.locals.receiveAddresses, res.locals.changeAddresses];
		res.locals.receiveAddresses = [];
		res.locals.changeAddresses = [];
		for (let i = 0; i < allAddresses.length; i++) {
			// Duplicate addresses and change them to addressDetails objects with 3 properties (address, balanceSat, txCount)
			const addresses = [...allAddresses[i]];
			for (let j = 0; j < addresses.length; j++) {
				const address = addresses[j];
				const validateaddressResult = await coreApi.getAddress(address);

				// No need to paginate request => use a high limit value
				const addressDetailsResult = await addressApi.getAddressDetails(address, validateaddressResult.scriptPubKey, "desc", 100, 0);

				// In case of errors, we just skip this address result
				if (Array.isArray(addressDetailsResult.errors) && addressDetailsResult.errors.length == 0) {
					res.locals.balanceSat += (addressDetailsResult.addressDetails as AddressDetails).balanceSat;
					const addressDetails = { ...addressDetailsResult.addressDetails, address};
					if (i == 0)
						res.locals.receiveAddresses.push(addressDetails);
					else
						res.locals.changeAddresses.push(addressDetails);
				}
			}
		}

		await utils.timePromise("extended-public-key.render", async () => {
			res.render("extended-public-key");
		});

		next();

	} catch (err) {
		res.locals.pageErrors.push(utils.logError("23r08uyhe7ege", err));

		res.locals.userMessage = "Error: " + err;

		await utils.timePromise("extended-public-key.render", async () => {
			res.render("extended-public-key");
		});

		next();
	}
}));

router.get("/block-stats", asyncHandler(async (req, res, next) => {
	if (semver.lt(global.btcNodeSemver, rpcApi.minRpcVersions.getblockstats)) {
		res.locals.rpcApiUnsupportedError = {rpc:"getblockstats", version:rpcApi.minRpcVersions.getblockstats};
	}

	try {
		const getblockchaininfo = await coreApi.getBlockchainInfo();
		res.locals.currentBlockHeight = getblockchaininfo.blocks;

		await utils.timePromise("block-stats.render", async () => {
			res.render("block-stats");
		});

		next();

	} catch(err) {
		res.locals.userMessage = "Error: " + err;

		await utils.timePromise("block-stats.render", async () => {
			res.render("block-stats");
		});

		next();
	};
}));

router.get("/mining-template", asyncHandler(async (req, res) => {
	// url changed
	res.redirect(301, "./next-block");
}));

router.get("/next-block", asyncHandler(async (req, res, next) => {
	const blockTemplate = await coreApi.getBlockTemplate();

	if (!blockTemplate || !blockTemplate.transactions) {
		throw new Error("The node did not return a block template.");
	}

	res.locals.minFeeRate = 1000000;
	res.locals.maxFeeRate = -1;
	res.locals.medianFeeRate = -1;

	const parentTxIndexes = new Set();
	blockTemplate.transactions.forEach((tx: RpcData) => {
		if (tx.depends && tx.depends.length > 0) {
			tx.depends.forEach((index: number) => {
				parentTxIndexes.add(index);
			});
		}
	});

	let txIndex = 1;
	const feeRates: number[] = [];
	blockTemplate.transactions.forEach((tx: RpcData) => {
		const feeRate = tx.fee / tx.weight * 4;

		if (tx.depends && tx.depends.length > 0) {
			let totalFee = tx.fee;
			let totalWeight = tx.weight;

			tx.depends.forEach((index: number) => {
				totalFee += blockTemplate.transactions[index - 1].fee;
				totalWeight += blockTemplate.transactions[index - 1].weight;
			});

			tx.avgFeeRate = totalFee / totalWeight * 4;
		}

		// txs that are ancestors should not be included in min/max
		// calculations since their native fee rate is different than
		// their effective fee rate (which takes descendant fee rates
		// into account)
		if (!parentTxIndexes.has(txIndex) && (!tx.depends || tx.depends.length == 0)) {
			feeRates.push(feeRate);

			if (feeRate > res.locals.maxFeeRate) {
				res.locals.maxFeeRate = feeRate;
			}

			if (feeRate < res.locals.minFeeRate) {
				res.locals.minFeeRate = feeRate;
			}
		}

		txIndex++;
	});

	if (feeRates.length > 0) {
		res.locals.medianFeeRate = feeRates[Math.floor(feeRates.length / 2)];
	}

	res.locals.blockTemplate = blockTemplate;

	
	await utils.timePromise("next-block.render", async () => {
		res.render("next-block");
	});

	next();
}));

router.get("/search", function(req, res, next) {
	res.render("search");

	next();
});

router.post("/search", function(req, res) {
	if (!req.body.query) {
		req.session.userMessage = "Enter a block height, block hash, or transaction id.";

		res.redirect("./");

		return;
	}

	const query = req.body.query.toLowerCase().trim();
	const rawCaseQuery = req.body.query.trim();

	req.session.query = req.body.query;
	
	// xpub/ypub/zpub -> redirect: /xyzpub/XXX
	if (rawCaseQuery.match(/^(xpub|ypub|zpub|Ypub|Zpub).*$/)) {
		res.redirect(`./xyzpub/${rawCaseQuery}`);
		
		return;
	}

	// tpub/upub/vpub -> redirect: /xyzpub/XXX
	if (rawCaseQuery.match(/^(tpub|upub|vpub|Upub|Vpub).*$/)) {
		res.redirect(`./xyzpub/${rawCaseQuery}`);
		
		return;
	}
	
	
	// Support txid@height lookups
	if (/^[a-f0-9]{64}@\d+$/.test(query)) {
		return res.redirect("./tx/" + query);
	}

	const parseAddressData = utils.tryParseAddress(rawCaseQuery);

	if (parseAddressData.parsedAddress) {
		res.redirect("./address/" + rawCaseQuery);

	} else if (query.length == 64) {
		coreApi.getRawTransaction(query).then(function() {
			res.redirect("./tx/" + query);

		}).catch(function() {
			coreApi.getBlockByHash(query).then(function() {
				res.redirect("./block/" + query);

			}).catch(function() {
				req.session.userMessage = "No results found for query: " + query;

				if (!global.txindexAvailable) {
					req.session.userMessage += noTxIndexMsg;
				}
				
				res.redirect("./");
			});
		});

	} else if (!isNaN(query)) {
		coreApi.getBlockByHeight(parseInt(query)).then(function() {
			res.redirect("./block-height/" + query);
			
		}).catch(function() {
			req.session.userMessage = "No results found for query: " + query;

			res.redirect("./");
		});
	} else {
		req.session.userMessage = "No results found for query: " + rawCaseQuery;

		res.redirect("./");
	}
});

router.get("/block-height/:blockHeight", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"block-height"});
		res.locals.perfId = perfId;

		const blockHeight = parseInt(req.params.blockHeight);

		res.locals.blockHeight = blockHeight;

		res.locals.result = {};

		let limit = config.site.blockTxPageSize;
		let offset = 0;

		res.locals.maxTxOutputDisplayCount = 15;

		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);

			// for demo sites, limit page sizes
			if (config.demoSite && limit > config.site.blockTxPageSize) {
				limit = config.site.blockTxPageSize;

				res.locals.userMessage = "Transaction page size limited to " + config.site.blockTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
			}
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		res.locals.limit = limit;
		res.locals.offset = offset;
		res.locals.paginationBaseUrl = "./block-height/" + blockHeight;


		const result = await utils.timePromise("block-height.getBlockByHeight", async () => {
			return await coreApi.getBlockByHeight(blockHeight);
		}, perfResults);

		res.locals.result.getblockbyheight = result;

		const promises = [];

		promises.push(utils.timePromise("block-height.getBlockByHashWithTransactions", async () => {
			const blockWithTransactions = await coreApi.getBlockByHashWithTransactions(result.hash, limit, offset);

			res.locals.result.getblock = blockWithTransactions.getblock;
			res.locals.result.transactions = blockWithTransactions.transactions;
			res.locals.result.txInputsByTransaction = blockWithTransactions.txInputsByTransaction;
		}, perfResults));

		promises.push(utils.timePromise("block-height.getBlockStats", async () => {
			try {
				const blockStats = await coreApi.getBlockStats(result.hash);
				
				res.locals.result.blockstats = blockStats;

			} catch (err) {
				if (global.prunedBlockchain) {
					// unavailable, likely due to pruning
					debugLog('Failed loading block stats', err);
					res.locals.result.blockstats = null;

				} else {
					throw err;
				}
			}
		}, perfResults));

		const settled = await utils.awaitPromises(promises);

		// without the block there is no page to build: the reason (a block that does not exist, say) is the error
		if (settled[0].status == "rejected") {
			throw settled[0].reason;
		}

		if (global.specialBlocks && global.specialBlocks[res.locals.result.getblock.hash]) {
			const funInfo = global.specialBlocks[res.locals.result.getblock.hash];

			res.locals.metaTitle = funInfo.summary;

			if (funInfo.alertBodyHtml) {
				res.locals.metaDesc = funInfo.alertBodyHtml.replace(/<\/?("[^"]*"|'[^']*'|[^>])*(>|$)/g, "");

			} else {
				res.locals.metaDesc = "";
			}
		} else {
			res.locals.metaTitle = `Bitcoin Block #${blockHeight.toLocaleString()}`;
			res.locals.metaDesc = "";
		}
		

		await utils.timePromise("block-height.render", async () => {
			res.render("block");
		}, perfResults);

		next();

	} catch (err) {
		res.locals.userMessageMarkdown = `Failed loading block: height=**${req.params.blockHeight}**`;

		res.locals.pageErrors.push(utils.logError("389wer07eghdd", err));

		res.status(err instanceof NotFoundError ? 404 : 500);

		await utils.timePromise("block-height.render", async () => {
			res.render("block");
		});

		next();
	}
}));

router.get("/block/:blockHash", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"block"});
		res.locals.perfId = perfId;

		const blockHash = utils.asHash(req.params.blockHash);

		res.locals.blockHash = blockHash;

		res.locals.result = {};

		let limit = config.site.blockTxPageSize;
		let offset = 0;

		res.locals.maxTxOutputDisplayCount = 15;

		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);

			// for demo sites, limit page sizes
			if (config.demoSite && limit > config.site.blockTxPageSize) {
				limit = config.site.blockTxPageSize;

				res.locals.userMessage = "Transaction page size limited to " + config.site.blockTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
			}
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		res.locals.limit = limit;
		res.locals.offset = offset;
		res.locals.paginationBaseUrl = "./block/" + blockHash;

		const promises = [];

		promises.push(utils.timePromise("block.getBlockByHashWithTransactions", async () => {
			const blockWithTransactions = await coreApi.getBlockByHashWithTransactions(blockHash, limit, offset);

			res.locals.result.getblock = blockWithTransactions.getblock;
			res.locals.result.transactions = blockWithTransactions.transactions;
			res.locals.result.txInputsByTransaction = blockWithTransactions.txInputsByTransaction;
		}, perfResults));

		promises.push(utils.timePromise("block.getBlockStats", async () => {
			try {
				const blockStats = await coreApi.getBlockStats(blockHash);
				
				res.locals.result.blockstats = blockStats;

			} catch (err) {
				if (global.prunedBlockchain) {
					// unavailable, likely due to pruning
					debugLog('Failed loading block stats, likely due to pruning', err);

				} else {
					throw err;
				}
			}
		}, perfResults));

		const settled = await utils.awaitPromises(promises);

		// without the block there is no page to build: the reason (a block that does not exist, say) is the error
		if (settled[0].status == "rejected") {
			throw settled[0].reason;
		}

		if (global.specialBlocks && global.specialBlocks[res.locals.result.getblock.hash]) {
			const funInfo = global.specialBlocks[res.locals.result.getblock.hash];

			res.locals.metaTitle = funInfo.summary;

			if (funInfo.alertBodyHtml) {
				res.locals.metaDesc = funInfo.alertBodyHtml.replace(/<\/?("[^"]*"|'[^']*'|[^>])*(>|$)/g, "");

			} else {
				res.locals.metaDesc = "";
			}

		} else {
			res.locals.metaTitle = `Bitcoin Block ${utils.ellipsizeMiddle(res.locals.result.getblock.hash, 16)}`;
			res.locals.metaDesc = "";
		}

		
		await utils.timePromise("block.render", async () => {
			res.render("block");
		}, perfResults);

		next();

	} catch (err) {
		res.locals.userMessageMarkdown = `Failed to load block: **${res.locals.blockHash || req.params.blockHash}**`;

		res.locals.pageErrors.push(utils.logError("32824yhr2973t3d", err));

		// a block that does not exist is a 404; anything else means that the page could not be built
		res.status(err instanceof NotFoundError ? 404 : 500);

		await utils.timePromise("block.render", async () => {
			res.render("block");
		});

		next();
	}
}));

router.get("/predicted-blocks", asyncHandler(async (req, res, next) => {
	try {
		res.locals.satoshiPerByteBucketMaxima = coinConfig.feeSatoshiPerByteBucketMaxima;

		res.render("predicted-blocks");

		next();

	} catch (err) {
		utils.logError("2083ryw0efghsu", err);
					
		res.locals.userMessage = "Error building page: " + err;

		res.render("predicted-blocks");

		next();
	}
}));

router.get("/block-analysis/:blockHashOrHeight", function(req, res, next) {
	const blockHashOrHeight = utils.asHashOrHeight(req.params.blockHashOrHeight);

	const goWithBlockHash = function(blockHash: string) {
		res.locals.blockHash = blockHash;

		res.locals.result = {};



		res.locals.result = {};

		coreApi.getBlockByHash(blockHash).then(function(block) {
			res.locals.block = block;
			res.locals.result.getblock = block;

			res.render("block-analysis");

			next();

		}).catch(function(err) {
			res.locals.pageErrors.push(utils.logError("943h84ehedr", err));

			res.render("block-analysis");

			next();
		});
	};

	if (!isNaN(Number(blockHashOrHeight))) {
		coreApi.getBlockByHeight(parseInt(String(blockHashOrHeight))).then(function(blockByHeight) {
			goWithBlockHash(blockByHeight.hash);
		});
	} else {
		goWithBlockHash(blockHashOrHeight as string);
	}
});

router.get("/block-analysis", function(req, res, next) {
	res.render("block-analysis-search");

	next();
});

router.get("/tx/:transactionId@:blockHeight", asyncHandler(async (req, res, next) => {
	req.query.blockHeight = req.params.blockHeight;
	req.url = "/tx/" + req.params.transactionId;

	next();
}));


router.get("/tx/:transactionId", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"transaction"});
		res.locals.perfId = perfId;

		const txid = utils.asHash(req.params.transactionId);

		let output = -1;
		if (req.query.output) {
			output = queryInt(req.query, "output", output);
		}

		res.locals.txid = txid;
		res.locals.output = output;

		res.locals.maxTxOutputDisplayCount = 40;

		const promises = [];

		if (req.query.blockHeight) {
			res.locals.blockHeight = queryInt(req.query, "blockHeight");
		}

		res.locals.result = {};

		const txInputLimit = (res.locals.crawlerBot) ? 3 : -1;

		const txPromise = req.query.blockHeight ? 
				async () => {
					const block = await coreApi.getBlockByHeight(queryInt(req.query, "blockHeight"));
					res.locals.block = block;
					return await coreApi.getRawTransactionsWithInputs([txid], txInputLimit, block.hash);
				}
				:
				async () => {
					return await coreApi.getRawTransactionsWithInputs([txid], txInputLimit);
				};

		const rawTxResult = await utils.timePromise("tx.getRawTransactionsWithInputs", txPromise, perfResults);

		const tx = rawTxResult.transactions[0];

		res.locals.tx = tx;
		res.locals.isCoinbaseTx = tx.vin[0].coinbase;


		res.locals.result.getrawtransaction = tx;
		res.locals.result.txInputs = rawTxResult.txInputsByTransaction[txid] || {};


		promises.push(utils.timePromise("tx.getTxUtxos", async () => {
			res.locals.utxos = await coreApi.getTxUtxos(tx);
		}, perfResults));

		if (tx.confirmations == null) {
			promises.push(utils.timePromise("tx.getMempoolTxDetails", async () => {
				res.locals.mempoolDetails = await coreApi.getMempoolTxDetails(txid, true);

			}, perfResults));
			
		} else {
			promises.push(utils.timePromise("tx.getblockheader", async () => {
				const rpcResult = await rpcApi.getRpcDataWithParams({method:'getblockheader', parameters:[tx.blockhash]});
				res.locals.result.getblock = rpcResult;
			}, perfResults));
		}

		await utils.awaitPromises(promises);

		if (global.specialTransactions && global.specialTransactions[txid]) {
			const funInfo = global.specialTransactions[txid];

			res.locals.metaTitle = funInfo.summary;

			if (funInfo.alertBodyHtml) {
				res.locals.metaDesc = funInfo.alertBodyHtml.replace(/<\/?("[^"]*"|'[^']*'|[^>])*(>|$)/g, "");

			} else {
				res.locals.metaDesc = "";
			}
		} else {
			res.locals.metaTitle = `Bitcoin Transaction ${utils.ellipsizeMiddle(txid, 16)}`;
			res.locals.metaDesc = "";
		}

		res.locals.perfResults = perfResults;
		
		await utils.timePromise("tx.render", async () => {
			res.render("transaction");
		}, perfResults);

		next();

	} catch (err) {
		if (global.prunedBlockchain && res.locals.blockHeight && res.locals.blockHeight < global.pruneHeight) {
			// Failure to load tx here is expected and a full description of the situation is given to the user
			// in the UI. No need to also show an error userMessage here.

		} else if (!global.txindexAvailable) {
			res.locals.noTxIndexMsg = noTxIndexMsg;

			// As above, failure to load the tx is expected here and good user feedback is given in the UI.
			// No need for error userMessage.

		} else {
			res.locals.userMessageMarkdown = `Failed to load transaction: txid=**${res.locals.txid || req.params.transactionId}**`;

			// the node answering that there is no such transaction is not an Error (rpcApi rejects with that answer, or
			// with nothing); an Error means that the page could not be built
			res.status(err instanceof Error ? 500 : 404);
		}

		

		utils.logError("1237y4ewssgt", err);

		await utils.timePromise("tx.render", async () => {
			res.render("transaction");
		});

		next();
	}
}));

router.get("/address/:address", asyncHandler(async (req, res, next) => {
	const address = utils.asAddress(req.params.address);

	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"address"});
		res.locals.perfId = perfId;

		let limit = config.site.addressTxPageSize;
		let offset = 0;
		let sort = "desc";

		res.locals.maxTxOutputDisplayCount = config.site.addressPage.txOutputMaxDefaultDisplay;

		
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);

			// for demo sites, limit page sizes
			if (config.demoSite && limit > config.site.addressTxPageSize) {
				limit = config.site.addressTxPageSize;

				res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
			}
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		if (req.query.sort) {
			sort = queryString(req.query, "sort", sort);
		}


		res.locals.metaTitle = `Bitcoin Address ${address}`;

		res.locals.address = address;
		res.locals.limit = limit;
		res.locals.offset = offset;
		res.locals.sort = sort;
		res.locals.paginationBaseUrl = `./address/${address}?sort=${sort}`;
		res.locals.transactions = [];
		res.locals.addressApiSupport = addressApi.getCurrentAddressApiFeatureSupport();
		
		res.locals.result = {};

		const parseAddressData = utils.tryParseAddress(address);

		if (parseAddressData.parsedAddress) {
			//console.log("address.parse: " + JSON.stringify(parseAddressData));

			res.locals.addressObj = parseAddressData.parsedAddress;
			res.locals.addressEncoding = parseAddressData.encoding;

		} else if (parseAddressData.errors) {
			parseAddressData.errors.forEach((err: RpcData) => {
				res.locals.pageErrors.push(utils.logError("ParseAddressError", err));
			});
		}


		if (global.miningPoolsConfigs) {
			for (let i = 0; i < global.miningPoolsConfigs.length; i++) {
				if (global.miningPoolsConfigs[i].payout_addresses[address]) {
					res.locals.payoutAddressForMiner = global.miningPoolsConfigs[i].payout_addresses[address];
				}
			}
		}



		const validateaddressResult = await coreApi.getAddress(address);
		res.locals.result.validateaddress = validateaddressResult;

		const promises = [];

		if (!res.locals.crawlerBot) {
			let addrScripthash = hexEnc.stringify(sha256(hexEnc.parse(validateaddressResult.scriptPubKey)));
			addrScripthash = (addrScripthash.match(/.{2}/g) as string[]).reverse().join("");

			res.locals.electrumScripthash = addrScripthash;

			promises.push(utils.timePromise("address.getAddressDetails", async () => {
				const addressDetailsResult = await addressApi.getAddressDetails(address, validateaddressResult.scriptPubKey, sort, limit, offset);
				const addressDetails = addressDetailsResult.addressDetails;

				if (addressDetailsResult.errors) {
					res.locals.addressDetailsErrors = addressDetailsResult.errors;
				}

				if (addressDetailsResult.conflicts) {
					res.locals.addressConflicts = addressDetailsResult.conflicts;
				}

				if (addressDetails) {
					res.locals.addressDetails = addressDetails;

					if (addressDetails.balanceSat == 0) {
						// make sure zero balances pass the falsey check in the UI
						addressDetails.balanceSat = "0";
					}

					if (addressDetails.txCount == 0) {
						// make sure txCount=0 pass the falsey check in the UI
						addressDetails.txCount = "0";
					}

					if (addressDetails.txids) {
						const txids = addressDetails.txids;

						// if the active addressApi gives us blockHeightsByTxid, it saves us work, so try to use it
						let blockHeightsByTxid: Record<string, number> = {};
						if (addressDetails.blockHeightsByTxid) {
							blockHeightsByTxid = addressDetails.blockHeightsByTxid;
						}

						res.locals.txids = txids;

						const rawTxResult: { transactions: RpcData[], txInputsByTransaction: Record<string, RpcData> } = await (global.txindexAvailable
							? coreApi.getRawTransactionsWithInputs(txids, 5)
							: coreApi.getRawTransactionsByHeights(txids, blockHeightsByTxid)
								.then(transactions => ({ transactions, txInputsByTransaction: {} }))
						);
						
						res.locals.transactions = rawTxResult.transactions;
						res.locals.txInputsByTransaction = rawTxResult.txInputsByTransaction;

						
						// for coinbase txs, we need the block height in order to calculate subsidy to display
						const coinbaseTxs: RpcData[] = [];
						for (let i = 0; i < rawTxResult.transactions.length; i++) {
							const tx = rawTxResult.transactions[i];

							for (let j = 0; j < tx.vin.length; j++) {
								if (tx.vin[j].coinbase) {
									// addressApi sometimes has blockHeightByTxid already available, otherwise we need to query for it
									if (!blockHeightsByTxid[tx.txid]) {
										coinbaseTxs.push(tx);
									}
								}
							}
						}


						const coinbaseTxBlockHashes: string[] = [];
						const blockHashesByTxid: Record<string, string> = {};
						coinbaseTxs.forEach(function(tx: RpcData) {
							coinbaseTxBlockHashes.push(tx.blockhash);
							blockHashesByTxid[tx.txid] = tx.blockhash;
						});

						const blockHeightsPromises = [];
						if (coinbaseTxs.length > 0) {
							// we need to query some blockHeights by hash for some coinbase txs
							blockHeightsPromises.push(utils.timePromise("address.getBlocksByHash", async () => {
								const blocksByHashResult = await coreApi.getBlocksByHash(coinbaseTxBlockHashes);
								for (const txid in blockHashesByTxid) {
									if (Object.prototype.hasOwnProperty.call(blockHashesByTxid, txid)) {
										blockHeightsByTxid[txid] = blocksByHashResult[blockHashesByTxid[txid]].height;
									}
								}
							}, perfResults));
						}

						await utils.awaitPromises(blockHeightsPromises);

						const addrGainsByTx: Record<string, Decimal> = {};
						const addrLossesByTx: Record<string, Decimal> = {};

						res.locals.addrGainsByTx = addrGainsByTx;
						res.locals.addrLossesByTx = addrLossesByTx;

						const handledTxids: string[] = [];

						for (let i = 0; i < rawTxResult.transactions.length; i++) {
							const tx = rawTxResult.transactions[i];
							const txInputs = rawTxResult.txInputsByTransaction[tx.txid] || {};
							
							if (handledTxids.includes(tx.txid)) {
								continue;
							}

							handledTxids.push(tx.txid);

							for (let j = 0; j < tx.vout.length; j++) {
								if (tx.vout[j].value > 0 && tx.vout[j].scriptPubKey) {
									if (utils.getVoutAddresses(tx.vout[j]).includes(address)) {
										if (addrGainsByTx[tx.txid] == null) {
											addrGainsByTx[tx.txid] = new Decimal(0);
										}

										addrGainsByTx[tx.txid] = addrGainsByTx[tx.txid].plus(new Decimal(tx.vout[j].value));
									}
								}
							}

							for (let j = 0; j < tx.vin.length; j++) {
								const txInput = txInputs[j];

								if (txInput != null) {
									if (txInput && txInput.scriptPubKey) {
										if (utils.getVoutAddresses(txInput).includes(address)) {
											if (addrLossesByTx[tx.txid] == null) {
												addrLossesByTx[tx.txid] = new Decimal(0);
											}

											addrLossesByTx[tx.txid] = addrLossesByTx[tx.txid].plus(new Decimal(txInput.value));
										}
									}
								}
							}

							//debugLog("tx: " + JSON.stringify(tx));
							//debugLog("txInputs: " + JSON.stringify(txInputs));
						}

						res.locals.blockHeightsByTxid = blockHeightsByTxid;
					}
				}
			}, perfResults));

			promises.push(utils.timePromise("address.getBlockchainInfo", async () => {
				res.locals.getblockchaininfo = await coreApi.getBlockchainInfo();
			}, perfResults));
		}

		promises.push(utils.timePromise("address.qrcode.toDataURL", async () => {
			try {
				const url = await qrcode.toDataURL(address);

				res.locals.addressQrCodeUrl = url;
				
			} catch(err) {
				res.locals.pageErrors.push(utils.logError("93ygfew0ygf2gf2", err));
			}
		}, perfResults));

		await utils.awaitPromises(promises);
		
		await utils.timePromise("address.render", async () => {
			res.render("address");
		}, perfResults);

		next();

	} catch (e) {
		res.locals.pageErrors.push(utils.logError("2108hs0gsdfe", e, {address:address}));

		res.locals.userMessageMarkdown = `Failed to load address: **${address}**`;

		await utils.timePromise("address.render", async () => {
			res.render("address");
		});

		next();
	}
}));

router.get("/next-halving", asyncHandler(async (req, res, next) => {
	try {
		const { perfId, perfResults } = utils.perfLogNewItem({action:"next-halving"});
		res.locals.perfId = perfId;

		const getblockchaininfo = await utils.timePromise("homepage.getBlockchainInfo", async () => {
			return await coreApi.getBlockchainInfo();
		}, perfResults);

		const promises = [];

		res.locals.getblockchaininfo = getblockchaininfo;
		res.locals.difficultyPeriod = Math.trunc(Math.floor(getblockchaininfo.blocks / coinConfig.difficultyAdjustmentBlockCount));

		const blockHeights: number[] = [];
		if (getblockchaininfo.blocks) {
			for (let i = 0; i < 1; i++) {
				blockHeights.push(getblockchaininfo.blocks - i);
			}
		} else if (global.activeBlockchain == "regtest") {
			// hack: default regtest node returns getblockchaininfo.blocks=0, despite
			// having a genesis block; hack this to display the genesis block
			blockHeights.push(0);
		}

		promises.push(utils.timePromise("homepage.getBlockHeaderByHeight", async () => {
			const h = coinConfig.difficultyAdjustmentBlockCount * res.locals.difficultyPeriod;
			res.locals.difficultyPeriodFirstBlockHeader = await coreApi.getBlockHeaderByHeight(h);
		}, perfResults));

		promises.push(utils.timePromise("homepage.getBlocksByHeight", async () => {
			const latestBlocks = await coreApi.getBlocksByHeight(blockHeights);
			
			res.locals.latestBlocks = latestBlocks;
		}));

		await utils.awaitPromises(promises);


		const nextHalvingData = utils.nextHalvingEstimates(res.locals.difficultyPeriodFirstBlockHeader, res.locals.latestBlocks[0]);

		res.locals.nextHalvingData = nextHalvingData;

		await utils.timePromise("next-halving.render", async () => {
			res.render("next-halving");
		}, perfResults);

		next();

	} catch (e) {
		res.locals.pageErrors.push(utils.logError("013923hege3", e));

		await utils.timePromise("next-halving.render", async () => {
			res.render("next-halving");
		});

		next();
	}
}));

router.get("/rpc-terminal", function(req, res, next) {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'BTCEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");
		
		next();

		return;
	}

	res.render("rpc-terminal");

	next();
});

router.post("/rpc-terminal", asyncHandler(async (req, res, next) => {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'BTCEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");

		next();

		return;
	}

	const params = req.body.cmd.trim().split(/\s+/);
	const cmd = params.shift();
	const parsedParams: unknown[] = [];

	params.forEach((param: string) => {
		try {
			parsedParams.push(JSON.parse(param));

		} catch {
			// add as string
			parsedParams.push(param);
		}
	});

	if (config.rpcBlacklist.includes(cmd.toLowerCase())) {
		res.write("Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the BTCEXP_RPC_BLACKLIST setting (see .env-sample).", function() {
			res.end();
		});

		next();

		return;
	}

	try {
		const rpcResult = await rpcApi.getRpcDataWithParams({method:cmd, parameters:parsedParams, throwOnError:true});
		const result = rpcResult;
		
		if (result) {
			debugLog("Result[1]: " + JSON.stringify(result, null, 4));

			res.write(JSON.stringify(result, null, 4), function() {
				res.end();
			});

		} else {
			res.write(JSON.stringify({"Error":"No response from node"}, null, 4), function() {
				res.end();
			});
		}
	} catch (err) {
		debugLog(JSON.stringify(err, null, 4));

		// an Error has no enumerable properties to show: say what the node answered
		const rpcCode = (err as { rpcCode?: number }).rpcCode;
		const reply = err instanceof Error ? { Error: err.message, ...(rpcCode === undefined ? {} : { code: rpcCode }) } : err;

		res.write(JSON.stringify(reply, null, 4), function() {
			res.end();
		});
	}

	next();
}));

router.get("/rpc-browser", asyncHandler(async (req, res, next) => {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'BTCEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");

		next();

		return;
	}

	let method = "unknown";
	const argValues = [];

	try {
		const helpContent = await coreApi.getHelp();
		res.locals.gethelp = helpContent;


		const queryMethod = queryString(req.query, "method");

		if (queryMethod) {
			method = queryMethod;

			if (!req.session.recentRpcCommands) {
				req.session.recentRpcCommands = [];
			}

			if (!req.session.recentRpcCommands.includes(method)) {
				req.session.recentRpcCommands.unshift(method);
				
				while (req.session.recentRpcCommands.length > 5) {
					req.session.recentRpcCommands.pop();
				}
			}

			res.locals.method = queryMethod;

			const methodHelp = await coreApi.getRpcMethodHelp(queryMethod.trim());
			res.locals.methodhelp = methodHelp;

			if (req.query.execute) {
				const argDetails = methodHelp.args;
				
				// the arguments, as strings: ?args[0]=1&args[1]=abc (a single ?args=x counts as one argument)
				const queryArgs = queryStringList(req.query, "args");

				if (queryArgs.length > 0) {
					debugLog("ARGS: " + JSON.stringify(queryArgs));

					for (let i = 0; i < queryArgs.length; i++) {
						const argProperties = argDetails[i].properties;
						// null when the argument was not given (the checks below treat that as empty)
						const queryArg = queryArgs[i] as string;
						debugLog(`ARG_PROPS[${i}]: ` + JSON.stringify(argProperties));

						for (let j = 0; j < argProperties.length; j++) {
							if (argProperties[j] === "numeric") {
								if (queryArg == null || queryArg == "") {
									argValues.push(null);

								} else {
									argValues.push(parseInt(queryArg));
								}

								break;

							} else if (argProperties[j] === "boolean") {
								if (queryArg) {
									argValues.push(queryArg == "true");
								}

								break;

							} else if (argProperties[j] === "string") {
								if (queryArg) {
									argValues.push(queryArg.replace(/[\r]/g, ''));
								}

								break;

							} else if (argProperties[j] === "numeric or string" || argProperties[j] === "string or numeric") {
								if (queryArg) {
									const stringVal = queryArg.replace(/[\r]/g, '');
									const numberVal = parseInt(stringVal);

									if (!Number.isNaN(numberVal)) {
										argValues.push(numberVal);

									} else {
										argValues.push(stringVal);
									}
								}

								break;

							} else if (argProperties[j] === "array" || argProperties[j] === "json array") {
								if (queryArg) {
									argValues.push(JSON.parse(queryArg));
								}
								
								break;

							} else if (argProperties[j] === "json object") {
								if (queryArg) {
									argValues.push(JSON.parse(queryArg));
								}
								
								break;

							} else {
								debugLog(`Unknown argument property: ${argProperties[j]}`);
							}
						}
					}
				}

				res.locals.argValues = argValues;

				if (config.rpcBlacklist.includes(queryMethod.toLowerCase())) {
					res.locals.methodResult = "Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the BTCEXP_RPC_BLACKLIST setting (see .env-sample).";

					res.render("rpc-browser");

					next();

					return;
				}

				//let csrfPromise = 

				await new Promise<void>((resolve, reject) => {
					forceCsrf(req, res, async (err?: unknown) => {
						if (err) {
							reject(err);

						} else {
							resolve();
						}
					});
				});

				debugLog("Executing RPC '" + method + "' with params: " + JSON.stringify(argValues));

				try {
					const startTimeNanos = utils.startTimeNanos();
					const rpcResult = await rpcApi.getRpcDataWithParams({method:method, parameters:argValues, throwOnError:true});
					const result = rpcResult;
					const dtMillis = utils.dtMillis(startTimeNanos);

					res.locals.executionMillis = dtMillis;

					debugLog("RPC Response: result=" + JSON.stringify(result));

					if (result) {
						res.locals.methodResult = result;

					} else {
						res.locals.methodResult = {"Error":"No response from node."};
					}

					//res.render("rpc-browser");

					//next();

				} catch (err) {
					res.locals.pageErrors.push(utils.logError("23roewuhfdghe", err, {method:method, params:argValues}));

					res.locals.methodResult = {error:("" + err)};

					//res.render("rpc-browser");

					//next();
				}

				/*forceCsrf(req, res, async (err) => {
					if (err) {
						return next(err);
					}

					
				});*/
			}
		}
	} catch (err) {
		res.locals.pageErrors.push(utils.logError("23ewyf0weee", err, {method:method, params:argValues}));
		
		res.locals.userMessage = "Error loading help content: " + err;
	}

	res.render("rpc-browser");

	next();
}));

router.get("/terminal", function(req, res, next) {
	res.render("terminal");

	next();
});

router.post("/terminal", function(req, res, next) {
	const reply = (body: unknown) => {
		res.write(JSON.stringify(body, null, 4), function() {
			res.end();
		});

		next();
	};

	if (typeof req.body.cmd !== "string") {
		return reply({"Error":"No command"});
	}

	const params = req.body.cmd.trim().split(/\s+/);
	const cmd = params.shift();
	const paramsStr = req.body.cmd.trim().substring(cmd.length).trim();

	if (cmd == "parsescript") {
		if (!/^([0-9a-fA-F]{2})+$/.test(paramsStr)) {
			return reply({"Error":"parsescript needs a script as hex"});
		}

		try {
			return reply({"parsed":{"asm":bitcoinjs.script.toASM(Buffer.from(paramsStr, "hex"))}});

		} catch (err) {
			return reply({"Error":`Unable to parse the script: ${(err as Error).message}`});
		}

	} else {
		return reply({"Error":"Unknown command"});
	}
});

router.get("/mempool-transactions", asyncHandler(async (req, res, next) => {
	try {
		let limit = config.site.browseMempoolTransactionsPageSize;
		let offset = 0;
		let sort = "desc";

		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		if (req.query.sort) {
			sort = queryString(req.query, "sort", sort);
		}

		res.locals.limit = limit;
		res.locals.offset = offset;
		res.locals.sort = sort;
		res.locals.paginationBaseUrl = "./mempool-transactions";

		const perfResults = {};

		const mempoolData = await utils.timePromise("mempool-tx.getMempoolTxids", async () => {
			return await coreApi.getMempoolTxids(limit, offset)
		}, perfResults);

		const txids = mempoolData.txids;
		res.locals.txCount = mempoolData.txCount;

		
		const promises = [];

		promises.push(utils.timePromise("mempool-tx.getRawTransactionsWithInputs", async () => {
			const transactionData = await coreApi.getRawTransactionsWithInputs(txids, config.slowDeviceMode ? 3 : 5);

			res.locals.transactions = transactionData.transactions;
			res.locals.txInputsByTransaction = transactionData.txInputsByTransaction;
		}, perfResults));

		res.locals.mempoolDetailsByTxid = {};

		txids.forEach(txid => {
			promises.push(utils.timePromise("mempool-tx.getRawTransactionsWithInputs", async () => {
				const mempoolTxidDetails = await coreApi.getMempoolTxDetails(txid, false);

				res.locals.mempoolDetailsByTxid[txid] = mempoolTxidDetails;
			}, perfResults));
		});


		await utils.awaitPromises(promises);


		await utils.timePromise("mempool-transactions.render", async () => {
			res.render("mempool-transactions");
		});

		next();

	} catch (err) {
		utils.logError("3297gfsdyde3q", err);
					
		res.locals.userMessage = "Error building page: " + err;

		await utils.timePromise("mempool-transactions.render", async () => {
			res.render("mempool-transactions");
		});

		next();
	}
}));

router.get("/tx-stats", asyncHandler(async (req, res, next) => {
	const promises = [];
	const perfResults = {};

	res.locals.getblockchaininfo = await coreApi.getBlockchainInfo();
	const tipHeight = res.locals.getblockchaininfo.blocks;

	// only re-calculate tx-stats every X blocks since it's data heavy
	const heightInterval = 6;
	const height = heightInterval * Math.floor(tipHeight / heightInterval);

	promises.push(utils.timePromise("tx-stats.getTxStats-all", async () => {
		const statsAll = await coreApi.getTxStats(250, 0, height);

		res.locals.txStats = statsAll;
	}, perfResults));

	promises.push(utils.timePromise("tx-stats.getTxStats-day", async () => {
		const statsDay = await coreApi.getTxStats(144, height - 144, height);
		
		res.locals.txStatsDay = statsDay;
	}, perfResults));

	promises.push(utils.timePromise("tx-stats.getTxStats-week", async () => {
		const statsWeek = await coreApi.getTxStats(200, height - 144 * 7, height);

		res.locals.txStatsWeek = statsWeek;
	}, perfResults));

	promises.push(utils.timePromise("tx-stats.getTxStats-month", async () => {
		const statsMonth = await coreApi.getTxStats(250, height - 144 * 30, height);

		res.locals.txStatsMonth = statsMonth;
	}, perfResults));

	promises.push(utils.timePromise("tx-stats.getTxStats-year", async () => {
		const statsYear = await coreApi.getTxStats(250, height - 144 * 365, height);

		res.locals.txStatsYear = statsYear;
	}, perfResults));


	await utils.awaitPromises(promises);

	res.render("tx-stats");

	next();
}));

router.get("/difficulty-history", function(req, res, next) {
	coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.blockCount = getblockchaininfo.blocks;

		res.render("difficulty-history");

		next();

	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("difficulty-history");

		next();
	});
});

router.get("/utxo-set", function(req, res, next) {
	res.render("utxo-set");

	next();
});

router.get("/about", function(req, res, next) {
	res.render("about");

	next();
});

router.get("/tools", function(req, res, next) {
	res.render("tools");

	next();
});

router.get("/changelog", function(req, res, next) {
	res.locals.changelogHtml = markdown.render(global.changelogMarkdown);

	res.render("changelog");

	next();
});

router.get("/fun", function(req, res, next) {
	let viewType = "new-first";
	if (req.query.viewType) {
		viewType = queryString(req.query, "viewType", viewType);
	}

	const listNewFirst: RpcData[] = coins[config.coin].historicalData;
	
	listNewFirst.sort(function(a, b) {
		if (a.date > b.date) {
			return -1;

		} else if (a.date < b.date) {
			return 1;

		} else {
			const x = a.type.localeCompare(b.type);

			if (x == 0) {
				if (a.type == "blockheight") {
					return b.blockHeight - a.blockHeight;

				} else {
					return x;
				}
			}

			return x;
		}
	});

	const listOldFirst = [...listNewFirst];
	listOldFirst.reverse();

	const listByYear: Record<string, RpcData[]> = {};
	const itemYears: string[] = [];

	listNewFirst.forEach((item: RpcData) => {
		const itemYear = item.date.substring(0, 4);

		if (!itemYears.includes(itemYear)) {
			itemYears.push(itemYear);
			listByYear[itemYear] = [];
		}

		listByYear[itemYear].push(item);
	});

	const listByMonth: Record<string, RpcData[]> = {};
	const itemMonths: string[] = [];

	listNewFirst.forEach((item: RpcData) => {
		const itemMonth = item.date.substring(5, 7);

		if (!itemMonths.includes(itemMonth)) {
			itemMonths.push(itemMonth);
			listByMonth[itemMonth] = [];
		}

		listByMonth[itemMonth].push(item);
	});

	itemMonths.sort();

	res.locals.viewType = viewType;
	res.locals.listNewFirst = listNewFirst;
	res.locals.listOldFirst = listOldFirst;
	res.locals.listByYear = listByYear;
	res.locals.itemYears = itemYears;
	res.locals.listByMonth = listByMonth;
	res.locals.itemMonths = itemMonths;
	
	res.render("fun");

	next();
});

router.get("/quotes", function(req, res, next) {
	let viewType = "new-first";
	if (req.query.viewType) {
		viewType = queryString(req.query, "viewType", viewType);
	}

	let listNewFirst: RpcData[] = btcQuotes.items;
	for (let i = 0; i < listNewFirst.length; i++) {
		listNewFirst[i].quoteIndex = i;
	}
	listNewFirst = listNewFirst.filter(x => { return !x.duplicateIndex; });
	
	listNewFirst.sort(function(a, b) {
		const dateCompare = b.date.localeCompare(a.date);

		if (dateCompare != 0) {
			return dateCompare;
		}

		const speakerCompare = a.speaker.localeCompare(b.speaker);

		if (speakerCompare != 0) {
			return speakerCompare;
		}

		return a.text.localeCompare(b.text);
	});

	const listOldFirst = [...listNewFirst];
	listOldFirst.reverse();

	const listByYear: Record<string, RpcData[]> = {};
	const itemYears: string[] = [];

	listNewFirst.forEach((item: RpcData) => {
		const itemYear = item.date.substring(0, 4);

		if (!itemYears.includes(itemYear)) {
			itemYears.push(itemYear);
			listByYear[itemYear] = [];
		}

		listByYear[itemYear].push(item);
	});

	const listByMonth: Record<string, RpcData[]> = {};
	const itemMonths: string[] = [];

	listNewFirst.forEach((item: RpcData) => {
		const itemMonth = item.date.substring(5, 7);

		if (!itemMonths.includes(itemMonth)) {
			itemMonths.push(itemMonth);
			listByMonth[itemMonth] = [];
		}

		listByMonth[itemMonth].push(item);
	});

	itemMonths.sort();

	res.locals.viewType = viewType;
	res.locals.listNewFirst = listNewFirst;
	res.locals.listOldFirst = listOldFirst;
	res.locals.listByYear = listByYear;
	res.locals.itemYears = itemYears;
	res.locals.listByMonth = listByMonth;
	res.locals.itemMonths = itemMonths;

	res.render("quotes");

	next();
});

router.get("/holidays", function(req, res, next) {
	res.locals.btcHolidays = global.btcHolidays;

	res.render("holidays");

	next();
});

router.get("/quote/:quoteIndex", function(req, res, next) {
	res.locals.quoteIndex = parseInt(req.params.quoteIndex);
	res.locals.btcQuotes = btcQuotes.items;

	if (btcQuotes.items[res.locals.quoteIndex].duplicateIndex) {
		const duplicateIndex = btcQuotes.items[res.locals.quoteIndex].duplicateIndex;

		res.redirect(`${config.baseUrl}quote/${duplicateIndex}`);

		return;
	}

	res.render("quote");

	next();
});

router.get("/bitcoin-whitepaper", function(req, res, next) {
	res.render("bitcoin-whitepaper");

	next();
});

router.get("/bitcoin.pdf", function(req, res, next) {
	// ref: https://bitcoin.stackexchange.com/questions/35959/how-is-the-whitepaper-decoded-from-the-blockchain-tx-with-1000x-m-of-n-multisi
	const whitepaperTxid = "54e48e5f5c656b26c3bca14a8c95aa583d07ebe84dde3b7dd4a78f4e4186e713";

	// get all outputs except the last 2 using `gettxout`
	Promise.all([...Array(946).keys()].map(vout => coreApi.getTxOut(whitepaperTxid, vout)))
	.then(function (vouts) {
		// concatenate all multisig pubkeys
		let pdfData = vouts.map((out, n) => {
			const parts = out.scriptPubKey.asm.split(" ")
			// the last output is a 1-of-1
			return n == 945 ? parts[1] : parts.slice(1,4).join('')
		}).join('')

		// strip size and checksum from start and null bytes at the end
		pdfData = pdfData.slice(16).slice(0, -16);

		const hexArray = utils.arrayFromHexString(pdfData);
		res.contentType("application/pdf");
		res.send(Buffer.alloc(hexArray.length, hexArray, "hex"));
	}).catch(function(err) {
		res.locals.userMessageMarkdown = `Failed to load transaction outputs: txid=**${whitepaperTxid}**`;

		res.locals.pageErrors.push(utils.logError("432907twhgeyedg", err));

		res.render("transaction");

		next();
	});
});

export = router;
