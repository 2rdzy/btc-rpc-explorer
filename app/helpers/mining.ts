import { Decimal } from "decimal.js";
import config from "../config.js";
import coins from "../coins.js";
import { formatHex } from "./text.js";
import { getVoutAddress, getVoutAddresses } from "./addresses.js";
import { logError } from "./errors.js";

const coinConfig = coins[config.coin];

export interface MinerInfo {
	name?: string,
	type?: string,
	identifiedBy?: string,
	[key: string]: unknown
}

// Who mined a block, from its coinbase transaction: by payout address, coinbase tag, block hash or (on mainnet)
// block height as listed in global.miningPoolsConfigs, else by the first paid address. Sets identifiedBy on the
// entry it finds in the pool config, and returns that entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function identifyMiner(coinbaseTx: any, blockHeight: number): MinerInfo | null {
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
							const minerInfo = miningPoolsConfig.payout_addresses[payoutAddress];
							minerInfo.identifiedBy = "payout address " + payoutAddress;

							return minerInfo;
						}
					}
				}
			}

			for (const coinbaseTag in miningPoolsConfig.coinbase_tags) {
				if (Object.prototype.hasOwnProperty.call(miningPoolsConfig.coinbase_tags, coinbaseTag)) {
					if (formatHex(coinbaseTx.vin[0].coinbase, "utf8").indexOf(coinbaseTag) != -1) {
						const minerInfo = miningPoolsConfig.coinbase_tags[coinbaseTag];
						minerInfo.identifiedBy = "coinbase tag '" + coinbaseTag + "'";

						return minerInfo;
					}
				}
			}

			for (const blockHash in miningPoolsConfig.block_hashes) {
				if (blockHash == coinbaseTx.blockhash) {
					const minerInfo = miningPoolsConfig.block_hashes[blockHash];
					minerInfo.identifiedBy = "known block hash '" + blockHash + "'";

					return minerInfo;
				}
			}

			if (global.activeBlockchain == "main" && miningPoolsConfig.block_heights) {
				for (const minerName in miningPoolsConfig.block_heights) {
					const minerInfo = miningPoolsConfig.block_heights[minerName];
					minerInfo.name = minerName;

					if (minerInfo.heights.includes(blockHeight)) {
						minerInfo.identifiedBy = "known block height #" + blockHeight;

						return minerInfo;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTxTotalInputOutputValues(tx: any, txInputs: any[] | null | undefined, blockHeight: number): { input: Decimal | null, output: Decimal } {
	let totalInputValue: Decimal | null = new Decimal(0);
	let totalOutputValue = new Decimal(0);

	try {
		if (txInputs) {
			for (let i = 0; i < tx.vin.length; i++) {
				if (tx.vin[i].coinbase) {
					totalInputValue = totalInputValue!.plus(new Decimal(coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain)));

				} else {
					const txInput = txInputs[i];

					if (txInput) {
						try {
							const vout = txInput;

							if (vout.value) {
								totalInputValue = totalInputValue!.plus(new Decimal(vout.value));
							}
						} catch (err) {
							logError("2397gs0gsse", err, {txid:tx.txid, vinIndex:i});
						}
					}
				}
			}
		} else {
			totalInputValue = null;
		}

		for (let i = 0; i < tx.vout.length; i++) {
			totalOutputValue = totalOutputValue.plus(new Decimal(tx.vout[i].value));
		}
	} catch (err) {
		logError("2308sh0sg44", err, {tx:tx, txInputs:txInputs, blockHeight:blockHeight});
	}

	return {input:totalInputValue, output:totalOutputValue};
}

// The fees a block collected: what its coinbase paid out, less the block reward. 0 when there is no coinbase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBlockTotalFeesFromCoinbaseTxAndBlockHeight(coinbaseTx: any, blockHeight: number): Decimal | 0 {
	if (coinbaseTx == null) {
		return 0;
	}

	const blockReward = coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

	let totalOutput = new Decimal(0);
	for (let i = 0; i < coinbaseTx.vout.length; i++) {
		const outputValue = coinbaseTx.vout[i].value;
		if (outputValue > 0) {
			totalOutput = totalOutput.plus(new Decimal(outputValue));
		}
	}

	if (blockReward < 1e-8 || blockReward == null) {
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
