import debug from "debug";
const debugLog = debug("btcexp:router");

import express from "express";
const router = express.Router();
import moment from "moment";
import * as bitcoinjs from "bitcoinjs-lib";
import sha256 from "crypto-js/sha256";
import hexEnc from "crypto-js/enc-hex";
import { bech32m } from "bech32";
import { Decimal } from "decimal.js";
import asyncHandler from "express-async-handler";
import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt();

import config from "../app/config.js";
import * as utils from "../app/utils.js";
import { queryInt, queryString } from "../app/request.js";
import * as coreApi from "../app/api/coreApi.js";
import * as addressApi from "../app/api/addressApi.js";
import * as xyzpubApi from "../app/api/xyzpubApi.js";
import apiDocs from "./../docs/api.js";
import btcQuotes from "../app/coins/btcQuotes.js";
import type { RpcData } from "../app/api/rpcApi.js";
import type { ExchangedCurrency } from "../app/helpers/currency.js";




router.get("/docs", function(req, res, next) {
	res.locals.apiDocs = apiDocs;
	res.locals.apiBaseUrl = apiDocs.baseUrl;
	res.locals.route = req.query.route;

	res.locals.categories = [];
	apiDocs.routes.forEach(x => {
		const category = x.category;

		if (!res.locals.categories.find((y: RpcData) => (y.name == category))) {
			res.locals.categories.push({name:category, items:[]});
		}

		res.locals.categories.find((x: RpcData) => (x.name == category)).items.push(x);
	});

	res.render("api-docs");

	next();
});

router.get("/changelog", function(req, res, next) {
	res.locals.changelogHtml = markdown.render(global.apiChangelogMarkdown);

	res.render("api-changelog");

	next();
});

router.get("/version", function(req, res, next) {
	res.send(apiDocs.version);

	next();
});






/// BLOCKS

router.get("/blocks/tip", asyncHandler(async (req, res, next) => {
	try {
		const getblockchaininfo = await coreApi.getBlockchainInfo();

		res.send({
			height: getblockchaininfo.blocks,
			hash: getblockchaininfo.bestblockhash
		});

	} catch (e) {
		utils.logError("a39gfoeuew", e);

		res.json({success: false});
	}

	next();
}));

// undocumented, old url
router.get("/blocks/tip/height", asyncHandler(async (req, res, next) => {
	try {
		const getblockchaininfo = await coreApi.getBlockchainInfo();

		res.send(String(getblockchaininfo.blocks));

	} catch (e) {
		utils.logError("234508ehede", e);

		res.json({success: false});
	}

	next();
}));

router.get("/block/:hashOrHeight", asyncHandler(async (req, res, next) => {
	const hashOrHeight = req.params.hashOrHeight;
	let hash: string = (hashOrHeight.length == 64 ? hashOrHeight : "");

	try {

		if (hash == "") {
			hash = await coreApi.getBlockHashByHeight(parseInt(hashOrHeight));
		}

		const block = await coreApi.getBlockByHash(hash);

		res.json(block);

	} catch (e) {
		utils.logError("w9fgeddsuos", e);

		res.json({success: false});
	}

	next();
}));

router.get("/block/header/:hashOrHeight", asyncHandler(async (req, res, next) => {
	const hashOrHeight = req.params.hashOrHeight;
	let hash: string = (hashOrHeight.length == 64 ? hashOrHeight : "");

	try {
		if (hash == "") {
			hash = await coreApi.getBlockHashByHeight(parseInt(hashOrHeight));
		}

		const block = await coreApi.getBlockHeaderByHash(hash);

		res.json(block);

	} catch (e) {
		utils.logError("w8kwqpoauns", e);

		res.json({success: false});
	}

	next();
}));




/// TRANSACTIONS

