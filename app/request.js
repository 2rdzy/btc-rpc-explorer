"use strict";

// Read values from a parsed query string (req.query). Express gives each value as a string, an array
// (?a=1&a=2) or an object (?a[b]=1), whatever the caller sent, so code that assumes a string needs to
// go through these.

// The value of query parameter `name` if it is a string (the first one, if it was repeated), or
// `defaultValue` when it is missing or is an object.
function queryString(query, name, defaultValue) {
	const value = query ? query[name] : undefined;

	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value) && typeof value[0] === "string") {
		return value[0];
	}

	return defaultValue;
}

// The value of query parameter `name` as a whole number, or `defaultValue` when it is missing or is not a number.
function queryInt(query, name, defaultValue) {
	const value = queryString(query, name);

	if (value === undefined) {
		return defaultValue;
	}

	const number = parseInt(value, 10);

	return Number.isNaN(number) ? defaultValue : number;
}

module.exports = { queryString, queryInt };
