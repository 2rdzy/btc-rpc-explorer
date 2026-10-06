// Cuts an array into chunks of `chunkSize` (the last may be shorter).
export function splitArrayIntoChunks<T>(array: T[], chunkSize: number): T[][] {
	const j = array.length;
	const chunks: T[][] = [];

	for (let i = 0; i < j; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}

	return chunks;
}

// Cuts an array into `chunkCount` chunks whose sizes differ by at most one.
export function splitArrayIntoChunksByChunkCount<T>(array: T[], chunkCount: number): T[][] {
	const bigChunkSize = Math.ceil(array.length / chunkCount);
	const bigChunkCount = chunkCount - (chunkCount * bigChunkSize - array.length);

	const chunks: T[][] = [];

	let chunkStart = 0;
	for (let chunk = 0; chunk < chunkCount; chunk++) {
		const chunkSize = (chunk < bigChunkCount ? bigChunkSize : (bigChunkSize - 1));

		chunks.push(array.slice(chunkStart, chunkStart + chunkSize));

		chunkStart += chunkSize;
	}

	return chunks;
}

// The names of an object's own properties.
export function objectProperties(obj: object): string[] {
	const props: string[] = [];
	for (const prop in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, prop)) {
			props.push(prop);
		}
	}

	return props;
}

export function objHasProperty(obj: object, name: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, name);
}

// An object's own properties that are plain values (not objects or functions), as JSON.
export function stringifySimple(object: Record<string, unknown>): string {
	const simpleObject: Record<string, unknown> = {};

	for (const prop in object) {
		if (!Object.prototype.hasOwnProperty.call(object, prop)) {
			continue;
		}

		if (typeof(object[prop]) == 'object') {
			continue;
		}

		if (typeof(object[prop]) == 'function') {
			continue;
		}

		simpleObject[prop] = object[prop];
	}

	return JSON.stringify(simpleObject);
}

// A copy of the object with the given properties hidden, for logging. Setting BTCEXP_SKIP_LOG_OBFUSCATION
// returns the object as it is.
export function obfuscateProperties<T extends object>(obj: T, properties: string[]): T {
	if (process.env.BTCEXP_SKIP_LOG_OBFUSCATION) {
		return obj;
	}

	const objCopy = Object.assign({}, obj) as Record<string, unknown>;

	properties.forEach(name => {
		objCopy[name] = "*****";
	});

	return objCopy as T;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
