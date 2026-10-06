import debug from "debug";
const debugLog = debug("btcexp:cache");

import { LRUCache } from "lru-cache";

import utils from "./utils.js";

const watchKeysRegex = /regexToMatchCacheKeysForDebugLogging/;

// what the caches hold: whatever JSON the RPC calls returned
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CachedValue = any;

export type CacheEventHandler = (cacheType: string, eventType: string, key: string) => void;

export interface Cache {
	get(key: string): Promise<CachedValue>;
	set(key: string, obj: unknown, maxAge?: number): void | Promise<void>;
}

export function createMemoryLruCache(cacheName: string, cacheObj: LRUCache<string, CachedValue>, onCacheEvent: CacheEventHandler) {
	return {
		get: (key: string): Promise<CachedValue> => {
			return new Promise((resolve) => {
				onCacheEvent("memory", "try", key);

				const val = cacheObj.get(key);

				if (val != null) {
					onCacheEvent("memory", "hit", key);

					if (key.match(watchKeysRegex)) {
						debugLog(`cache.${cacheName}[${key}]: HIT  (${utils.addThousandsSeparators(JSON.stringify(val).length)} B)`);
					}
				} else {
					onCacheEvent("memory", "miss", key);

					if (key.match(watchKeysRegex)) {
						debugLog(`cache.${cacheName}[${key}]: MISS`);
					}
				}

				resolve(val);
			});
		},
		set: (key: string, obj: unknown, maxAge?: number) => {
			cacheObj.set(key, obj, {ttl: maxAge});

			if (key.match(watchKeysRegex)) {
				debugLog(`cache.${cacheName}[${key}]: SET  (${utils.addThousandsSeparators(JSON.stringify(obj).length)} B), T=${maxAge}`);
			}

			onCacheEvent("memory", "set", key);
		},
		del: (key: string) => {
			cacheObj.delete(key);

			onCacheEvent("memory", "del", key);

			if (key.match(watchKeysRegex)) {
				debugLog(`cache.${cacheName}[${key}]: DEL`);
			}
		}
	};
}

function tryCache(cacheKey: string, cacheObjs: Cache[], index: number, resolve: (value: CachedValue) => void, reject: (reason?: unknown) => void) {
	if (index == cacheObjs.length) {
		resolve(null);

		return;
	}

	cacheObjs[index].get(cacheKey).then((result) => {
		if (result != null) {
			resolve(result);

		} else {
			tryCache(cacheKey, cacheObjs, index + 1, resolve, reject);
		}

	// a cache that fails (Redis, say) fails the lookup; without this the lookup never finished
	}).catch(reject);
}

// Looks a key up in each cache in turn (the fastest first), and stores to all of them.
export function createTieredCache(cacheObjs: Cache[]) {
	return {
		get: (key: string): Promise<CachedValue> => {
			return new Promise((resolve, reject) => {
				tryCache(key, cacheObjs, 0, resolve, reject);
			});
		},
		set: (key: string, obj: unknown, maxAge?: number) => {
			for (let i = 0; i < cacheObjs.length; i++) {
				cacheObjs[i].set(key, obj, maxAge);
			}
		}
	};
}

export function lruCache(size: number) {
	return new LRUCache<string, CachedValue>({
		max: size
	});
}
