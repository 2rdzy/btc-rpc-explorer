"use strict";

const btc = require("./coins/btc.js");

// indexable by coin name (coins[config.coin])
module.exports = /** @type {Record<string, any>} */ ({
	"BTC": btc,

	"coins":["BTC"]
});