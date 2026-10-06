import fs from "fs";
import * as statTracker from "../statTracker.js";
import { logError } from "./errors.js";
import { getRandomString } from "./text.js";
import { objectProperties } from "./collections.js";

// https://stackoverflow.com/a/31424853/673828
export const reflectPromise = <T>(p: Promise<T>): Promise<{ v: T, status: "resolved" } | { e: unknown, status: "rejected" }> =>
	p.then(v => ({v, status: "resolved" as const}),
		e => ({e, status: "rejected" as const}));

// where the callers collect timings: the JavaScript ones start from an empty object
export type PerfResults = Record<string, number> | object;

export const startTimeNanos = (): bigint => process.hrtime.bigint();

export const dtMillis = (startTime: bigint): number => {
	const dtNanos = process.hrtime.bigint() - startTime;

	return Number(dtNanos) * 1e-6;
};

// Runs the function and logs (rather than throws) its error; the result is undefined when it failed.
export const safePromise = async <T>(uid: string, promise: () => Promise<T>): Promise<T | undefined> => {
	try {
		const response = await promise();

		return response;

	} catch (e) {
		logError(uid, e);
	}
};

// Runs the function and tracks how long it took, under `name` (or `name_error` when it throws). When
// perfResults is given, the time is also stored in it, in whole milliseconds (at least 1).
export const timePromise = async <T>(name: string, promise: () => Promise<T>, perfResults: PerfResults | null = null): Promise<T> => {
	const startTime = startTimeNanos();

	try {
		const response = await promise();

		const responseTimeMillis = dtMillis(startTime);

		statTracker.trackPerformance(name, responseTimeMillis);

		if (perfResults) {
			(perfResults as Record<string, number>)[name] = Math.max(1, Math.trunc(responseTimeMillis));
		}

		return response;

	} catch (e) {
		const responseTimeMillis = dtMillis(startTime);

		statTracker.trackPerformance(`${name}_error`, responseTimeMillis);

		if (perfResults) {
			(perfResults as Record<string, number>)[`${name}_error`] = Math.max(1, Math.trunc(responseTimeMillis));
		}

		throw e;
	}
};

export const timeFunction = (uid: string, f: () => void, perfResults: PerfResults | null = null): void => {
	const startTime = startTimeNanos();

	f();

	const responseTimeMillis = dtMillis(startTime);

	statTracker.trackPerformance(uid, responseTimeMillis);

	if (perfResults) {
		(perfResults as Record<string, number>)[uid] = responseTimeMillis;
	}
};

// Waits for all the promises, logging the ones that were rejected.
export const awaitPromises = async <T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]> => {
	const promiseResults = await Promise.allSettled(promises);

	promiseResults.forEach(x => {
		if (x.status == "rejected") {
			if (x.reason) {
				logError("awaitPromises_rejected", x.reason);
			}
		}
	});

	return promiseResults;
};

export interface PerfLogItem {
	id: string,
	date: Date,
	results: Record<string, number>,
	index: number,
	[tag: string]: unknown
}

// the newest first: the last perfLogMaxItems requests, for the performance page
export const perfLog: PerfLogItem[] = [];
let perfLogItemCount = 0;
const perfLogMaxItems = 100;

export const perfLogNewItem = (tags: Record<string, unknown>): { perfId: string, perfResults: Record<string, number> } => {
	const newItem = tags as PerfLogItem;

	newItem.id = getRandomString(12, "aA#");
	newItem.date = new Date();
	newItem.results = {};
	newItem.index = perfLogItemCount;

	perfLogItemCount++;

	perfLog.splice(0, 0, newItem);

	while (perfLog.length > perfLogMaxItems) {
		perfLog.splice(perfLog.length - 1, 1);
	}

	return {
		perfId:newItem.id,
		perfResults:newItem.results
	};
};

// Counts an event by name, and optionally by the values of its params (global.appEventStats).
export function trackAppEvent(name: string, count = 1, params: Record<string, unknown> | null = null): void {
	if (!global.appEventStats[name]) {
		global.appEventStats[name] = {count:0};
	}

	global.appEventStats[name].count += count;
	global.appEventStats[name].last = new Date();

	if (params != null) {
		if (global.appEventStats[name].params == null) {
			global.appEventStats[name].params = {};
		}

		const props = objectProperties(params);

		props.forEach(prop => {
			const key = `${prop}[${params[prop]}]`;

			if (global.appEventStats[name].params[key] == null) {
				global.appEventStats[name].params[key] = {count: 0};
			}

			global.appEventStats[name].params[key].count += count;
		});
	}
}

// A small JSON file cache. A version above 1 is part of the file name, and removes the files of older versions.
export const fileCache = (cacheDir: string, cacheName: string, cacheVersion = 1) => {
	const filename = (version: number) => { return ((version > 1) ? [cacheName, `v${version}`].join("-") : cacheName) + ".json"; };
	const filepath = `${cacheDir}/${filename(cacheVersion)}`;

	if (cacheVersion > 1) {
		// remove old versions
		for (let i = 1; i < cacheVersion; i++) {
			if (fs.existsSync(`${cacheDir}/${filename(i)}`)) {
				fs.unlinkSync(`${cacheDir}/${filename(i)}`);
			}
		}
	}

	return {
		// the cached object; null when there is none, or when the file is corrupt (it is deleted then)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		tryLoadJson: (): any => {
			if (fs.existsSync(filepath)) {
				const rawData = fs.readFileSync(filepath);

				try {
					return JSON.parse(rawData.toString());

				} catch (e) {
					logError("378y43edewe", e);

					fs.unlinkSync(filepath);

					return null;
				}
			}

			return null;
		},
		writeJson: (obj: unknown): void => {
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir);
			}

			fs.writeFileSync(filepath, JSON.stringify(obj, null, 4));
		}
	};
};