router.get("/tx/:txid", asyncHandler(async (req, res, next) => {
	const txid = utils.asHash(req.params.txid);
	const txInputLimit = (res.locals.crawlerBot) ? 3 : -1;

	try {
		const results = await coreApi.getRawTransactionsWithInputs([txid], txInputLimit);
		// a copy: the transaction can be the cached one (or the built-in genesis transaction), which must stay as it is
		const outJson = structuredClone(results.transactions[0]);
		const txInputs = results.txInputsByTransaction[txid] || {};
		
		let inputBtc = 0;
		if (txInputs[0]) {
			for (const key in txInputs) {
				const item = txInputs[key];
				inputBtc += item["value"] * global.coinConfig.baseCurrencyUnit.multiplier;
				outJson.vin[key].scriptSig.address = item.scriptPubKey.address;
				outJson.vin[key].scriptSig.type = item.scriptPubKey.type;
				outJson.vin[key].value = item.value;
			}
		}
		
		let outputBtc = 0;
		for (const key in outJson.vout) {	
			const item = outJson.vout[key];			
			outputBtc += item.value * global.coinConfig.baseCurrencyUnit.multiplier;
		}

		outJson.fee = {
			"amount": (inputBtc - outputBtc) / global.coinConfig.baseCurrencyUnit.multiplier,
			"unit": "BTC"
		};

		if (outJson.confirmations == null) {
			outJson.mempool = await coreApi.getMempoolTxDetails(txid, false);		
		} 

		if (global.specialTransactions && global.specialTransactions[txid]) {
			const funInfo = global.specialTransactions[txid];
			outJson.fun = funInfo;
		}
		
		res.json(outJson);
		
	} catch(err) {
		utils.logError("10328fwgdaqw", err);
		res.json({success:false, error:err});
	}
	
	next();

}));

router.get("/tx/volume/24h", function(req, res, next) {
	try {
		if (global.networkVolume && global.networkVolume.d1 && global.networkVolume.d1.amt) {
			const currencyValue = parseInt(global.networkVolume.d1.amt);

			res.json({"24h": currencyValue});

		} else {
			res.json({success:false, error: "Volume data not yet loaded."});
		}

		next();

	} catch (err) {
		utils.logError("39024y484", err);

		res.json({success:false, error:err});
		
		next();
	}
});


/// BLOCKCHAIN

router.get("/blockchain/coins", asyncHandler(async (req, res, next) => {
	if (global.utxoSetSummary) {
		const supply = parseFloat(global.utxoSetSummary.total_amount).toString();

		res.send({
			supply: supply.toString(),
			type: "calculated"
		});

		next();

	} else {
		// estimated supply

		const getblockchaininfo = await coreApi.getBlockchainInfo();
		const estimatedSupply = utils.estimatedSupply(getblockchaininfo.blocks);
		const lastCheckpoint = coinConfig.utxoSetCheckpointsByNetwork[global.activeBlockchain];

		res.send({
			supply: estimatedSupply.toString(),
			type: "estimated",
			lastCheckpointHeight: lastCheckpoint.height
		})

		next();
	}
}));

router.get("/blockchain/utxo-set", asyncHandler(async (req, res, next) => {
	const utxoSetSummary = await coreApi.getUtxoSetSummary(true, true);
	
	res.json(utxoSetSummary);

	next();
}));

router.get("/blockchain/next-halving", asyncHandler(async (req, res, next) => {
	try {
		const getblockchaininfo = await coreApi.getBlockchainInfo();

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
		}));

		promises.push(utils.timePromise("homepage.getBlocksByHeight", async () => {
			const latestBlocks = await coreApi.getBlocksByHeight(blockHeights);
			
			res.locals.latestBlocks = latestBlocks;
		}));

		await utils.awaitPromises(promises);


		const nextHalvingData = utils.nextHalvingEstimates(res.locals.difficultyPeriodFirstBlockHeader, res.locals.latestBlocks[0]);

		// timeAgo =  moment.duration(moment.utc(new Date()).diff(moment.utc(new Date())));
		const timeAgo = moment.duration(moment.utc(nextHalvingData.nextHalvingDate).diff(moment.utc(new Date())));
		const format = timeAgo.format();
		let formatParts = format.split(",").map(x => x.trim());
		formatParts = formatParts.map(x => { return x.startsWith("0 ") ? "" : x; }).filter(x => x.length > 0);

		res.json({
			nextHalvingIndex: nextHalvingData.nextHalvingIndex,
			nextHalvingBlock: nextHalvingData.nextHalvingBlock,
			nextHalvingSubsidy: coinConfig.blockRewardFunction(nextHalvingData.nextHalvingBlock, global.activeBlockchain),
			blocksUntilNextHalving: nextHalvingData.blocksUntilNextHalving,
			timeUntilNextHalving: formatParts.join(", "),
			nextHalvingEstimatedDate: nextHalvingData.nextHalvingDate,
		});

		next();

	} catch (e) {
		utils.logError("013923hege3", e)
		
		res.json({success:false});

		next();
	}
}));







