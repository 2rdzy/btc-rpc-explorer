import { xpubChangeVersionBytes, bip32Addresses } from "../helpers/addresses.js";
import * as coreApi from "./coreApi.js";
import * as addressApi from "./addressApi.js";
import { maxXpubAddresses, maxXpubGapLimit } from "../helpers/limits.js";

export interface RelatedKey {
	keyType: string,
	key: string,
	outputType: string,
	firstAddress: string
}

export interface KeyDetails {
	keyType: string,
	relatedKeys: RelatedKey[],
	outputType?: string,
	outputTypeDesc?: string,
	bip32Path?: string,
	// added by the API route
	receiveAddresses?: string[],
	changeAddresses?: string[]
}



// What kind of key an extended public key is, and the same key in the other formats, with the first address of each.
export function getKeyDetails(extendedPubkey: string): KeyDetails {
	const keyDetails: KeyDetails = {
		keyType: extendedPubkey.substring(0, 4),
		relatedKeys: []
	};

	// if xpub/ypub/zpub convert to address under path m/0/0
	if (extendedPubkey.match(/^(xpub|tpub).*$/)) {
		keyDetails.outputType = "P2PKH";
		keyDetails.outputTypeDesc = "Pay to Public Key Hash";
		keyDetails.bip32Path = "m/44'/0'";

		const xpub_tpub = global.activeBlockchain == "main" ? "xpub" : "tpub";
		const ypub_upub = global.activeBlockchain == "main" ? "ypub" : "upub";
		const zpub_vpub = global.activeBlockchain == "main" ? "zpub" : "vpub";

		let xpub = extendedPubkey;
		if (!extendedPubkey.startsWith(xpub_tpub)) {
			xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);
		}

		if (!extendedPubkey.startsWith(xpub_tpub)) {
			keyDetails.relatedKeys.push({
				keyType: xpub_tpub,
				key: xpubChangeVersionBytes(xpub, xpub_tpub),
				outputType: "P2PKH",
				firstAddress: bip32Addresses(xpub, "p2pkh", 0, 1, 0)[0]
			});
		}

		keyDetails.relatedKeys.push({
			keyType: ypub_upub,
			key: xpubChangeVersionBytes(xpub, ypub_upub),
			outputType: "P2WPKH in P2SH",
			firstAddress: bip32Addresses(xpub, "p2sh(p2wpkh)", 0, 1, 0)[0]
		});

		keyDetails.relatedKeys.push({
			keyType: zpub_vpub,
			key: xpubChangeVersionBytes(xpub, zpub_vpub),
			outputType: "P2WPKH",
			firstAddress: bip32Addresses(xpub, "p2wpkh", 0, 1, 0)[0]
		});

	} else if (extendedPubkey.match(/^(ypub|upub).*$/)) {
		keyDetails.outputType = "P2WPKH in P2SH";
		keyDetails.outputTypeDesc = "Pay to Witness Public Key Hash (P2WPKH) wrapped inside Pay to Script Hash (P2SH), aka Wrapped Segwit";
		keyDetails.bip32Path = "m/49'/0'";

		const xpub_tpub = global.activeBlockchain == "main" ? "xpub" : "tpub";
		const zpub_vpub = global.activeBlockchain == "main" ? "zpub" : "vpub";

		const xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

		keyDetails.relatedKeys.push({
			keyType: xpub_tpub,
			key: xpub,
			outputType: "P2PKH",
			firstAddress: bip32Addresses(xpub, "p2pkh", 0, 1, 0)[0]
		});

		keyDetails.relatedKeys.push({
			keyType: zpub_vpub,
			key: xpubChangeVersionBytes(xpub, zpub_vpub),
			outputType: "P2WPKH",
			firstAddress: bip32Addresses(xpub, "p2wpkh", 0, 1, 0)[0]
		});

	} else if (extendedPubkey.match(/^(zpub|vpub).*$/)) {
		keyDetails.outputType = "P2WPKH";
		keyDetails.outputTypeDesc = "Pay to Witness Public Key Hash, aka Native Segwit";
		keyDetails.bip32Path = "m/84'/0'";

		const xpub_tpub = global.activeBlockchain == "main" ? "xpub" : "tpub";
		const ypub_upub = global.activeBlockchain == "main" ? "ypub" : "upub";

		const xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

		keyDetails.relatedKeys.push({
			keyType: xpub_tpub,
			key: xpub,
			outputType: "P2PKH",
			firstAddress: bip32Addresses(xpub, "p2pkh", 0, 1, 0)[0]
		});

		keyDetails.relatedKeys.push({
			keyType: ypub_upub,
			key: xpubChangeVersionBytes(xpub, ypub_upub),
			outputType: "P2WPKH in P2SH",
			firstAddress: bip32Addresses(xpub, "p2sh(p2wpkh)", 0, 1, 0)[0]
		});

	} else if (extendedPubkey.startsWith("Ypub")) {
		keyDetails.outputType = "Multi-Sig P2WSH in P2SH";
		keyDetails.bip32Path = "-";

	} else if (extendedPubkey.startsWith("Zpub")) {
		keyDetails.outputType = "Multi-Sig P2WSH";
		keyDetails.bip32Path = "-";
	}

	return keyDetails;
}


