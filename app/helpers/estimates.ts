import { Decimal } from "decimal.js";
import config from "../config.js";
import coins from "../coins.js";

const coinConfig = coins[config.coin];

export interface BlockHeaderTimes {
	height: number,
	time: number,
	mediantime: number
}

export interface DifficultyAdjustmentEstimate {
	estimateAvailable: boolean,

	blockCount: number,
	blocksLeft: number,
	daysLeftStr: string,
	timeLeftStr: string,
	calculationBlockCount: number,
	currentEpoch: number,

	delta: Decimal,
	sign: string,

	timePerBlock: number,
	firstBlockTime: number,
	nowTime: number,
	dt: number,
	predictedBlockCount: number
}

// What the next difficulty adjustment will be, if blocks keep coming at the pace of the current epoch so far.
export function difficultyAdjustmentEstimates(eraStartBlockHeader: BlockHeaderTimes, currentBlockHeader: BlockHeaderTimes): DifficultyAdjustmentEstimate {
	const difficultyPeriod = Math.trunc(Math.floor(currentBlockHeader.height / coinConfig.difficultyAdjustmentBlockCount));
	const blocksUntilDifficultyAdjustment = ((difficultyPeriod + 1) * coinConfig.difficultyAdjustmentBlockCount) - currentBlockHeader.height;

	const heightDiff = currentBlockHeader.height - eraStartBlockHeader.height;
	const blockCount = heightDiff + 1;
	const timeDiff = currentBlockHeader.mediantime - eraStartBlockHeader.mediantime;
	const timePerBlock = timeDiff / heightDiff;
	const daysUntilAdjustment = new Decimal(blocksUntilDifficultyAdjustment).times(timePerBlock).dividedBy(60 * 60 * 24);
	const hoursUntilAdjustment = new Decimal(blocksUntilDifficultyAdjustment).times(timePerBlock).dividedBy(60 * 60);
	const duaDP1 = daysUntilAdjustment.toDP(1);
	const daysUntilAdjustmentStr = daysUntilAdjustment.gt(1) ? `~${duaDP1} day${duaDP1.eq(1) ? "" : "s"}` : "< 1 day";
	const hoursUntilAdjustmentStr = hoursUntilAdjustment.gt(1) ? `~${hoursUntilAdjustment.toDP(0)} hr${hoursUntilAdjustment.toDP(1).eq(1) ? "" : "s"}` : "< 1 hr";
	const nowTime = new Date().getTime() / 1000;
	const dt = nowTime - eraStartBlockHeader.time;
	const predictedBlockCount = dt / coinConfig.targetBlockTimeSeconds;

	let blockRatioPercent = new Decimal(blockCount / predictedBlockCount).times(100);
	if (blockRatioPercent.gt(400)) {
		blockRatioPercent = new Decimal(400);
	}
	if (blockRatioPercent.lt(25)) {
		blockRatioPercent = new Decimal(25);
	}

	let diffAdjPercent = blockRatioPercent.minus(new Decimal(100));
	let diffAdjSign = "+";

	if (predictedBlockCount > blockCount) {
		diffAdjPercent = new Decimal(100).minus(blockRatioPercent).times(-1);
		diffAdjSign = "-";
	}

	return {
		estimateAvailable: blockCount > 30 && !diffAdjPercent.isNaN(),

		blockCount: blockCount,
		blocksLeft: blocksUntilDifficultyAdjustment,
		daysLeftStr: daysUntilAdjustmentStr,
		timeLeftStr: (daysUntilAdjustment.lt(1) ? hoursUntilAdjustmentStr : daysUntilAdjustmentStr),
		calculationBlockCount: heightDiff,
		currentEpoch: difficultyPeriod,

		delta: diffAdjPercent,
		sign: diffAdjSign,

		timePerBlock: timePerBlock,
		firstBlockTime: eraStartBlockHeader.time,
		nowTime: nowTime,
		dt: dt,
		predictedBlockCount: predictedBlockCount
	};
}

export interface HalvingEstimate {
	blockCount: number,
	halvingBlockInterval: number,
	halvingCount: number,
	nextHalvingIndex: number,
	terminalHalvingCount: number,
	nextHalvingBlock: number,
	blocksUntilNextHalving: number,
	targetBlockTimeSeconds: number,
	daysUntilNextHalving: number,
	nextHalvingDate: Date,

	difficultyAdjustmentData: DifficultyAdjustmentEstimate
}

// When the next halving will be, from the current block and the pace of the current difficulty epoch.
// Once the last halving has happened, only {halvingCount, nextHalvingIndex: -1} is set.
export function nextHalvingEstimates(
	eraStartBlockHeader: BlockHeaderTimes,
	currentBlockHeader: BlockHeaderTimes,
	difficultyAdjustmentDataArg: DifficultyAdjustmentEstimate | null = null
): Partial<HalvingEstimate> & Pick<HalvingEstimate, "halvingCount" | "nextHalvingIndex"> {
	const blockCount = currentBlockHeader.height;
	const halvingBlockInterval = coinConfig.halvingBlockIntervalsByNetwork[global.activeBlockchain];
	const halvingCount = Math.trunc(blockCount / halvingBlockInterval);
	const nextHalvingIndex = halvingCount + 1;
	const targetBlockTimeSeconds = coinConfig.targetBlockTimeSeconds;
	const nextHalvingBlock = (halvingBlockInterval * nextHalvingIndex);
	const blocksUntilNextHalving = nextHalvingBlock - blockCount;

	const terminalHalvingCount = coinConfig.terminalHalvingCountByNetwork[global.activeBlockchain];
	if (nextHalvingIndex > terminalHalvingCount) {
		return {
			halvingCount: terminalHalvingCount,
			nextHalvingIndex: -1
		};
	}

	const difficultyAdjustmentData = difficultyAdjustmentDataArg || difficultyAdjustmentEstimates(eraStartBlockHeader, currentBlockHeader);

	const blockCountAffectedByCurrentDifficultyDelta = Math.min(difficultyAdjustmentData.blocksLeft, blocksUntilNextHalving);
	const currDifficultyEraTimeDifferential = (targetBlockTimeSeconds - difficultyAdjustmentData.timePerBlock) * blockCountAffectedByCurrentDifficultyDelta;

	const secondsUntilNextHalving = blocksUntilNextHalving * targetBlockTimeSeconds - currDifficultyEraTimeDifferential;
	const daysUntilNextHalving = secondsUntilNextHalving / 60 / 60 / 24;
	const nextHalvingDate = new Date(new Date().getTime() + secondsUntilNextHalving * 1000);

	return {
		blockCount: blockCount,
		halvingBlockInterval: halvingBlockInterval,
		halvingCount: halvingCount,
		nextHalvingIndex: nextHalvingIndex,
		terminalHalvingCount: terminalHalvingCount,
		nextHalvingBlock: nextHalvingBlock,
		blocksUntilNextHalving: blocksUntilNextHalving,
		targetBlockTimeSeconds: targetBlockTimeSeconds,
		daysUntilNextHalving: daysUntilNextHalving,
		nextHalvingDate: nextHalvingDate,

		difficultyAdjustmentData: difficultyAdjustmentData
	};
}
