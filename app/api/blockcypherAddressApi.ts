import axios from "axios";
import { logError } from "../helpers/errors.js";
import type { AddressDetails, AddressDetailsResult } from "./addressDetails.js";

export async function getAddressDetails(address: string, scriptPubkey: string, sort: string, limit: number, offset: number): Promise<AddressDetailsResult> {
	if (address.startsWith("bc1")) {
		throw {userText:"blockcypher.com API does not support bc1 (native Segwit) addresses"};
	}

	const limitOffset = limit + offset;
	const mainnetUrl = `https://api.blockcypher.com/v1/btc/main/addrs/${address}?limit=${limitOffset}`;
	const testnetUrl = `https://api.blockcypher.com/v1/btc/test3/addrs/${address}?limit=${limitOffset}`;
	const url = (global.activeBlockchain == "main") ? mainnetUrl : ((global.activeBlockchain == "test") ? testnetUrl : mainnetUrl);

	try {
		const apiResponse = await axios.get(
			url,
			{ headers: { "User-Agent": "axios" }});

		const blockcypherJson = apiResponse.data;

		const response: AddressDetails = {};

		response.txids = [];
		response.blockHeightsByTxid = {};

		// blockcypher doesn't support offset for paging, so simulate up to the hard cap of 2,000
		for (let i = offset; i < Math.min(blockcypherJson.txrefs.length, limitOffset); i++) {
			const tx = blockcypherJson.txrefs[i];

			response.txids.push(tx.tx_hash);
			response.blockHeightsByTxid[tx.tx_hash] = tx.block_height;
		}

		response.txCount = blockcypherJson.n_tx;
		response.totalReceivedSat = blockcypherJson.total_received;
		response.totalSentSat = blockcypherJson.total_sent;
		response.balanceSat = blockcypherJson.final_balance;
		response.source = "blockcypher.com";

		return {addressDetails:response};

	} catch (err) {
		logError("097wef0adsgadgs", err);

		throw err;
	}
}
