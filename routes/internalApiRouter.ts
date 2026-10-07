
import express from "express";
const router = express.Router();
import { Decimal } from "decimal.js";
import asyncHandler from "express-async-handler";

import * as utils from "../app/utils.js";
import { queryInt, queryString } from "../app/request.js";
import * as coreApi from "../app/api/coreApi.js";
import { blockRangeError, maxHeightListLength, maxTxidListLength, parseHeightList, parseTxidList } from "../app/helpers/limits.js";
import type { RpcData } from "../app/api/rpcApi.js";

// What a build leaves behind (its status and result) is dropped after an hour when nobody fetched it, so that builds
// that are started and never collected do not pile up in memory.
const keepBuildsMillis = 60 * 60 * 1000;

function expireLater(statusId: string, ...stores: Record<string, unknown>[]) {
	setTimeout(() => {
		for (const store of stores) {
			delete store[statusId];
		}
	}, keepBuildsMillis).unref();
}



router.get("/blocks-by-height/:blockHeights", function(req, res, next) {
	const blockHeights = parseHeightList(req.params.blockHeights);

	if (blockHeights == null) {
		res.status(400).json({success:false, error:"A list of at most " + maxHeightListLength + " block heights is needed."});

		return;
	}

	coreApi.getBlocksByHeight(blockHeights).then(function(result) {
		res.json(result);
	}).catch(next);
});

router.get("/block-headers-by-height/:blockHeights", function(req, res, next) {
	const blockHeights = parseHeightList(req.params.blockHeights);

	if (blockHeights == null) {
		res.status(400).json({success:false, error:"A list of at most " + maxHeightListLength + " block heights is needed."});

		return;
	}

	coreApi.getBlockHeadersByHeight(blockHeights).then(function(result) {
		res.json(result);

		next();
	});
});

router.get("/block-stats-by-height/:blockHeights", function(req, res, next) {
	const blockHeights = parseHeightList(req.params.blockHeights);

	if (blockHeights == null) {
		res.status(400).json({success:false, error:"A list of at most " + maxHeightListLength + " block heights is needed."});

		return;
	}

	coreApi.getBlocksStatsByHeight(blockHeights).then(function(result) {
		res.json(result);

		next();
	});
});

router.get("/mempool-txs/:txids", function(req, res, next) {
	const txids = parseTxidList(req.params.txids);

	if (txids == null) {
		res.status(400).json({success:false, error:"A list of at most " + maxTxidListLength + " transaction ids is needed."});

		return;
	}

	const promises = [];

	for (let i = 0; i < txids.length; i++) {
		promises.push(coreApi.getMempoolTxDetails(txids[i], false));
	}

	Promise.all(promises).then(function(results) {
		res.json(results);

		next();

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});



router.get("/difficulty-by-height/:blockHeights", asyncHandler(async (req, res, next) => {
	const blockHeights = req.params.blockHeights.split(",").map(x => parseInt(x));

	const results = await coreApi.getDifficultyByBlockHeights(blockHeights);
	
	res.json(results);

	next();
}));



const predictedBlocksStatuses = Object.create(null);
const predictedBlocksOutputs = Object.create(null);

router.get("/predicted-blocks-status", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");
	if (statusId && predictedBlocksStatuses[statusId]) {
		res.json(predictedBlocksStatuses[statusId]);

		next();

	} else {
		res.json({});

		next();
	}
}));

router.get("/get-predicted-blocks", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");

	if (statusId && predictedBlocksOutputs[statusId]) {
		const output = predictedBlocksOutputs[statusId];
		
		res.json(output);

		next();

		delete predictedBlocksOutputs[statusId];
		delete predictedBlocksStatuses[statusId];

	} else {
		res.json({});

		next();
	}
}));

router.get("/build-predicted-blocks", asyncHandler(async (req, res, next) => {
	try {
		// long timeout
		res.socket?.setTimeout(600000);


		const statusId = queryString(req.query, "statusId", "");
		if (statusId) {
			predictedBlocksStatuses[statusId] = {};
			expireLater(statusId, predictedBlocksOutputs, predictedBlocksStatuses);
		}

		res.json({success:true, status:"started"});

		next();


		const output = await coreApi.buildPredictedBlocks(statusId, (update) => {
			predictedBlocksStatuses[statusId] = update;
		});

		// store summary until it's retrieved via /api/get-mempool-summary
		predictedBlocksOutputs[statusId] = output;

	} catch (err) {
		utils.logError("329r7whegee", err);
	}
}));



const mempoolSummaryStatuses = Object.create(null);
const mempoolSummaries = Object.create(null);

router.get("/mempool-summary-status", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");
	if (statusId && mempoolSummaryStatuses[statusId]) {
		res.json(mempoolSummaryStatuses[statusId]);

		next();

	} else {
		res.json({});

		next();
	}
}));

router.get("/get-mempool-summary", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");

	if (statusId && mempoolSummaries[statusId]) {
		const summary = mempoolSummaries[statusId];
		
		res.json(summary);

		next();

		delete mempoolSummaries[statusId];
		delete mempoolSummaryStatuses[statusId];

	} else {
		res.writeHead(204);
		res.end("no summary for that id");

		next();
	}
}));

