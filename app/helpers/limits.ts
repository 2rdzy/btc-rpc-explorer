// What a single request may ask for. The values come from query strings and URLs, and each block, address or height
// costs the node (or an Electrum server) a few calls, so one request must not be able to ask for a million of them.

// blocks in a range (the mining summary): the longest range the pages offer is 30 days, 4320 blocks
export const maxBlockRange = 10000;

// block heights in a list (the internal API loads a few at a time)
export const maxHeightListLength = 100;

// the addresses of an extended public key that one request derives or looks up, and the gap after which the search stops
export const maxXpubAddresses = 1000;
export const maxXpubGapLimit = 100;

// An error text when the range of blocks is not one to build a summary of; null when it is.
export function blockRangeError(startHeight: number, endHeight: number): string | null {
	if (!Number.isInteger(startHeight) || !Number.isInteger(endHeight) || startHeight < 0 || endHeight < startHeight) {
		return "The start and end heights have to be whole numbers, with the start not above the end.";
	}

	if (endHeight - startHeight + 1 > maxBlockRange) {
		return `At most ${maxBlockRange.toLocaleString("en-US")} blocks can be summarized at once.`;
	}

	return null;
}

// The block heights of a comma separated list, or null when it is too long or has something that is no number.
export function parseHeightList(list: string): number[] | null {
	const parts = list.split(",");

	if (parts.length > maxHeightListLength) {
		return null;
	}

	const heights = parts.map(part => /^\d{1,9}$/.test(part) ? parseInt(part) : NaN);

	return heights.some(Number.isNaN) ? null : heights;
}
