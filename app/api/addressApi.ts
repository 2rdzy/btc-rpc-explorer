import config from "../config.js";
import * as electrumAddressApi from "./electrumAddressApi.js";
import * as blockchainAddressApi from "./blockchainAddressApi.js";
import * as blockchairAddressApi from "./blockchairAddressApi.js";
import * as blockcypherAddressApi from "./blockcypherAddressApi.js";
import type { AddressDetailsResult } from "./addressDetails.js";

export function getSupportedAddressApis(): string[] {
	return ["blockchain.com", "blockchair.com", "blockcypher.com", "electrum", "electrumx"];
}

export interface AddressApiFeatureSupport {
	pageNumbers: boolean,
	sortDesc: boolean,
	sortAsc: boolean
}

// What the configured address API can do: undefined when none is configured.
export function getCurrentAddressApiFeatureSupport(): AddressApiFeatureSupport | undefined {
	if (config.addressApi == "blockchain.com") {
		return {
			pageNumbers: true,
			sortDesc: true,
			sortAsc: true
		};

	} else if (config.addressApi == "blockchair.com") {
		return {
			pageNumbers: true,
			sortDesc: true,
			sortAsc: false
		};

	} else if (config.addressApi == "blockcypher.com") {
		return {
			pageNumbers: true,
			sortDesc: true,
			sortAsc: false
		};

	} else if (config.addressApi == "electrum" || config.addressApi == "electrumx") {
		return {
			pageNumbers: true,
			sortDesc: true,
			sortAsc: true
		};
	}
}

// Asks the configured address API for the address's transactions and balance.
export async function getAddressDetails(address: string, scriptPubkey: string, sort: string, limit: number, offset: number): Promise<AddressDetailsResult> {
	if (config.addressApi == "blockchain.com") {
		return await blockchainAddressApi.getAddressDetails(address, scriptPubkey, sort, limit, offset);

	} else if (config.addressApi == "blockchair.com") {
		return await blockchairAddressApi.getAddressDetails(address, scriptPubkey, sort, limit, offset);

	} else if (config.addressApi == "blockcypher.com") {
		return await blockcypherAddressApi.getAddressDetails(address, scriptPubkey, sort, limit, offset);

	} else if (config.addressApi == "electrum" || config.addressApi == "electrumx") {
		return await electrumAddressApi.getAddressDetails(address, scriptPubkey, sort, limit, offset);
	}

	return {addressDetails:null, errors:["No address API configured"]};
}
