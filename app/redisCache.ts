import { createClient } from "redis";

import config from "./config.js";
import { logError } from "./helpers/errors.js";
import type { CachedValue, CacheEventHandler } from "./cacheUtils.js";

let redisClient: ReturnType<typeof createClient> | null = null;
if (config.redisUrl) {
	redisClient = createClient({url:config.redisUrl});
}

export const active = (redisClient != null);

// the client, connected: only used when Redis is configured (see active)
async function connectedClient() {
	if (!redisClient) {
		throw new Error("Redis is not configured (BTCEXP_REDIS_URL)");
	}

	if (!redisClient.isOpen) {
		await redisClient.connect();
	}

	return redisClient;
}

export function createCache(keyPrefix: string, onCacheEvent: CacheEventHandler) {
	return {
		get: async function(key: string): Promise<CachedValue> {
			const client = await connectedClient();

			const prefixedKey = `${keyPrefix}-${key}`;

			onCacheEvent("redis", "try", prefixedKey);

			try {
				const result = await client.get(prefixedKey);

				if (result == null) {
					onCacheEvent("redis", "miss", prefixedKey);

					return null;

				} else {
					onCacheEvent("redis", "hit", prefixedKey);

					return JSON.parse(result);
				}
			} catch (err) {
				onCacheEvent("redis", "error", prefixedKey);

				logError("328rhwefghsdgsdss", err, {key:prefixedKey});

				throw err;
			}
		},
		set: async function(key: string, obj: unknown, maxAgeMillis?: number): Promise<void> {
			const client = await connectedClient();

			const prefixedKey = `${keyPrefix}-${key}`;

			await client.set(prefixedKey, JSON.stringify(obj), maxAgeMillis === undefined ? {} : {"PX": maxAgeMillis});
		}
	};
}
