import type { Duration } from "moment";
import { Decimal } from "decimal.js";

export function formatHex(hex: string, outputFormat: BufferEncoding = "utf8"): string {
	return Buffer.from(hex, "hex").toString(outputFormat);
}

// A random string of the given length. `chars` says which kinds of character to use: "a" for lower case
// letters, "A" for upper case, "#" for digits and "!" for punctuation.
export function getRandomString(length: number, chars: string): string {
	let mask = '';

	if (chars.indexOf('a') > -1) {
		mask += 'abcdefghijklmnopqrstuvwxyz';
	}

	if (chars.indexOf('A') > -1) {
		mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	}

	if (chars.indexOf('#') > -1) {
		mask += '0123456789';
	}

	if (chars.indexOf('!') > -1) {
		mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
	}

	let result = '';
	for (let i = length; i > 0; --i) {
		result += mask[Math.floor(Math.random() * mask.length)];
	}

	return result;
}

export function addThousandsSeparators(x: { toString(): string }): string {
	const parts = x.toString().split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");

	return parts.join(".");
}

export function ellipsize(str: string, length: number, ending = "…"): string {
	if (str.length <= length) {
		return str;

	} else {
		return str.substring(0, length - ending.length) + ending;
	}
}

export function ellipsizeMiddle(str: string, length: number, replacement = "…", extraCharAtStart = true): string {
	if (str.length <= length) {
		return str;

	} else {
		//"abcde"(3)->"a…e"
		//"abcdef"(3)->"a…f"
		//"abcdef"(5)->"ab…ef"
		//"abcdef"(4)->"ab…f"
		if ((length - replacement.length) % 2 == 0) {
			return str.substring(0, (length - replacement.length) / 2) + replacement + str.slice(-(length - replacement.length) / 2);

		} else {
			if (extraCharAtStart) {
				return str.substring(0, Math.ceil((length - replacement.length) / 2)) + replacement + str.slice(-Math.floor((length - replacement.length) / 2));

			} else {
				return str.substring(0, Math.floor((length - replacement.length) / 2)) + replacement + str.slice(-Math.ceil((length - replacement.length) / 2));
			}

		}
	}
}

// Writes a number given in exponent form (1.5e-7, 2.5e3) out in full.
export function parseExponentStringDouble(val: number | string): string {
	const [lead, decimal, pow] = val.toString().split(/e|\./);

	return +pow <= 0
		? "0." + "0".repeat(Math.abs(Number(pow))-1) + lead + decimal
		: lead + ( +pow >= decimal.length ? (decimal + "0".repeat(+pow-decimal.length)) : (decimal.slice(0,+pow)+"."+decimal.slice(+pow)));
}

export interface SummarizeDurationOptions {
	oneElement?: boolean;
	stripZeroes?: boolean;
	shortenDurationNames?: boolean;
	outputCommas?: boolean;
	decimalPlaces?: number;
}

// A moment duration as short text, such as "2d, 4hr". Options:
//  - oneElement (default: false): only the largest unit, such as "2.1 days"
//  - stripZeroes (default: true): leave out units that are zero
//  - shortenDurationNames (default: true): "d" for "days", and so on
//  - outputCommas (default: true): separate the units with commas
//  - decimalPlaces (default: 1): for oneElement
export function summarizeDuration(duration: Duration, options: SummarizeDurationOptions = {}): string {
	const oneElement = "oneElement" in options ? options.oneElement : false;
	const stripZeroes = "stripZeroes" in options ? options.stripZeroes : true;
	const shortenDurationNames = "shortenDurationNames" in options ? options.shortenDurationNames : true;
	const outputCommas = "outputCommas" in options ? options.outputCommas : true;
	const decimalPlaces = "decimalPlaces" in options ? options.decimalPlaces : 1;

	let formatParts = duration.format().split(",").map((x: string) => x.trim());
	let str = formatParts.join(", ");

	if (oneElement) {
		const parts = [duration.asYears(), duration.asMonths(), duration.asWeeks(), duration.asDays(), duration.asHours(), duration.asMinutes(), duration.asSeconds()];
		const partNames = ["years", "months", "weeks", "days", "hours", "minutes", "seconds"];

		for (let i = 0; i < parts.length; i++) {
			if (parts[i] > 1) {
				str = `${new Decimal(parts[i]).toDP(decimalPlaces)} ${partNames[i]}`;

				break;
			}
		}
	} else if (stripZeroes) {
		// strip duration elements with zero magnitude (e.g. 11 months 0 days 12 hours)
		formatParts = formatParts.map((x: string) => { return x.startsWith("0 ") ? "" : x; }).filter((x: string) => x.length > 0);

		// hack: moment.js seems to have a bug where there can be formatted items that include "-0" magnitude elements
		formatParts = formatParts.map((x: string) => { return x.startsWith("-0 ") ? "" : x; }).filter((x: string) => x.length > 0);

		str = formatParts.join(", ");
	}


	if (shortenDurationNames) {
		str = str.replace(" years", "y");
		str = str.replace(" year", "y");

		str = str.replace(" months", "mo");
		str = str.replace(" month", "mo");

		str = str.replace(" weeks", "w");
		str = str.replace(" week", "w");

		str = str.replace(" days", "d");
		str = str.replace(" day", "d");

		str = str.replace(" hours", "hr");
		str = str.replace(" hour", "hr");

		str = str.replace(" minutes", "min");
		str = str.replace(" minute", "min");
	}

	if (!outputCommas) {
		str = str.split(", ").join(" ");
	}

	return str;
}
