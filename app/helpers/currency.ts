import { Decimal } from "decimal.js";
import config from "../config.js";
import coins from "../coins.js";
import { addThousandsSeparators } from "./text.js";
import { logError } from "./errors.js";

const coinConfig = coins[config.coin];

export interface ExponentScale {
	val: number,
	name: string,
	abbreviation: string,
	exponent: string,
	textDesc?: string
}

export const exponentScales: ExponentScale[] = [
	{val:1000000000000000000000000000000000, name:"?", abbreviation:"V", exponent:"33"},
	{val:1000000000000000000000000000000, name:"?", abbreviation:"W", exponent:"30"},
	{val:1000000000000000000000000000, name:"?", abbreviation:"X", exponent:"27"},
	{val:1000000000000000000000000, name:"yotta", abbreviation:"Y", exponent:"24"},
	{val:1000000000000000000000, name:"zetta", abbreviation:"Z", exponent:"21"},
	{val:1000000000000000000, name:"exa", abbreviation:"E", exponent:"18"},
	{val:1000000000000000, name:"peta", abbreviation:"P", exponent:"15", textDesc:"Q"},
	{val:1000000000000, name:"tera", abbreviation:"T", exponent:"12", textDesc:"T"},
	{val:1000000000, name:"giga", abbreviation:"G", exponent:"9", textDesc:"B"},
	{val:1000000, name:"mega", abbreviation:"M", exponent:"6", textDesc:"M"},
	{val:1000, name:"kilo", abbreviation:"K", exponent:"3", textDesc:"thou"}
];

// the number scaled down, and the scale that was used ({} when none)
export type ScaledNumber = [Decimal, ExponentScale | Record<string, never>];

export function formatLargeNumber(n: number, decimalPlaces?: number): ScaledNumber {
	try {
		for (let i = 0; i < exponentScales.length; i++) {
			const item = exponentScales[i];

			const fraction = new Decimal(n / item.val);
			if (fraction.abs().gte(1)) {
				return [fraction.toDP(decimalPlaces), item];
			}
		}

		return [new Decimal(n).toDP(decimalPlaces), {}];

	} catch (err) {
		logError("ru92huefhew", err, { n:n, decimalPlaces:decimalPlaces });

		throw err;
	}
}

export function formatLargeNumberSignificant(n: number, significantDigits: number): ScaledNumber {
	try {
		for (let i = 0; i < exponentScales.length; i++) {
			const item = exponentScales[i];

			const fraction = new Decimal(n / item.val);
			if (fraction.abs().gte(1)) {
				return [fraction.toDP(Math.max(0, significantDigits - `${fraction.floor()}`.length)), item];
			}
		}

		return [new Decimal(n).toDP(significantDigits), {}];

	} catch (err) {
		logError("38fhcdugdeogwe", err, { n:n, significantDigits:significantDigits });

		throw err;
	}
}

export interface FormattedCurrencyAmount {
	val: string,
	currencyUnit: string,
	simpleVal: string,
	intVal: number,
	lessSignificantDigits?: string
}

export function formatCurrencyAmountWithForcedDecimalPlaces(amount: Decimal.Value, formatType: string, forcedDecimalPlaces: number): FormattedCurrencyAmount {
	formatType = formatType.toLowerCase();

	const currencyType = global.currencyTypes[formatType];

	if (currencyType == null) {
		throw `Unknown currency type: ${formatType}`;
	}

	let dec = new Decimal(amount);

	let decimalPlaces = currencyType.decimalPlaces;

	if (forcedDecimalPlaces >= 0) {
		decimalPlaces = forcedDecimalPlaces;
	}

	if (currencyType.type == "native") {
		dec = dec.times(currencyType.multiplier);

		if (forcedDecimalPlaces >= 0) {
			// toFixed will keep trailing zeroes
			const baseStr = addThousandsSeparators(dec.toFixed(decimalPlaces));

			return {val:baseStr, currencyUnit:currencyType.name, simpleVal:baseStr, intVal:dec.trunc().toNumber()};

		} else {
			// toDP excludes trailing zeroes but doesn't "fix" numbers like 1e-8
			// instead, we use toFixed and (optionally) manually strip trailing zeroes
			let baseStr = addThousandsSeparators(dec.toFixed(decimalPlaces).replace(/\.$/, ""));

			// with Issue #500, the idea was raised that stripping trailing zeroes can
			// make values more difficult to parse visually; now the stripping is
			// dynamic, based on the value - if any of the 4 least-significant digits
			// are non-zero (i.e. sat-value is NOT evenly divisible by 10,000), then
			// no stripping is performed, otherwise it is performed, to preserve some
			// of the UX benefit of larger, "even" amounts (e.g. 0.1BTC).
			const trailingZeroesStrippedStr = baseStr.replace(/0+$/, "");
			if (baseStr.length - trailingZeroesStrippedStr.length >= 4) {
				baseStr = trailingZeroesStrippedStr;

				if (baseStr.endsWith(".")) {
					baseStr = baseStr.slice(0, -1);
				}
			}

			// val is set below: it is added last so the keys come out in the order callers have always seen
			const returnVal = {currencyUnit:currencyType.name, simpleVal:baseStr, intVal:dec.trunc().toNumber()} as FormattedCurrencyAmount;
			returnVal.val = baseStr;

			// max digits in "val"
			const maxValDigits = config.site.valueDisplayMaxLargeDigits;

			// todo: make this section locale-aware (don't hardcode ".")
			if (baseStr.indexOf(".") != -1 && baseStr.length - baseStr.indexOf(".") - 1 > maxValDigits) {
				returnVal.val = baseStr.substring(0, baseStr.indexOf(".") + maxValDigits + 1);
				returnVal.lessSignificantDigits = baseStr.substring(baseStr.indexOf(".") + maxValDigits + 1);
			}

			return returnVal;
		}
	} else if (currencyType.type == "exchanged") {
		if (global.exchangeRates != null && global.exchangeRates[currencyType.id] != null) {
			dec = dec.times(global.exchangeRates[currencyType.id]);

			const baseStr = addThousandsSeparators(dec.toDecimalPlaces(decimalPlaces));

			return {val:baseStr, currencyUnit:currencyType.name, simpleVal:baseStr, intVal:dec.trunc().toNumber()};

		} else {
			return formatCurrencyAmountWithForcedDecimalPlaces(amount, coinConfig.defaultCurrencyUnit.name, forcedDecimalPlaces);
		}
	} else {
		throw `Unknown currency type: ${currencyType.type}`;
	}
}

