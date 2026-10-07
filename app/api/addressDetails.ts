import type { ServerConflict } from "./electrumConsensus.js";

// What an address API knows about an address. Which fields are set depends on the API.
export interface AddressDetails {
	// the page sets zero values to the string "0", so that they pass the falsy check in the template
	txCount?: number | string,
	txids?: string[],
	blockHeightsByTxid?: Record<string, number>,
	hash160?: string,
	balanceSat?: number | string,
	unconfirmedBalanceSat?: number,
	totalReceivedSat?: number,
	totalSentSat?: number,
	source?: string
}

export interface AddressDetailsResult {
	addressDetails: AddressDetails | null,
	errors?: unknown[],
	// set when several Electrum servers gave different answers
	conflicts?: ServerConflict[]
}

// Every address API has this signature. They reject with {userText} (or an Error) when they cannot answer.
export type GetAddressDetails = (address: string, scriptPubkey: string, sort: string, limit: number, offset: number) => Promise<AddressDetailsResult>;
