// The pages and endpoints that test/pages.test.ts requests from a running explorer, with what to expect. The same
// list is what test/fixtures/record.ts requests to record the node's answers (npm run record-fixtures), so a new
// entry needs a recording.

export interface PageCase {
	path: string,
	// POST these form fields (with a CSRF token) instead of a GET
	post?: Record<string, string>,
	// GET with the CSRF token of a session in the query (for what executes something, as the RPC browser does)
	csrf?: boolean,
	// the status (default 200); 301 and 302 mean a redirect, and `location` is where to
	status?: number,
	location?: string,
	// text the page has to contain
	contains?: (string | RegExp)[],
	// wait this long after the request (for the endpoints that start a build in the background)
	settleMs?: number
}

// block 975700 of the BLAKE2b chain (after the fork at 961640), and its first transactions
const BLOCK = "0000000000000000a9255f39c2ab84cfef67d19bb18b443bff86186c4f820e3c";
const COINBASE = "1c7aedbd3d98c3554046697d1294ea3d3331143233d7cf0659ff5eb4388be55d";
const TX1 = "c457065cc0a4dc8291e29240ade3214fce2ea8c172e343f950e4e4a9b72df404";
const TX2 = "eb7fb4afdd68663e4b3296b91f2d2ed654b6b5323a984aa1ccd7d0501b184c2c";
const GENESIS_TX = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const UNKNOWN = "ab".repeat(32);

