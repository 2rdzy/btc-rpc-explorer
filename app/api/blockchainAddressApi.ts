import axios from "axios";
import { logError } from "../helpers/errors.js";
import type { AddressDetails, AddressDetailsResult } from "./addressDetails.js";

export async function getAddressDetails(address: string, scriptPubkey: string, sort: string, limit: number, offset: number): Promise<AddressDetailsResult> {
	if (address.startsWith("bc1")) {
		throw {userText:"blockchain.com API does not support bc1 (native Segwit) addresses"};
	}

	if (sort == "asc") {
		// need to query the total number of tx first, then build paging info from that value
		let dynamicOffset: number;

		try {
			const response = await axios.get(
				`https://blockchain.info/rawaddr/${address}?limit=1`,
				{ headers: { 'User-Agent': 'axios' }});

			const txCount = response.data.n_tx;

			dynamicOffset = txCount - limit - offset;
			if (dynamicOffset < 0) {
				limit += dynamicOffset;
				dynamicOffset += limit;
			}
		} catch (err) {
			logError("we0f8hasd0fhas", err);

			throw err;
		}

		try {
			const result = await getAddressDetailsSortDesc(address, limit, dynamicOffset);

			(result.txids as string[]).reverse();

			return {addressDetails:result};

		} catch (err) {
			logError("2308hsghse", err);

			throw err;
		}
	} else {
		try {
			const result = await getAddressDetailsSortDesc(address, limit, offset);

			return {addressDetails:result};

		} catch (err) {
			logError("3208hwssse", err);

			throw err;
		}
	}
}

async function getAddressDetailsSortDesc(address: string, limit: number, offset: number): Promise<AddressDetails> {
	try {
		const apiResponse = await axios.get(
			`https://blockchain.info/rawaddr/${address}?limit=${limit}&offset=${offset}`,
			{ headers: { 'User-Agent': 'axios' }});

		const blockchainJson = apiResponse.data;

		const response: AddressDetails = {};

		response.txids = [];
		response.blockHeightsByTxid = {};
		blockchainJson.txs.forEach(function(tx: { hash: string, block_height: number }) {
			(response.txids as string[]).push(tx.hash);
			(response.blockHeightsByTxid as Record<string, number>)[tx.hash] = tx.block_height;
		});

		response.txCount = blockchainJson.n_tx;
		response.hash160 = blockchainJson.hash160;
		response.totalReceivedSat = blockchainJson.total_received;
		response.totalSentSat = blockchainJson.total_sent;
		response.balanceSat = blockchainJson.final_balance;
		response.source = "blockchain.com";

		return response;

	} catch (err) {
		logError("32907shsghs", err);

		throw err;
	}
}
