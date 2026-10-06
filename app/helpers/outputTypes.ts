const abbreviations: Record<string, string> = {
	"pubkey": "P2PK",
	"multisig": "P2MS",
	"pubkeyhash": "P2PKH",
	"scripthash": "P2SH",
	"witness_v0_keyhash": "P2WPKH",
	"witness_v0_scripthash": "P2WSH",
	"witness_v1_taproot": "P2TR",
	"nonstandard": "nonstandard",
	"nulldata": "nulldata"
};

const names: Record<string, string> = {
	"pubkey": "Pay to Public Key",
	"multisig": "Pay to MultiSig",
	"pubkeyhash": "Pay to Public Key Hash",
	"scripthash": "Pay to Script Hash",
	"witness_v0_keyhash": "Witness, v0 Key Hash",
	"witness_v0_scripthash": "Witness, v0 Script Hash",
	"witness_v1_taproot": "Witness, v1 Taproot",
	"nonstandard": "Non-Standard",
	"nulldata": "Null Data"
};

// own keys only: "toString" or "constructor" must not find an inherited function
const lookup = (map: Record<string, string>, outputType: string): string =>
	Object.prototype.hasOwnProperty.call(map, outputType) ? map[outputType] : "???";

export const outputTypeAbbreviation = (outputType: string): string => lookup(abbreviations, outputType);

export const outputTypeName = (outputType: string): string => lookup(names, outputType);

// Search input cleaned to what can be in a hash (hex digits), a height or hash, or an address.
export const asHash = (value: string): string => value.replace(/[^a-f0-9]/gi, "");

// a height (number) or a hash (string). Typed loosely because the JS callers still treat it as either.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asHashOrHeight = (value: string): any => +value || asHash(value);

export const asAddress = (value: string): string => value.replace(/[^a-z0-9]/gi, "");