router.get("/build-mempool-summary", asyncHandler(async (req, res, next) => {
	try {
		// long timeout
		res.socket?.setTimeout(600000);


		const statusId = queryString(req.query, "statusId", "");
		if (statusId) {
			mempoolSummaryStatuses[statusId] = {};
			expireLater(statusId, mempoolSummaries, mempoolSummaryStatuses);
		}

		
		const ageBuckets = queryInt(req.query, "ageBuckets", 100);
		const sizeBuckets = queryInt(req.query, "sizeBuckets", 100);


		const summary = await coreApi.buildMempoolSummary(statusId, ageBuckets, sizeBuckets, (update) => {
			mempoolSummaryStatuses[statusId] = update;
		});

		// store summary until it's retrieved via /api/get-mempool-summary
		mempoolSummaries[statusId] = summary;


		res.json({success:true, status:"started"});

		next();

	} catch (err) {
		utils.logError("329r7whegee", err);
	}
}));




const miningSummaryStatuses = Object.create(null);
const miningSummaries = Object.create(null);

router.get("/mining-summary-status", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");
	if (statusId && miningSummaryStatuses[statusId]) {
		res.json(miningSummaryStatuses[statusId]);

		next();

	} else {
		res.json({});

		next();
	}
}));

router.get("/get-mining-summary", asyncHandler(async (req, res, next) => {
	const statusId = queryString(req.query, "statusId", "");

	if (statusId && miningSummaries[statusId]) {
		const summary = miningSummaries[statusId];
		
		res.json(summary);

		next();

		delete miningSummaries[statusId];
		delete miningSummaryStatuses[statusId];

	} else {
		res.writeHead(204);
		res.end("no summary for that id");

		next();
	}
}));

router.get("/build-mining-summary/:startBlock/:endBlock", asyncHandler(async (req, res, next) => {
	try {
		// long timeout
		res.socket?.setTimeout(600000);


		const startBlock = parseInt(req.params.startBlock);
		const endBlock = parseInt(req.params.endBlock);

		const rangeError = blockRangeError(startBlock, endBlock);

		if (rangeError) {
			res.status(400).json({success:false, error:rangeError});

			return;
		}

		const statusId = queryString(req.query, "statusId", "");
		if (statusId) {
			miningSummaryStatuses[statusId] = {};
			expireLater(statusId, miningSummaries, miningSummaryStatuses);
		}

		res.json({success:true, status:"started"});

		next();
		


		const summary = await coreApi.buildMiningSummary(statusId, startBlock, endBlock, (update) => {
			miningSummaryStatuses[statusId] = update;
		});

		// store summary until it's retrieved via /api/get-mining-summary
		miningSummaries[statusId] = summary;

	} catch (err) {
		utils.logError("4328943ryh44", err);
	}
}));






router.get("/mempool-tx-summaries/:txids", asyncHandler(async (req, res, next) => {
	try {
		const txids = req.params.txids.split(",").map(utils.asHash);

		const promises: Promise<void>[] = [];
		const results: RpcData[] = [];

		for (let i = 0; i < txids.length; i++) {
			const txid = txids[i];

			promises.push((async () => {
				try {
					const item = await coreApi.getMempoolTxDetails(txid, false);
					const itemSummary = {
						f: item.entry.fees.modified,
						sz: item.entry.vsize ? item.entry.vsize : item.entry.size,
						af: item.entry.fees.ancestor,
						df: item.entry.fees.descendant,
						dsz: item.entry.descendantsize,
						t: item.entry.time,
						w: item.entry.weight ? item.entry.weight : item.entry.size * 4
					};

					results.push(itemSummary);

				} catch (e) {
					utils.logError("38yereghee", e);

					// carry on anyway
				}
			})());
		}

		await Promise.all(promises);

		res.json(results);

		next();

	} catch (err) {
		res.json({success:false, error:err});

		next();
	}
}));

router.get("/raw-tx-with-inputs/:txid", function(req, res, next) {
	const txid = utils.asHash(req.params.txid);

	const promises = [];

	promises.push(coreApi.getRawTransactionsWithInputs([txid]));

	Promise.all(promises).then(function(results) {
		res.json(results);

		next();

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/block-tx-summaries/:blockHash/:blockHeight/:txids", function(req, res, next) {
	const blockHash = req.params.blockHash;
	const blockHeight = parseInt(req.params.blockHeight);
	const txids = parseTxidList(req.params.txids);

	if (txids == null) {
		res.status(400).json({success:false, error:"A list of at most " + maxTxidListLength + " transaction ids is needed."});

		return;
	}

	const promises = [];

	const results: RpcData[] = [];

	promises.push(new Promise<void>(function(resolve) {
		coreApi.buildBlockAnalysisData(blockHeight, blockHash, txids, 0, results, resolve);
	}));

	Promise.all(promises).then(function() {
		res.json(results);

		next();

	}).catch(function(err) {
		res.json({success:false, error:err});

		next();
	});
});

router.get("/utils/:func/:params", function(req, res, next) {
	const func = req.params.func;
	const params = req.params.params;

	let data = null;

	if (func == "formatLargeNumber") {
		if (params.indexOf(",") > -1) {
			const parts = params.split(",");

			data = utils.formatLargeNumber(parseInt(parts[0]), parseInt(parts[1]));

		} else {
			data = utils.formatLargeNumber(parseInt(params));
		}
	} else if (func == "formatCurrencyAmountInSmallestUnits") {
		const parts = params.split(",");

		data = utils.formatCurrencyAmountInSmallestUnits(new Decimal(parts[0]), parseInt(parts[1]));

	} else {
		data = {success:false, error:`Unknown function: ${func}`};
	}

	res.json(data);

	next();
});


export = router;