/// ADDRESSES

// encountered huge volume of traffic requesting the balance for top address
// here, from many different ips, the below page leads me to believe the addresses
// are associated with malware and the public instance API is being abused to 
// aid the malware - block the requests
// ref: https://pberba.github.io/crypto/2024/09/14/malicious-browser-extension-genesis-market/
const blacklistedAddresses = [
	"bc1q4fkjqusxsgqzylcagra800cxljal82k6y3ejay",
	"bc1qvmvz53hdauzxuhs7dkm775tlqtd9vpk8ux7mqj",
	"bc1qtms60m4fxhp5v229kfxwd3xruu48c4a0tqwafu",
	"bc1qvkvzfla6wrem2uf4ejkuja8yp3c6f3xf72kyc9",
	"bc1qnxwt7sr3rqatd6efjyym3nsgxhslyzeqndhjpn"
];

router.get("/address/:address", asyncHandler(async (req, res, next) => {
	try {
		const address = utils.asAddress(req.params.address);

		if (blacklistedAddresses.includes(address)) {
			debugLog(`Blocking request: ip=${req.ip}, req=${req.originalUrl}`)
			res.status(418).json({
				message: "Teapot",
			});

			return;
		}

		const { perfId, perfResults } = utils.perfLogNewItem({action:"api.address"});
		res.locals.perfId = perfId;

		let limit = config.site.addressTxPageSize;
		let offset = 0;
		let sort = "desc";

		res.locals.maxTxOutputDisplayCount = config.site.addressPage.txOutputMaxDefaultDisplay;

		
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}

		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		if (req.query.sort) {
			sort = queryString(req.query, "sort", sort);
		}


		
		const result: RpcData = {};

		let addressEncoding = "unknown";


		if (address.match(/^[132mn].*$/)) {
			try {
				const base58Data = bitcoinjs.address.fromBase58Check(address);
				result.base58 = {hash:base58Data.hash.toString("hex"), version:base58Data.version};

				addressEncoding = "base58";

			} catch (err) {
				utils.logError("api.AddressParseError-001", err);
			}
		}

		if (addressEncoding == "unknown") {
			try {
				const bech32Data = bitcoinjs.address.fromBech32(address);
				result.bech32 = {data:bech32Data.data.toString("hex"), version:bech32Data.version};

				addressEncoding = "bech32";

			} catch (err) {
				utils.logError("api.AddressParseError-002", err);
			}
		}

		if (addressEncoding == "unknown") {
			try {
				const bech32mData = bech32m.decode(address);
				result.bech32m = {words:Buffer.from(bech32mData.words).toString("hex"), version:bech32mData.words[0]};

				addressEncoding = "bech32m";

			} catch (err) {
				utils.logError("api.AddressParseError-003", err);
			}
		}

		if (addressEncoding == "unknown") {
			res.json({success:false, error:"Invalid address"});

			next();

			return;
		}

		result.encoding = addressEncoding;

		result.notes = [];
		if (global.specialAddresses[address] && global.specialAddresses[address].type == "fun") {
			const funInfo = global.specialAddresses[address].addressInfo;

			result.notes.push(funInfo);
		}

		if (global.miningPoolsConfigs) {
			for (let i = 0; i < global.miningPoolsConfigs.length; i++) {
				if (global.miningPoolsConfigs[i].payout_addresses[address]) {
					const note = global.miningPoolsConfigs[i].payout_addresses[address];
					note.type = "payout address for miner";

					result.notes.push(note);

					break;
				}
			}
		}

		if (result.notes.length == 0) {
			delete result.notes;
		}



		const validateaddressResult = await coreApi.getAddress(address);
		result.validateaddress = validateaddressResult;

		const promises = [];

		let addrScripthash = hexEnc.stringify(sha256(hexEnc.parse(validateaddressResult.scriptPubKey)));
		addrScripthash = (addrScripthash.match(/.{2}/g) as string[]).reverse().join("");

		result.electrumScripthash = addrScripthash;

		promises.push(utils.timePromise("address.getAddressDetails", async () => {
			const addressDetailsResult = await addressApi.getAddressDetails(address, validateaddressResult.scriptPubKey, sort, limit, offset);

			const addressDetails = addressDetailsResult.addressDetails;

			result.txHistory = addressDetails;
			result.txHistory.request = {};
			result.txHistory.request.limit = limit;
			result.txHistory.request.offset = offset;
			result.txHistory.request.sort = sort;

			if (addressDetailsResult.errors && addressDetailsResult.errors.length > 0) {
				result.txHistory.errors = addressDetailsResult.errors;
			}
		}, perfResults));

		await utils.awaitPromises(promises);
		
		res.json(result);

		next();

	} catch (e) {
		utils.logError("a39ehudsudese", e);

		res.json({success:false});

		next();
	}
}));





