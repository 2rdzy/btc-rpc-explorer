import { Decimal } from "decimal.js";
import config from "../config.js";
import coins from "../coins.js";
import { formatHex } from "./text.js";
import { getVoutAddress, getVoutAddresses } from "./addresses.js";
import { logError } from "./errors.js";

const coinConfig = coins[config.coin];

// the parts of a transaction (as the node gives it) that these functions read
export interface RawVout {
	value: number | string,
	scriptPubKey?: { address?: string, addresses?: string[] }
}

export interface RawTx {
	txid?: string,
	blockhash?: string,
	vin: { coinbase?: string, txid?: string, vout?: number }[],
	vout: RawVout[]
}

export interface MinerInfo {
	name?: string,
	type?: string,
	identifiedBy?: string,
	[key: string]: unknown
}

// Who mined a block, from its coinbase transaction: by payout address, coinbase tag, block hash or (on mainnet)
// block height as listed in global.miningPoolsConfigs, else by the first paid address. Returns a copy of the entry
// it finds in the pool config, with identifiedBy saying how (the config itself is not changed).
export function identifyMiner(coinbaseTx: Partial<RawTx> | null | undefined, blockHeight: number): MinerInfo | null {
	if (coinbaseTx == null || coinbaseTx.vin == null || coinbaseTx.vin.length == 0) {
		return null;
	}

	if (global.miningPoolsConfigs) {
		for (let i = 0; i < global.miningPoolsConfigs.length; i++) {
			const miningPoolsConfig = global.miningPoolsConfigs[i];

			for (const payoutAddress in miningPoolsConfig.payout_addresses) {
				if (Object.prototype.hasOwnProperty.call(miningPoolsConfig.payout_addresses, payoutAddress)) {
					if (coinbaseTx.vout && coinbaseTx.vout.length > 0) {
						if (getVoutAddresses(coinbaseTx.vout[0]).includes(payoutAddress)) {
							return { ...miningPoolsConfig.payout_addresses[payoutAddress], identifiedBy: "payout address " + payoutAddress };
						}
					}
				}
			}

			for (const coinbaseTag in miningPoolsConfig.coinbase_tags) {
				if (Object.prototype.hasOwnProperty.call(miningPoolsConfig.coinbase_tags, coinbaseTag)) {
					if (formatHex(coinbaseTx.vin[0].coinbase ?? "", "utf8").indexOf(coinbaseTag) != -1) {
						return { ...miningPoolsConfig.coinbase_tags[coinbaseTag], identifiedBy: "coinbase tag '" + coinbaseTag + "'" };
					}
				}
			}

			for (const blockHash in miningPoolsConfig.block_hashes) {
				if (blockHash == coinbaseTx.blockhash) {
					return { ...miningPoolsConfig.block_hashes[blockHash], identifiedBy: "known block hash '" + blockHash + "'" };
				}
			}

			if (global.activeBlockchain == "main" && miningPoolsConfig.block_heights) {
				for (const minerName in miningPoolsConfig.block_heights) {
					const minerInfo = miningPoolsConfig.block_heights[minerName];

					if (minerInfo.heights.includes(blockHeight)) {
						return { ...minerInfo, name: minerName, identifiedBy: "known block height #" + blockHeight };
					}
				}
			}
		}
	}

	if (coinbaseTx.vout && coinbaseTx.vout.length > 0) {
		for (let i = 0; i < coinbaseTx.vout.length; i++) {
			const vout = coinbaseTx.vout[i];

			const voutValue = new Decimal(vout.value);
			if (voutValue.gt(0)) {
				const address = getVoutAddress(vout);

				if (address) {
					return {
						name: address,
						type: "address-only",
						identifiedBy: "payout address " + address,
					};
				}
			}
		}
	}

	return null;
}

// The total value going into and out of a transaction (input is null when the inputs are not known).
export function getTxTotalInputOutputValues(tx: RawTx & { txid?: string }, txInputs: (RawVout | null | undefined)[] | null | undefined, blockHeight: number): { input: Decimal | null, output: Decimal } {
	let totalInputValue = new Decimal(0);
	let totalOutputValue = new Decimal(0);

	try {
		if (txInputs) {
			for (let i = 0; i < tx.vin.length; i++) {
				if (tx.vin[i].coinbase) {
					totalInputValue = totalInputValue.plus(new Decimal(coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain)));

				} else {
					const txInput = txInputs[i];

					if (txInput) {
						try {
							const vout = txInput;

							if (vout.value) {
								totalInputValue = totalInputValue.plus(new Decimal(vout.value));
							}
						} catch (err) {
							logError("2397gs0gsse", err, {txid:tx.txid, vinIndex:i});
						}
					}
				}
			}
		}

		for (let i = 0; i < tx.vout.length; i++) {
			totalOutputValue = totalOutputValue.plus(new Decimal(tx.vout[i].value));
		}
	} catch (err) {
		logError("2308sh0sg44", err, {tx:tx, txInputs:txInputs, blockHeight:blockHeight});
	}

	return {input:(txInputs ? totalInputValue : null), output:totalOutputValue};
}

// The fees a block collected: what its coinbase paid out, less the block reward. 0 when there is no coinbase.
export function getBlockTotalFeesFromCoinbaseTxAndBlockHeight(coinbaseTx: Pick<RawTx, "vout"> | null | undefined, blockHeight: number): Decimal | 0 {
	if (coinbaseTx == null) {
		return 0;
	}

	const blockReward = coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

	let totalOutput = new Decimal(0);
	for (let i = 0; i < coinbaseTx.vout.length; i++) {
		const outputValue = coinbaseTx.vout[i].value;
		if (Number(outputValue) > 0) {
			totalOutput = totalOutput.plus(new Decimal(outputValue));
		}
	}

	if (blockReward == null || blockReward.lt(1e-8)) {
		return totalOutput;

	} else {
		return totalOutput.minus(new Decimal(blockReward));
	}
}

// The coin supply at a height, from the block rewards (starting from a known UTXO set checkpoint when there is one).
export function estimatedSupply(height: number): Decimal {
	const checkpoint = coinConfig.utxoSetCheckpointsByNetwork[global.activeBlockchain];

	let checkpointHeight = 0;
	let checkpointSupply = new Decimal(50);

	if (checkpoint && checkpoint.height <= height) {
		checkpointHeight = checkpoint.height;
		checkpointSupply = new Decimal(checkpoint.total_amount);
	}

	const halvingBlockInterval = coinConfig.halvingBlockIntervalsByNetwork[global.activeBlockchain];

	let supply = checkpointSupply;

	let i = checkpointHeight;
	while (i < height) {
		const nextHalvingHeight = halvingBlockInterval * Math.floor(i / halvingBlockInterval) + halvingBlockInterval;

		if (height < nextHalvingHeight) {
			const heightDiff = height - i;

			return supply.plus(new Decimal(heightDiff).times(coinConfig.blockRewardFunction(i, global.activeBlockchain)));
		}

		const heightDiff = nextHalvingHeight - i;

		supply = supply.plus(new Decimal(heightDiff).times(coinConfig.blockRewardFunction(i, global.activeBlockchain)));

		i += heightDiff;
	}

	return supply;
}