// 0 is receive
// 1 is change
export function getXpubAddresses(extendedPubkey: string, receiveOrChange = 0, limit = 20, offset = 0): string[] {
	limit = Math.min(limit, maxXpubAddresses);

	const xpub_tpub = global.activeBlockchain == "main" ? "xpub" : "tpub";
	// if xpub/ypub/zpub convert to address under path m/0/0
	if (extendedPubkey.match(/^(xpub|tpub).*$/)) {
		let xpub = extendedPubkey;

		if (!extendedPubkey.startsWith(xpub_tpub)) {
			xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);
		}

		return bip32Addresses(xpub, "p2pkh", receiveOrChange, limit, offset);

	} else if (extendedPubkey.match(/^(ypub|upub).*$/)) {
		const xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

		return bip32Addresses(xpub, "p2sh(p2wpkh)", receiveOrChange, limit, offset);

	} else if (extendedPubkey.match(/^(zpub|vpub).*$/)) {
		const xpub = xpubChangeVersionBytes(extendedPubkey, xpub_tpub);

		return bip32Addresses(xpub, "p2wpkh", receiveOrChange, limit, offset);
	}

	return [];
}


export interface UsedAddress {
	addressIndex: number,
	address: string,
	type: string,
	txids: string[],
	priorGap: number
}

export interface XpubSearchResult {
	usedAddresses: UsedAddress[],
	emptyAddresses: { receive: string[], change: string[] }
}

// The addresses of an xpub that have transactions, and the empty ones after the last used one.
// gapLimit=20, default as per bip32
export async function searchXpubTxids(extendedPubkey: string, gapLimit = 20, addressLimit = -1): Promise<XpubSearchResult> {
	gapLimit = Math.min(gapLimit, maxXpubGapLimit);
	addressLimit = addressLimit == -1 ? -1 : Math.min(addressLimit, maxXpubAddresses);

	// addressLimit == -1 means we get every address with a transaction and 20 addresses gap at the end. 	
	const sort = "desc";
	
	const txLimit = 20;
	let txOffset = 0;
	let addressCount = 0;
	const gapCounts: Record<number, number> = {0: 0, 1: 0};
	const result: XpubSearchResult = {
		usedAddresses: [],
		emptyAddresses: {
			receive: [],
			change: []
		}
	};

	while ((addressCount < addressLimit) || addressLimit == -1) {
		for (let receiveOrChange = 0; receiveOrChange <= 1; receiveOrChange++) {
			if (gapCounts[receiveOrChange] < gapLimit) {
				txOffset = 0;

				const address = getXpubAddresses(extendedPubkey, receiveOrChange, 1, addressCount)[0];
				const getAddressResult = await coreApi.getAddress(address);

				if (getAddressResult) {
					let moreTx = true;

					while (moreTx) {
						const detailsResult = await addressApi.getAddressDetails(getAddressResult.address, getAddressResult.scriptPubKey, sort, txLimit, txOffset);

						if (detailsResult && detailsResult.addressDetails && detailsResult.addressDetails.txids) {
							if (detailsResult.addressDetails.txids.length == 0) {
								result.emptyAddresses[receiveOrChange == 0 ? "receive" : "change"].push(address);

								gapCounts[receiveOrChange]++;
								moreTx = false;

							} else {
								gapCounts[receiveOrChange] = 0;

								result.usedAddresses.push({
									addressIndex: addressCount,
									address: address,
									type: receiveOrChange == 0 ? "receive" : "change",
									txids: detailsResult.addressDetails.txids,
									priorGap: gapCounts[receiveOrChange]
								});

								if (detailsResult.addressDetails.txids.length < txLimit) {
									moreTx = false;
								}
							}
						} else {
							// no answer about this address (no address API, or it failed): count it as empty,
							// or this loop and the gap check never end
							result.emptyAddresses[receiveOrChange == 0 ? "receive" : "change"].push(address);

							gapCounts[receiveOrChange]++;
							moreTx = false;
						}

						txOffset += txLimit;
					}
				}
			}
		}

		addressCount++;
		
		// gap of N (20) receive and change addresses found
		if (gapCounts[0] >= gapLimit && gapCounts[1] >= gapLimit) {
			break;
		}
	}
	

	return result;
}