export const formatCurrencyAmount = (amount: Decimal.Value, formatType: string): FormattedCurrencyAmount =>
	formatCurrencyAmountWithForcedDecimalPlaces(amount, formatType, -1);

export const formatCurrencyAmountInSmallestUnits = (amount: Decimal.Value, forcedDecimalPlaces: number): FormattedCurrencyAmount =>
	formatCurrencyAmountWithForcedDecimalPlaces(amount, coins[config.coin].baseCurrencyUnit.name, forcedDecimalPlaces);

export function satoshisPerUnitOfLocalCurrency(localCurrency: string): { amt: string, amtRaw: number, unit: string } | null {
	if (global.exchangeRates != null) {
		let exchangeType = localCurrency;

		if (!global.exchangeRates[localCurrency]) {
			// if current display currency is a native unit, default to USD for exchange values
			exchangeType = "usd";
		}

		let dec = new Decimal(1);
		const one = new Decimal(1);
		dec = dec.times(global.exchangeRates[exchangeType]);

		// USD/BTC -> BTC/USD
		dec = one.dividedBy(dec);

		const satCurrencyType = global.currencyTypes["sat"];
		const localCurrencyType = global.currencyTypes[localCurrency];

		// BTC/USD -> sat/USD
		dec = dec.times(satCurrencyType.multiplier);

		const exchangedAmt = dec.trunc().toNumber();

		return {amt:addThousandsSeparators(exchangedAmt), amtRaw:exchangedAmt, unit:`sat/${localCurrencyType.symbol}`};
	}

	return null;
}

// The exchanged value of the amount, rounded to 2 decimals: gold ("au") is priced from the USD rates.
function exchange(amount: Decimal.Value, exchangeType: string, decimals: number): { exchangedAmt: string, gold: boolean } | null {
	if (global.exchangeRates != null && global.exchangeRates[exchangeType.toLowerCase()] != null) {
		const dec = new Decimal(amount).times(global.exchangeRates[exchangeType.toLowerCase()]);

		return { exchangedAmt: Number(Math.round(dec.toNumber() * 100) / 100).toFixed(decimals), gold: false };

	} else if (exchangeType == "au" && global.exchangeRates != null && global.goldExchangeRates != null) {
		const dec = new Decimal(amount).times(global.exchangeRates.usd).dividedBy(global.goldExchangeRates.usd);

		return { exchangedAmt: Number(Math.round(dec.toNumber() * 100) / 100).toFixed(decimals), gold: true };
	}

	return null;
}

export interface ExchangedFormatData { symbol: string, value: string, unit: string }

// {symbol, value, unit}, or "" when there is no rate for the currency (the pages read the fields of the "" too, and get
// nothing).
export function getExchangedCurrencyFormatData(amount: Decimal.Value, exchangeType: string): ExchangedFormatData | "" {
	const result = exchange(amount, exchangeType, 2);

	if (result == null) {
		return "";
	}

	return result.gold
		? { symbol: "AU", value: addThousandsSeparators(result.exchangedAmt), unit: "oz" }
		: { symbol: global.currencySymbols[exchangeType], value: addThousandsSeparators(result.exchangedAmt), unit: exchangeType };
}

export interface ExchangedCurrency { val: string, symbol: string, unit: string, valRaw: string }

// {val, symbol, unit, valRaw}, or "" when there is no rate for the currency.
export function formatExchangedCurrency(amount: Decimal.Value, exchangeType: string, decimals = 2): ExchangedCurrency | "" {
	const result = exchange(amount, exchangeType, decimals);

	if (result == null) {
		return "";
	}

	return result.gold
		? { val: addThousandsSeparators(result.exchangedAmt), unit: "oz", symbol: "AU", valRaw: result.exchangedAmt }
		: { val: addThousandsSeparators(result.exchangedAmt), symbol: global.currencyTypes[exchangeType].symbol, unit: exchangeType, valRaw: result.exchangedAmt };
}
