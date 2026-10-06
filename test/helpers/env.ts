import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The environment for the tests. It is its own module because imports run before the other code of a file: setup.ts
// imports this first, so the settings are in place before the explorer's config is loaded.

// no in-memory RPC cache: each test sets its own RPC answers and must see them
process.env.BTCEXP_NO_INMEMORY_RPC_CACHE = 'true';

// the tests write cache files (UTXO set, mempool summaries, ...): keep them out of the real cache directory
if (!process.env.BTCEXP_FILESYSTEM_CACHE_DIR) {
	process.env.BTCEXP_FILESYSTEM_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'btcexp-test-cache-'));
}