/// XYZ PUBS

// redirect for an old path
router.get("/util/xyzpub/:extendedPubkey", asyncHandler(async (req, res) => {
	const extendedPubkey = req.params.extendedPubkey;
	
	res.redirect(`${req.baseUrl}/xyzpub/${extendedPubkey}`);
}));

router.get("/xyzpub/:extendedPubkey", asyncHandler(async (req, res, next) => {
	try {
		const extendedPubkey = req.params.extendedPubkey;
		res.locals.extendedPubkey = extendedPubkey;

		
		let limit = 20;
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}
		
		let offset = 0;
		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}

		



		const keyDetails = xyzpubApi.getKeyDetails(extendedPubkey);
		keyDetails.receiveAddresses = xyzpubApi.getXpubAddresses(extendedPubkey, 0, limit, offset);
		keyDetails.changeAddresses = xyzpubApi.getXpubAddresses(extendedPubkey, 1, limit, offset);


		res.json(keyDetails);

		next();

	} catch (err) {
		res.locals.pageErrors.push(utils.logError("0923tygdusde", err));

		next();
	}
}));

router.get("/xyzpub/txids/:extendedPubkey", asyncHandler(async (req, res, next) => {
	try {
		const extendedPubkey = req.params.extendedPubkey;

		let gapLimit = 20;
		if (req.query.gapLimit) {
			gapLimit = queryInt(req.query, "gapLimit", gapLimit);
		}

		let limit = -1;
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}
		
		const searchResult = await xyzpubApi.searchXpubTxids(extendedPubkey, gapLimit, limit);

		const result: { txids: string[], txCount: number } = {
			txids: [],
			txCount: 0
		};

		searchResult.usedAddresses.forEach(addrResult => {
			addrResult.txids.forEach(txid => {
				if (!result.txids.includes(txid)) {
					result.txids.push(txid);
					result.txCount++;
				}
			});
		})
		
		if (searchResult) {
			res.json(result);

		} else {
			res.json({success:false});
		}

		next();

	} catch (e) {
		utils.logError("382rdere", e);

		res.json({success:false, error: String(e)});

		next();
	}
}));

router.get("/xyzpub/addresses/:extendedPubkey", asyncHandler(async (req, res, next) => {
	try {
		const extendedPubkey = req.params.extendedPubkey;

		let receiveOrChange = 0;
		if (req.query.receiveOrChange) {
			receiveOrChange = queryInt(req.query, "receiveOrChange", receiveOrChange);
		}

		let limit = 10;
		if (req.query.limit) {
			limit = queryInt(req.query, "limit", limit);
		}

		let offset = 0;
		if (req.query.offset) {
			offset = queryInt(req.query, "offset", offset);
		}
		
		const xyzpubResult = await xyzpubApi.getXpubAddresses(extendedPubkey, receiveOrChange, limit, offset);
		
		if (xyzpubResult){
			res.json(xyzpubResult);

		} else {
			res.json({success:false});
		}

		next();
		
	} catch (e) {
		utils.logError("3297rwegee", e);

		res.json({success:false, error: String(e)});

		next();
	}
}));