export const pages: PageCase[] = [
	// the main pages
	{ path: "/", contains: ["Blake2b", "Latest Blocks"] },
	{ path: "/node-details", contains: ["Blake2b", "Node Details"] },
	{ path: "/peers", contains: ["Peers"] },
	{ path: "/blocks", contains: ["Blocks"] },
	{ path: "/mempool-summary", contains: ["Mempool"] },
	{ path: "/mining-summary", contains: ["Mining"] },
	{ path: "/difficulty-history", contains: ["Difficulty"] },
	{ path: "/next-block", contains: ["Next Block"] },
	{ path: "/predicted-blocks", contains: ["Predicted"] },
	{ path: "/tx-stats", contains: ["Transaction"] },
	{ path: "/block-stats", contains: ["Block"] },
	{ path: "/next-halving", contains: ["Halving"] },
	{ path: "/utxo-set", contains: ["UTXO"] },
	{ path: "/mining-template", status: 301 },
	{ path: "/mempool-transactions" },
	{ path: "/tools", contains: ["Tools"] },

	// blocks: after the fork (BLAKE2b, the extended header), before it, at it, and the first
	{ path: "/block-height/975700", contains: ["Block #975,700", BLOCK] },
	{ path: `/block/${BLOCK}`, contains: ["Block #975,700"] },
	{ path: "/block-height/961640", contains: ["961,640"] },
	{ path: "/block-height/961639", contains: ["961,639"] },
	{ path: "/block-height/0", contains: ["Block #0", "Genesis"] },
	{ path: "/block-analysis/975700" },
	{ path: "/block-height/99999999", status: 404, contains: ["Failed loading block"] },
	{ path: `/block/${UNKNOWN}`, status: 404, contains: ["Failed to load block"] },

	// transactions: a coinbase, ordinary ones, the genesis coinbase, and one that does not exist
	{ path: `/tx/${COINBASE}`, contains: ["Transaction", COINBASE] },
	{ path: `/tx/${TX1}`, contains: ["Transaction", TX1] },
	{ path: `/tx/${TX2}`, contains: ["Transaction", TX2] },
	{ path: `/tx/${TX1}@975700`, contains: [TX1] },
	{ path: `/tx/${GENESIS_TX}`, contains: ["Genesis"] },
	{ path: `/tx/${UNKNOWN}`, status: 404, contains: ["Failed to load transaction"] },

	// paging and sorting
	{ path: "/blocks?limit=5&offset=2&sort=asc", contains: ["Blocks"] },
	{ path: "/blocks?limit=3&offset=1&sort=desc", contains: ["Blocks"] },
	{ path: "/blocks?limit=abc", contains: ["Blocks"] },
	{ path: "/mempool-transactions?limit=5&offset=2&sort=asc" },
	{ path: `/block/${BLOCK}?limit=5&offset=2&sort=asc`, contains: ["Block #975,700"] },
	{ path: "/block-height/975700?limit=3&offset=1", contains: ["Block #975,700"] },

	// addresses and keys
	{ path: `/address/${ADDRESS}`, contains: [ADDRESS] },
	{ path: `/address/${ADDRESS}?limit=5&offset=1&sort=asc`, contains: [ADDRESS] },
	{ path: `/xyzpub/${ZPUB}`, contains: ["zpub"] },

	// search
	{ path: "/search", post: { query: "975700" }, status: 302, location: "./block-height/975700" },
	{ path: "/search", post: { query: BLOCK }, status: 302, location: `./block/${BLOCK}` },
	{ path: "/search", post: { query: TX1 }, status: 302, location: `./tx/${TX1}` },
	{ path: "/search", post: { query: ADDRESS }, status: 302, location: `./address/${ADDRESS}` },
	{ path: "/search", post: { query: UNKNOWN }, status: 302, location: "./" },
	{ path: "/search", post: { query: "" }, status: 302, location: "./" },
	{ path: "/search", post: { query: "hello" }, status: 302, location: "./" },
	{ path: "/search", post: { query: "99999999" }, status: 302, location: "./" },
	{ path: "/search", post: { query: `${TX1}@975700` }, status: 302, location: `./tx/${TX1}@975700` },
	{ path: "/search", post: { query: ZPUB }, status: 302, location: `./xyzpub/${ZPUB}` },
	{ path: "/search", post: { query: "tpubD6NzVbkrYhZ4X" }, status: 302, location: "./xyzpub/tpubD6NzVbkrYhZ4X" },
	{ path: "/search" },
	{ path: "/block-analysis" },

	// the RPC tools
	{ path: "/rpc-browser", contains: ["RPC Browser"] },
	{ path: "/rpc-browser?method=getblockcount", contains: ["getblockcount", "Arguments"] },
	{ path: "/rpc-browser?method=getblock", contains: ["getblock"] },
	{ path: "/rpc-browser?method=getblockcount&execute=true", csrf: true, contains: ["getblockcount"] },
	{ path: `/rpc-browser?method=getblockhash&execute=true&args[0]=975700`, csrf: true, contains: [BLOCK] },
	{ path: `/rpc-browser?method=getblockheader&execute=true&args[0]=${BLOCK}&args[1]=true`, csrf: true, contains: ["merkleroot"] },
	{ path: "/rpc-browser?method=getblockhash&execute=true&args[0]=99999999", csrf: true, contains: ["Block height out of range"] },
	{ path: "/rpc-browser?method=nosuchmethod", contains: ["nosuchmethod"] },
	{ path: "/rpc-terminal", contains: ["Terminal"] },
	{ path: "/rpc-terminal", post: { cmd: "getblockhash 975700" }, contains: [BLOCK] },
	{ path: "/rpc-terminal", post: { cmd: "getblockhash 99999999" }, contains: ["Block height out of range", "-8"] },
	{ path: "/rpc-terminal", post: { cmd: "stop" }, contains: ["blacklisted"] },

	// the settings and the favourites, which redirect back to where they came from (here: the home page)
	{ path: "/changeSetting?name=hideElectrumTrustWarnings&value=true", status: 302, location: "/" },
	{ path: "/changeSetting?name=userTzOffset&value=abc", status: 302, location: "/" },
	{ path: "/changeSetting?name=userTzOffset&value=2", status: 302, location: "/" },
	{ path: "/changeSetting", status: 302, location: "/" },
	{ path: "/session-data?action=add-rpc-favorite&data=getblockcount", status: 302, location: "/" },
	{ path: "/session-data?action=remove-rpc-favorite&data=getblockcount", status: 302, location: "/" },
	{ path: "/session-data", status: 302, location: "/" },
	{ path: "/user-settings", contains: ["Settings"] },

	// the terminal, behind the RPC browser
	{ path: "/terminal" },
	{ path: "/terminal", post: { cmd: "" }, contains: ["Unknown command"] },
	{ path: "/terminal", post: { cmd: "getblockcount" }, contains: ["Unknown command"] },
	{ path: "/terminal", post: { cmd: "parsescript 51" }, contains: ["OP_1"] },
	{ path: "/terminal", post: { cmd: "parsescript zz" }, contains: ["needs a script as hex"] },
	{ path: "/predicted-blocks-old" },

	// the static pages
	{ path: "/about", contains: ["About", "Dan Janosik"] },
	{ path: "/changelog" },
	{ path: "/fun", contains: ["Fun"] },
	{ path: "/quotes", contains: ["Quotes"] },
	{ path: "/holidays" },
	{ path: "/quote/0" },
	{ path: "/bitcoin-whitepaper" },
	{ path: "/nonexistent", status: 404 },

	// the public API
	{ path: "/api/docs", contains: ["API"] },
	{ path: "/api/version" },
	{ path: "/api/blocks/tip", contains: ["hash"] },
	{ path: "/api/blocks/tip/height" },
	{ path: "/api/block/975700", contains: [BLOCK, "difficulty_blake2b"] },
	{ path: "/api/block/header/975700", contains: [BLOCK] },
	{ path: `/api/tx/${TX1}`, contains: [TX1, "fee"] },
	{ path: "/api/blockchain/coins" },
	{ path: "/api/blockchain/next-halving" },
	{ path: `/api/address/${ADDRESS}`, contains: ["bech32"] },
	{ path: `/api/util/xyzpub/${ZPUB}`, status: 302 },
	{ path: `/api/xyzpub/${ZPUB}`, contains: ["zpub"] },
	{ path: `/api/xyzpub/addresses/${ZPUB}?limit=2` },
	{ path: "/api/mining/hashrate" },
	{ path: "/api/mining/diff-adj-estimate" },
	{ path: "/api/mining/next-block" },
	{ path: "/api/mining/next-block/txids" },
	{ path: `/api/mining/next-block/includes/${TX1}` },
	{ path: "/api/mining/miner-summary?startHeight=975690&endHeight=975693" },
	{ path: "/api/mempool/summary" },
	{ path: "/api/mempool/fees", contains: ["nextBlock"] },
	{ path: "/api/price", contains: ["disabled"] },
	{ path: "/api/price/sats", contains: ["disabled"] },
	{ path: "/api/price/marketcap", contains: ["disabled"] },
	{ path: "/api/quotes/all" },
	{ path: "/api/quotes/random" },
	{ path: "/api/holidays/all" },
	{ path: "/api/holidays/today" },
	{ path: "/api/changelog" },
	{ path: "/api/tx/volume/24h" },
	{ path: "/api/blockchain/utxo-set", contains: ["total_amount"] },
	{ path: `/api/xyzpub/txids/${ZPUB}?limit=2` },

	// what the pages load in the background
	{ path: "/snippet/next-block" },
	{ path: "/snippet/index-halving-countdown" },
	{ path: "/snippet/timestamp" },
	{ path: "/snippet/formatCurrencyAmount/1" },
	{ path: "/internal-api/blocks-by-height/975699,975700" },
	{ path: "/internal-api/block-headers-by-height/975699,975700" },
	{ path: "/internal-api/block-stats-by-height/975699,975700" },
	{ path: "/internal-api/difficulty-by-height/975744" },
	{ path: `/internal-api/raw-tx-with-inputs/${TX1}` },
	{ path: "/internal-api/build-mempool-summary?statusId=smoke", settleMs: 3000 },
	{ path: "/internal-api/mempool-summary-status?statusId=smoke" },
	{ path: "/internal-api/get-mempool-summary?statusId=smoke" },
	{ path: "/internal-api/build-predicted-blocks?statusId=smoke", settleMs: 3000 },
	{ path: "/internal-api/get-predicted-blocks?statusId=smoke" },
	{ path: "/internal-api/build-mining-summary/975690/975693?statusId=smoke", settleMs: 3000 },
	{ path: "/internal-api/get-mining-summary?statusId=smoke" },

	// the admin pages
	{ path: "/admin/dashboard" },
	{ path: "/admin/app-stats", contains: ["Stats"] },
	{ path: "/admin/perf-log" },
	{ path: "/admin/os-stats" }
];
