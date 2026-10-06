
import express from "express";
const router = express.Router();
import asyncHandler from "express-async-handler";

import * as utils from "../app/utils.js";
import config from "../app/config.js";
import type { Request } from "express";



function logUrlError(req: Request, type: string) {
	const userAgent = req.headers['user-agent'];

	utils.logError(`DoubleUrl`, null, {"type": type, "userAgent":userAgent}, false);
}



router.get("/block/block/:blockHash", asyncHandler(async (req, res) => {
	logUrlError(req, "block/block");

	res.redirect(301, `${config.baseUrl}block/${req.params.blockHash}`);

	return;
}));

router.get("/block/address/:address", asyncHandler(async (req, res) => {
	logUrlError(req, "block/address");

	res.redirect(301, `${config.baseUrl}address/${req.params.address}`);

	return;
}));

router.get("/block/tx/:txid", asyncHandler(async (req, res) => {
	logUrlError(req, "block/tx");

	res.redirect(301, `${config.baseUrl}tx/${req.params.txid}`);

	return;
}));





router.get("/tx/tx/:transactionId", asyncHandler(async (req, res) => {
	logUrlError(req, "tx/tx");

	res.redirect(301, `${config.baseUrl}tx/${req.params.transactionId}`);

	return;
}));

router.get("/tx/block/:blockHash", asyncHandler(async (req, res) => {
	logUrlError(req, "block/tx");

	res.redirect(301, `${config.baseUrl}block/${req.params.blockHash}`);

	return;
}));






router.get("/block-height/address/:address", asyncHandler(async (req, res) => {
	logUrlError(req, "block-height/address");

	res.redirect(301, `${config.baseUrl}address/${req.params.address}`);

	return;
}));

router.get("/block-height/tx/:txid", asyncHandler(async (req, res) => {
	logUrlError(req, "block-height/tx");

	res.redirect(301, `${config.baseUrl}tx/${req.params.txid}`);

	return;
}));

router.get("/block-height/block-height/:blockHeight", asyncHandler(async (req, res) => {
	logUrlError(req, "block-height/block-height");

	res.redirect(301, `${config.baseUrl}block-height/${req.params.blockHeight}`);

	return;
}));



export = router;
