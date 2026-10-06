
import express from "express";
const router = express.Router();
import asyncHandler from "express-async-handler";

import * as utils from "../app/utils.js";
import * as coreApi from "../app/api/coreApi.js";
import type { RpcData } from "../app/api/rpcApi.js";


router.get("/tx-display", asyncHandler(async (req, res, next) => {
	res.locals.transactions = [];
	res.locals.txInputsByTransaction = {};
	res.locals.blockHeightsByTxid = {};

	const txidOrder: string[] = [];

	const promises = [];
	for (const [txid, data] of Object.entries(global.coinConfig.testData.txDisplayTestList) as [string, RpcData][]) {
		txidOrder.push(txid);

		const blockHash = data.blockHash;

		res.locals.blockHeightsByTxid[txid] = data.blockHeight;

		promises.push(utils.timePromise("test.tx-display.getRawTransactionsWithInputs", async () => {
			const transactionData = await coreApi.getRawTransactionsWithInputs([txid], 5, blockHash);

			res.locals.transactions.push(transactionData.transactions[0]);

			for (const [resultTxid, resultData] of Object.entries(transactionData.txInputsByTransaction)) {
				res.locals.txInputsByTransaction[resultTxid] = resultData;
			}
			//console.log(JSON.stringify(transactionData.txInputsByTransaction));
		}));
	}

	res.locals.maxTxOutputDisplayCount = 12;

	// todo: include a random mempool tx

	await Promise.all(promises);

	res.locals.transactions.sort((a: RpcData, b: RpcData) => {
		return txidOrder.indexOf(a.txid) - txidOrder.indexOf(b.txid);
	});

	res.render("test/tx-display.pug");

	next();
}));

export = router;
