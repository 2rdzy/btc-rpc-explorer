// Read values from a parsed query string (req.query). Express gives each value as a string, an array
// (?a=1&a=2) or an object (?a[b]=1), whatever the caller sent, so code that assumes a string needs to
// go through these.

type Query = Record<string, unknown> | null | undefined;

// The value of query parameter `name` if it is a string (the first one, if it was repeated), or
// `defaultValue` when it is missing or is an object.
export function queryString<T = undefined>(query: Query, name: string, defaultValue?: T): string | T {
	const value = query ? query[name] : undefined;

	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value) && typeof value[0] === "string") {
		return value[0];
	}

	return defaultValue as T;
}

// The value of query parameter `name` as a whole number, or `defaultValue` when it is missing or is not a number.
export function queryInt<T = undefined>(query: Query, name: string, defaultValue?: T): number | T {
	const value = queryString(query, name);

	if (value === undefined) {
		return defaultValue as T;
	}

	const number = parseInt(value, 10);

	return Number.isNaN(number) ? (defaultValue as T) : number;
}

// The values of query parameter `name` as a list of strings, for parameters sent as ?name[0]=a&name[1]=b.
// A single ?name=a counts as a list of one. Anything that is not a string (an object, say) becomes null,
// and a missing parameter gives an empty list.
export function queryStringList(query: Query, name: string): (string | null)[] {
	const value = query ? query[name] : undefined;

	if (Array.isArray(value)) {
		return value.map(item => (typeof item === "string" ? item : null));
	}

	return typeof value === "string" ? [value] : [];
}