/// MINING

router.get("/mining/hashrate", asyncHandler(async (req, res) => {
	try {
		let decimals = 3;

		if (req.query.decimals) {
			decimals = queryInt(req.query, "decimals", decimals);
		}

		const blocksPerDay = 24 * 60 * 60 / coinConfig.targetBlockTimeSeconds;
		const rates: (RpcData | null)[] = [];

		const timePeriods = [
			1 * blocksPerDay,
			7 * blocksPerDay,
			30 * blocksPerDay,
			90 * blocksPerDay,
			365 * blocksPerDay,
		];

		const promises: Promise<void>[] = [];

		for (let i = 0; i < timePeriods.length; i++) {
			const index = i;
			const x = timePeriods[i];

			promises.push((async () => {
				try {
					const hashrate = await coreApi.getNetworkHashrate(x);

					if (hashrate == null) {
						// the window reaches back before the BLAKE2b fork
						rates[index] = null;

						return;
					}

					const summary = utils.formatLargeNumber(hashrate, decimals);
					
					rates[index] = {
						val: summary[0].toNumber(),

						unit: `${summary[1].name}hash`,
						unitAbbreviation: `${summary[1].abbreviation}H`,
						unitExponent: summary[1].exponent,
						unitMultiplier: summary[1].val,

						raw: summary[0].toNumber() * summary[1].val,
						
						string1: `${summary[0]}x10^${summary[1].exponent}`,
						string2: `${summary[0]}e${summary[1].exponent}`,
						string3: `${(summary[0].toNumber() * summary[1].val).toLocaleString()}`
					};

				} catch (ex) {
					utils.logError("8ehfwe8ehe", ex);
				}
			})());
		}

		await Promise.all(promises);

		res.json({
			"1Day": rates[0],
			"7Day": rates[1],
			"30Day": rates[2],
			"90day": rates[3],
			"365Day": rates[4]
		});

	} catch (e) {
		utils.logError("23reuhd8uw92D", e);

		res.json({
			error: typeof(e) == "string" ? e : utils.stringifySimple(e as Record<string, unknown>)
		});
	}
}));

router.get("/mining/diff-adj-estimate", asyncHandler(async (req, res) => {
	const { perfId, perfResults } = utils.perfLogNewItem({action:"api.diff-adj-estimate"});
	res.locals.perfId = perfId;

	const promises: Promise<void>[] = [];
	const getblockchaininfo = await utils.timePromise("api_diffAdjEst_getBlockchainInfo", coreApi.getBlockchainInfo);
	let currentBlock: RpcData;
	const difficultyPeriod = Math.trunc(Math.floor(getblockchaininfo.blocks / coinConfig.difficultyAdjustmentBlockCount));
	let difficultyPeriodFirstBlockHeader: RpcData;
	
	promises.push(utils.timePromise("api.diff-adj-est.getBlockHeaderByHeight", async () => {
		currentBlock = await coreApi.getBlockHeaderByHeight(getblockchaininfo.blocks);
	}, perfResults));
	
	promises.push(utils.timePromise("api.diff-adj-est.getBlockHeaderByHeight2", async () => {
		const h = coinConfig.difficultyAdjustmentBlockCount * difficultyPeriod;
		difficultyPeriodFirstBlockHeader = await coreApi.getBlockHeaderByHeight(h);
	}, perfResults));

	await utils.awaitPromises(promises);
	
	const firstBlockHeader = difficultyPeriodFirstBlockHeader;
	const heightDiff = currentBlock.height - firstBlockHeader.height;
	const blockCount = heightDiff + 1;
	const dt = new Date().getTime() / 1000 - firstBlockHeader.time;
	const predictedBlockCount = dt / coinConfig.targetBlockTimeSeconds;

	let blockRatioPercent = new Decimal(blockCount / predictedBlockCount).times(100);
	if (blockRatioPercent.gt(400)) {
		blockRatioPercent = new Decimal(400);
	}
	if (blockRatioPercent.lt(25)) {
		blockRatioPercent = new Decimal(25);
	}
	
	let diffAdjPercent = new Decimal(0);
	if (predictedBlockCount > blockCount) {
		diffAdjPercent = new Decimal(100).minus(blockRatioPercent).times(-1);
		//diffAdjPercent = diffAdjPercent * -1;

	} else {
		diffAdjPercent = blockRatioPercent.minus(new Decimal(100));
	}
	
	res.send(diffAdjPercent.toFixed(2).toString());
}));

