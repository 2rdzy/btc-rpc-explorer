import axios from "axios";
import { logError } from "../helpers/errors.js";
import type { AddressDetails, AddressDetailsResult } from "./addressDetails.js";

export async function getAddressDetails(address: string, scriptPubkey: string, sort: string, limit: number, offset: number): Promise<AddressDetailsResult> {
	// Note: blockchair api seems to not respect the limit parameter, always using 100
	const mainnetUrl = `https://api.blockchair.com/bitcoin/dashboards/address/${address}/?offset=${offset}`;
	const testnetUrl = `https://api.blockchair.com/bitcoin/testnet/dashboards/address/${address}/?offset=${offset}`;
	const url = (global.activeBlockchain == "main") ? mainnetUrl : ((global.activeBlockchain == "test") ? testnetUrl : mainnetUrl);

	try {
		const response = await axios.get(
			url,
			{ headers: { "User-Agent": "axios" }});

		const responseObj = response.data.data[address];

		const result: AddressDetails = {};

		result.txids = [];

		// blockchair doesn't support offset for paging, so simulate up to the hard cap of 2,000
		for (let i = 0; i < Math.min(responseObj.transactions.length, limit); i++) {
			result.txids.push(responseObj.transactions[i]);
		}

		result.txCount = responseObj.address.transaction_count;
		result.totalReceivedSat = responseObj.address.received;
		result.totalSentSat = responseObj.address.spent;
		result.balanceSat = responseObj.address.balance;
		result.source = "blockchair.com";

		return {addressDetails:result};

	} catch (err) {
		logError("308dhew3w83", err);

		throw err;
	}
}
