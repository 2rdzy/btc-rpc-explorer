import type { Decimal } from "decimal.js";
import type { RpcData } from "../api/rpcApi.js";

// what the coin config says per network (main, test, regtest, signet)
export type ByNetwork<T> = Record<string, T>;

export interface CurrencyUnit {
	type: string,
	name: string,
	multiplier: number | string,
	default?: boolean,
	values: string[],
	decimalPlaces: number,
	symbol?: string
}

// The parts that are reference data copied from the node (genesis block and transaction, UTXO set checkpoints, test
// data) are kept loosely typed: the code that reads them picks out the fields it uses.
export interface CoinConfig {
	name: string,
	ticker: string,
	logoUrlsByNetwork: ByNetwork<string>,
	coinIconUrlsByNetwork: ByNetwork<string>,
	coinColorsByNetwork: ByNetwork<string>,
	siteTitlesByNetwork: ByNetwork<string>,
	knownTransactionsByNetwork: ByNetwork<string>,
	miningPoolsConfigUrls: string[],
	maxBlockWeight: number,
	maxBlockSize: number,
	minTxBytes: number,
	minTxWeight: number,
	difficultyAdjustmentBlockCount: number,
	maxSupplyByNetwork: ByNetwork<Decimal>,
	targetBlockTimeSeconds: number,
	targetBlockTimeMinutes: number,
	currencyUnits: CurrencyUnit[],
	currencyUnitsByName: Record<string, CurrencyUnit>,
	baseCurrencyUnit: CurrencyUnit,
	defaultCurrencyUnit: CurrencyUnit,
	feeSatoshiPerByteBucketMaxima: number[],
	halvingBlockIntervalsByNetwork: ByNetwork<number>,
	terminalHalvingCountByNetwork: ByNetwork<number>,
	coinSupplyCheckpointsByNetwork: ByNetwork<[number, Decimal]>,
	utxoSetCheckpointsByNetwork: ByNetwork<RpcData>,
	genesisBlockHashesByNetwork: ByNetwork<string>,
	genesisCoinbaseTransactionIdsByNetwork: ByNetwork<string>,
	genesisCoinbaseTransactionsByNetwork: ByNetwork<RpcData>,
	genesisBlockStatsByNetwork: ByNetwork<RpcData>,
	testData: RpcData,
	genesisCoinbaseOutputAddressScripthash: string,
	historicalData: RpcData[],
	exchangeRateData: { jsonUrl: string, responseBodySelectorFunction: (responseBody: RpcData) => Record<string, number> | null },
	goldExchangeRateData: { jsonUrl: string, responseBodySelectorFunction: (responseBody: RpcData) => { usd: number } | null },
	blockRewardFunction: (blockHeight: number, chain: string) => Decimal
}