router.get("/mining/next-block", asyncHandler(async (req, res) => {
	const promises = [];

	const result: RpcData = {};

	promises.push(utils.timePromise("api/next-block/getblocktemplate", async () => {
		const nextBlockEstimate = await utils.timePromise("api/next-block/getNextBlockEstimate", async () => {
			return await coreApi.getNextBlockEstimate();
		});


		//result.blockTemplate = nextBlockEstimate.blockTemplate;
		//result.feeRateGroups = nextBlockEstimate.feeRateGroups;
		result.txCount = nextBlockEstimate.blockTemplate.transactions.length;

		result.minFeeRate = nextBlockEstimate.minFeeRate;
		result.maxFeeRate = nextBlockEstimate.maxFeeRate;
		result.minFeeTxid = nextBlockEstimate.minFeeTxid;
		result.maxFeeTxid = nextBlockEstimate.maxFeeTxid;

		result.totalFees = nextBlockEstimate.totalFees.toNumber();
	}));

	await utils.awaitPromises(promises);

	res.json(result);
}));

router.get("/mining/next-block/txids", asyncHandler(async (req, res) => {
	const promises = [];

	const txids: string[] = [];

	promises.push(utils.timePromise("api/next-block/getblocktemplate", async () => {
		const nextBlockEstimate = await utils.timePromise("api/next-block/getNextBlockEstimate", async () => {
			return await coreApi.getNextBlockEstimate();
		});

		nextBlockEstimate.blockTemplate.transactions.forEach((x: RpcData) => {
			txids.push(x.txid);
		});
	}));

	await utils.awaitPromises(promises);

	res.json(txids);
}));

router.get("/mining/next-block/includes/:txid", asyncHandler(async (req, res) => {
	const txid = req.params.txid;

	const promises = [];

	let txidIndex = -1;
	let txCount = -1;

	promises.push(utils.timePromise("api/next-block/getblocktemplate", async () => {
		const nextBlockEstimate = await utils.timePromise("api/next-block/getNextBlockEstimate", async () => {
			return await coreApi.getNextBlockEstimate();
		});

		txCount = nextBlockEstimate.blockTemplate.transactions.length;

		for (let i = 0; i < nextBlockEstimate.blockTemplate.transactions.length; i++) {
			if (nextBlockEstimate.blockTemplate.transactions[i].txid == txid) {
				txidIndex = i;

				return;
			}
		}
	}));

	await utils.awaitPromises(promises);

	const response: RpcData = {included:(txidIndex >= 0)};
	if (txidIndex >= 0) {
		response.index = txidIndex;
		response.txCount = txCount;
	}

	res.json(response);
}));

router.get("/mining/miner-summary", asyncHandler(async (req, res) => {
	let startHeight = -1;
	let endHeight = -1;

	if (req.query.since) {
		const regex = /^([0-9]+)d$/;
		const match = (queryString(req.query, "since") as string).match(regex);

		if (match) {
			const days = parseInt(match[1]);
			const getblockchaininfo = await coreApi.getBlockchainInfo();

			startHeight = getblockchaininfo.blocks - 144 * days;
			endHeight = getblockchaininfo.blocks;
		}
	} else if (req.query.startHeight && req.query.endHeight) {
		startHeight = queryInt(req.query, "startHeight", startHeight);
		endHeight = queryInt(req.query, "endHeight", endHeight);
	}

	if (startHeight == -1 || endHeight == -1) {
		res.json({success:false, error:"Unknown start or end height - use either 'since' (e.g. 'since=7d') or 'startHeight'+'endHeight' parameters to specify the blocks to analyze."});

		return;
	}

	const summary = await coreApi.buildMiningSummary(null, startHeight, endHeight, null);

	res.json(summary);
}));





