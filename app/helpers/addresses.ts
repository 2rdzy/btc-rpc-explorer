import bs58check from "bs58check";
import * as ecc from "tiny-secp256k1";
import { BIP32Factory } from "bip32";
import * as bitcoinjs from "bitcoinjs-lib";
import { bech32m } from "bech32";

// You must wrap a tiny-secp256k1 compatible implementation
const bip32 = BIP32Factory(ecc);

export interface Vout {
	scriptPubKey?: { address?: string, addresses?: string[] }
}

export function getVoutAddress(vout: Vout | null | undefined): string | null {
	if (vout && vout.scriptPubKey) {
		if (vout.scriptPubKey.address) {
			return vout.scriptPubKey.address;

		} else if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.length > 0) {
			return vout.scriptPubKey.addresses[0];
		}
	}

	return null;
}

export function getVoutAddresses(vout: Vout | null | undefined): string[] {
	if (vout && vout.scriptPubKey) {
		if (vout.scriptPubKey.address) {
			return [vout.scriptPubKey.address];

		} else if (vout.scriptPubKey.addresses) {
			return vout.scriptPubKey.addresses;
		}
	}

	return [];
}

const xpubPrefixes = new Map([
	["xpub", "0488b21e"],
	["ypub", "049d7cb2"],
	["Ypub", "0295b43f"],
	["zpub", "04b24746"],
	["Zpub", "02aa7ed3"],
	["tpub", "043587cf"],
	["upub", "044a5262"],
	["Upub", "024289ef"],
	["vpub", "045f1cf6"],
	["Vpub", "02575483"],
]);

const bip32TestnetNetwork = {
	messagePrefix: "\x18Bitcoin Signed Message:\n",
	bech32: "tb",
	bip32: {
		public: 0x043587cf,
		private: 0x04358394,
	},
	pubKeyHash: 0x6f,
	scriptHash: 0xc4,
	wif: 0xEF,
};

// Re-encodes an extended public key with the version bytes of another format (xpub, ypub, zpub, ...).
// ref: https://github.com/ExodusMovement/xpub-converter/blob/master/src/index.js
export function xpubChangeVersionBytes(xpub: string, targetFormat: string): string {
	const prefix = xpubPrefixes.get(targetFormat);

	if (prefix === undefined) {
		throw new Error("Invalid target version");
	}

	// trim whitespace
	xpub = xpub.trim();

	const data = Buffer.concat([Buffer.from(prefix, "hex"), bs58check.decode(xpub).slice(4)]);

	return bs58check.encode(data);
}

// HD wallet addresses
export function bip32Addresses(extPubkey: string, addressType: string, account: number, limit = 10, offset = 0): string[] {
	let network: typeof bip32TestnetNetwork | undefined = undefined;
	if (!extPubkey.match(/^(xpub|ypub|zpub|Ypub|Zpub).*$/)) {
		network = bip32TestnetNetwork;
	}

	const bip32object = bip32.fromBase58(extPubkey, network);

	const addresses: string[] = [];
	for (let i = offset; i < (offset + limit); i++) {
		const publicKey = bip32object.derive(account).derive(i).publicKey;

		if (addressType == "p2pkh") {
			addresses.push(bitcoinjs.payments.p2pkh({ pubkey: publicKey, network: network }).address as string);

		} else if (addressType == "p2sh(p2wpkh)") {
			addresses.push(bitcoinjs.payments.p2sh({ redeem: bitcoinjs.payments.p2wpkh({ pubkey: publicKey, network: network })}).address as string);

		} else if (addressType == "p2wpkh") {
			addresses.push(bitcoinjs.payments.p2wpkh({ pubkey: publicKey, network: network }).address as string);

		} else {
			throw new Error(`Unknown address type: "${addressType}" (should be one of ["p2pkh", "p2sh(p2wpkh)", "p2wpkh"])`);
		}
	}

	return addresses;
}

// What the address decodes to (it differs by encoding, and the hashes and data are hex), or the errors of each attempt.
export interface ParsedAddress {
	encoding?: "base58" | "bech32" | "bech32m",
	parsedAddress?: Record<string, unknown>,
	errors?: unknown[]
}

// The address decoded as base58, bech32 or bech32m, or the errors from each attempt.
export function tryParseAddress(address: string): ParsedAddress {
	let base58Error: unknown = null;
	let bech32Error: unknown = null;
	let bech32mError: unknown = null;

	const b58prefix = (global.activeBlockchain == "main" ? /^[13].*$/ : /^[2mn].*$/);
	if (address.match(b58prefix)) {
		try {
			const decoded = bitcoinjs.address.fromBase58Check(address);

			return {
				encoding: "base58",
				parsedAddress: { ...decoded, hash: decoded.hash.toString("hex") }
			};

		} catch (err) {
			base58Error = err;
		}
	}

	try {
		const decoded = bitcoinjs.address.fromBech32(address);

		return {
			encoding: "bech32",
			parsedAddress: { ...decoded, data: decoded.data.toString("hex") }
		};

	} catch (err) {
		bech32Error = err;
	}

	try {
		const decoded = bech32m.decode(address);

		return {
			encoding: "bech32m",
			parsedAddress: { ...decoded, words: Buffer.from(decoded.words).toString("hex") }
		};

	} catch (err) {
		bech32mError = err;
	}

	const errors: unknown[] = [];

	if (base58Error) {
		errors.push(base58Error);
	}

	if (bech32Error) {
		errors.push(bech32Error);
	}

	if (bech32mError) {
		errors.push(bech32mError);
	}

	return { errors: errors };
}
