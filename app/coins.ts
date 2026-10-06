import btc from "./coins/btc.js";
import type { CoinConfig } from "./coins/types.js";


// indexable by coin name (coins[config.coin]); the names of the coins are its keys
const coins: Record<string, CoinConfig> = {
	"BTC": btc
};

export = coins;
