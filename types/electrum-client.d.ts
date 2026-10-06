// electrum-client (the 2rdzy fork) ships no type declarations: this describes the parts the explorer uses.
declare module "electrum-client" {
	interface HistoryItem { tx_hash: string, height: number }
	interface Balance { confirmed: number, unconfirmed?: number }

	class ElectrumClient {
		constructor(port: number, host: string | null, protocol: string, options?: object, callbacks?: object);

		host: string | null;
		port: number;

		initElectrum(config: object, persistencePolicy?: object): Promise<unknown>;
		request(method: string, params: unknown[]): Promise<unknown>;
		blockchainScripthash_getHistory(scripthash: string): Promise<HistoryItem[]>;
		blockchainScripthash_getBalance(scripthash: string): Promise<Balance>;
	}

	export = ElectrumClient;
}