/// MEMPOOL

router.get("/mempool/summary", function(req, res, next) {
	coreApi.getMempoolInfo().then(function(info){
		res.json(info);
	}).catch(next);
});

router.get("/mempool/fees", asyncHandler(async (req, res) => {
	const feeConfTargets = [1, 3, 6, 144];	
	const rawSmartFeeEstimates = await coreApi.getSmartFeeEstimates("CONSERVATIVE", feeConfTargets);
	const smartFeeEstimates: RpcData = {};
	
	for (let i = 0; i < feeConfTargets.length; i++) {
		const rawSmartFeeEstimate = rawSmartFeeEstimates[i];
		if (rawSmartFeeEstimate.errors) {
			smartFeeEstimates[feeConfTargets[i]] = "?";
		} else {
			smartFeeEstimates[feeConfTargets[i]] = new Decimal(rawSmartFeeEstimate.feerate).times(coinConfig.baseCurrencyUnit.multiplier).dividedBy(1000).trunc().toNumber();
		}
	}		
		
	const results: RpcData = {
		"nextBlock":{"smart":smartFeeEstimates[1]},
		"30min":smartFeeEstimates[3],
		"60min":smartFeeEstimates[6],
		"1day":smartFeeEstimates[144]
	};

	// the node can be unable to give a block template (it is busy, or still syncing): the estimates of the fee
	// rates of the next block are left out then, and the smart estimates are still answered
	try {
		const nextBlockEstimate = await coreApi.getNextBlockEstimate();

		if (nextBlockEstimate != undefined && nextBlockEstimate.minFeeRate != undefined) {
			results.nextBlock.min = Math.trunc(nextBlockEstimate.minFeeRate);
			results.nextBlock.max = Math.trunc(nextBlockEstimate.maxFeeRate);
			results.nextBlock.median = Math.trunc(nextBlockEstimate.medianFeeRate);
		}

	} catch (err) {
		utils.logError("apiMempoolFeesNextBlock", err);
	}

	res.json(results);
}));







/// PRICE

const supportedCurrencies = ["usd", "eur", "gbp", "xau"];

router.get("/price/sats", function(req, res, next) {
	const result: RpcData = {};
	const amount = 1.0;

	if (!global.exchangeRates) {
		result.success = false;
		result.error = "You have exchange-rate requests disabled (this is the default state; in your server configuration, you must set BTCEXP_NO_RATES to 'false', and ensure that BTCEXP_PRIVACY_MODE is also still its default value of 'false')"
	}

	supportedCurrencies.forEach(currency => {
		if (global.exchangeRates != null && global.exchangeRates[currency] != null) {
			const satsRateData = utils.satoshisPerUnitOfLocalCurrency(currency);
			result[currency] = (satsRateData as { amtRaw: number }).amtRaw;

		} else if (currency == "xau" && global.exchangeRates != null && global.goldExchangeRates != null) {
			let dec = new Decimal(amount);
			dec = dec.times(global.exchangeRates.usd).dividedBy(global.goldExchangeRates.usd);
			const satCurrencyType = global.currencyTypes["sat"];
			const one = new Decimal(1);
			dec = one.dividedBy(dec);
			dec = dec.times(satCurrencyType.multiplier);
			
			result[currency] = dec.toFixed(0);
		}
	});
	
	res.json(result);

	next();
});

router.get("/price/marketcap", function(req, res, next) {
	if (!global.exchangeRates) {
		res.json({
			success: false,
			error: "You have exchange-rate requests disabled (this is the default state; in your server configuration, you must set BTCEXP_NO_RATES to 'false', and ensure that BTCEXP_PRIVACY_MODE is also still its default value of 'false')"
		});

		return next();
	}

	coreApi.getBlockchainInfo().then(function(getblockchaininfo){
		const estimatedSupply = utils.estimatedSupply(getblockchaininfo.blocks);
		let price = 0;

		const amount = 1.0;
		const result: RpcData = {};

		supportedCurrencies.forEach(currency => {
			if (global.exchangeRates != null && global.exchangeRates[currency] != null) {
				// (there is a rate for this currency, so there is something to format)
				const formatData = utils.formatExchangedCurrency(amount, currency) as ExchangedCurrency;
				price = Number(parseFloat(formatData.valRaw).toFixed(2));

			} else if (currency == "xau" && global.exchangeRates != null && global.goldExchangeRates != null) {
				let dec = new Decimal(amount);
				dec = dec.times(global.exchangeRates.usd).dividedBy(global.goldExchangeRates.usd);
				const exchangedAmt = Number(Math.round(dec.toNumber() * 100) / 100).toFixed(2);
				price = Number(exchangedAmt);
			}
		
			result[currency] = estimatedSupply.toNumber() * price;
		});

		res.json(result);

		next();

	}).catch(next);
});

router.get("/price", function(req, res, next) {
	const amount = 1.0;
	const result: RpcData = {};
	const format = (req.query.format == "true");

	if (!global.exchangeRates) {
		result.success = false;
		result.error = "You have exchange-rate requests disabled (this is the default state; in your server configuration, you must set BTCEXP_NO_RATES to 'false', and ensure that BTCEXP_PRIVACY_MODE is also still its default value of 'false')"
	}
	
	supportedCurrencies.forEach(currency => {
		if (global.exchangeRates != null && global.exchangeRates[currency] != null) {
			// (there is a rate for this currency, so there is something to format)
				const formatData = utils.formatExchangedCurrency(amount, currency) as ExchangedCurrency;

			if (format) {
				result[currency] = formatData.val;

			} else {
				result[currency] = formatData.valRaw;
			}
		} else if (currency == "xau" && global.exchangeRates != null && global.goldExchangeRates != null) {
			let dec = new Decimal(amount);
			dec = dec.times(global.exchangeRates.usd).dividedBy(global.goldExchangeRates.usd);
			const exchangedAmt = Number(Math.round(dec.toNumber() * 100) / 100).toFixed(2);
			result[currency] = utils.addThousandsSeparators(exchangedAmt);
		}
	});
	
	
	res.json(result);

	next();
});




/// FUN

router.get("/quotes/random", function(req, res, next) {

	let quote = null;
	let done = false;

	while (!done) {
		const quoteIndex = utils.randomInt(0, btcQuotes.items.length);
		quote = btcQuotes.items[quoteIndex];

		done = !utils.objHasProperty(quote, "duplicateIndex");
	}
	
	res.json(quote);

	next();
});

router.get("/quotes/all", function(req, res, next) {
	res.json(btcQuotes.items);

	next();
});

router.get("/quotes/:quoteIndex", function(req, res, next) {
	if (!req.params.quoteIndex.match(/\d+/)) {
		return;
	}

	const index = parseInt(req.params.quoteIndex);
	
	res.json(btcQuotes.items[index]);

	next();
});

router.get("/holidays/all", function(req, res, next) {
	res.json(global.btcHolidays.sortedItems);

	next();
});

router.get("/holidays/today", function(req, res, next) {
	let momentObj = moment.utc(new Date());
	if (req.query.tzOffset) {
		momentObj = momentObj.add(queryInt(req.query, "tzOffset", 0), "hours")
	}

	const day = momentObj.format("MM-DD");
	if (global.btcHolidays.byDay[day]) {
		res.json({day: day, holidays: global.btcHolidays.byDay[day]});

	} else {
		res.json({day: day, holidays: []});
	}

	next();
});

router.get("/holidays/:day", function(req, res, next) {
	if (!req.params.day.match(/^(\d{4}-)?\d{2}-\d{2}$/)) {
		return;
	}

	let day = req.params.day;

	if (req.params.day.match(/^\d{4}-\d{2}-\d{2}$/)) {
		// strip off year
		day = day.substring(5);

	} else if (req.params.day.match(/^\d{2}-\d{2}$/)) {
		// already correct format
	}
	
	if (global.btcHolidays.byDay[day]) {
		res.json({day: day, holidays: global.btcHolidays.byDay[day]});

	} else {
		res.json({day: day, holidays: []});
	}

	next();
});


export = router;
