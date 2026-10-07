##### v4.0.0
###### 2026-10-07

This is the first release of the fork for the BLAKE2b chain of Bitcoin Knots (BTCB2). It is a major release: the code base is TypeScript, the explorer runs from a build, and several defaults are safer than before. Read "Upgrading" first.

###### Upgrading

* Run `npm ci && npm run build` and start the explorer with `npm start` (or `node dist/bin/cli.js`): it runs from `dist/` now. The Docker image does this itself. Node 20 or newer is needed.
* `NODE_ENV` defaults to `production`. Without `BTCEXP_COOKIE_SECRET` and an RPC password to derive it from, a random cookie secret is used, so sessions do not survive a restart.
* Electrum servers over `tls://` are verified. A server with a self-signed certificate needs `BTCEXP_ELECTRUM_TLS_FINGERPRINT` (or `BTCEXP_ELECTRUM_TLS_CA`); `BTCEXP_ELECTRUM_TLS_ALLOW_UNVERIFIED` switches the check off.
* Removed: demo mode (`BTCEXP_DEMO` and `--demo`; it opened the RPC tools to everyone), the S3 asset upload and its settings (`BTCEXP_S3_BUCKET`, `BTCEXP_S3_BUCKET_PATH`, `BTCEXP_S3_BUCKET_REGION`, `BTCEXP_CDN_BASE_URL`), and the unauthenticated `/connect` and `/disconnect` routes.
* The Redis cache keys changed (they no longer contain a hash of the RPC password), so an existing cache is simply not used.
* New settings: `BTCEXP_PUBLIC_URL` (link preview tags), `BTCEXP_RATE_LIMIT_LOGIN_FAILURES`.

###### BLAKE2b chain

* Difficulty: the `difficulty_blake2b` field of Knots is used. The difficulty history shows the work per block (the expected number of hashes) on one scale, with the SHA-256d epochs in grey and the BLAKE2b ones in red, the fork marked, and the fall of the work at the switch (about 7 million times on this chain) visible in the chart and the table.
* Blocks: the extended header (`nonce2`, `nonce3`, extranonce and the rest) is shown for BLAKE2b blocks.
* Hashrate is not reported across the fork. The node details page shows the fork and its deployment state.
* The block template is requested with the `blake2b` rule; a node error for the status calls is reported instead of crashing `/next-block`.
* The node version is read from the Knots subversion string.
* Miners of this chain are identified from their coinbase tags (AlphaPool, Lazarus, B2Pool.io, omegapool.tech, CONVOY, dxpool, Legata, Rabid Pool); no upstream list knows them.

###### Security

* Dependencies with known vulnerabilities are updated; Dependabot and a monthly `npm audit` keep watch, and there is a single lock file.
* `csurf` is replaced by `csrf-sync`; failed logins are rate limited; the Basic authentication password is compared in constant time; the RPC password is no longer hashed into cache keys.
* Electrum certificates are verified (see above); a bug that let `/api/xyzpub/txids` run out of memory when no address API was configured is fixed.
* A cross-site scripting hole inherited from upstream is closed: `/changeSetting` kept any value, and the time zone settings are printed into a script on every page, so a crafted link could run script in a visitor's pages. Settings are now checked when they are set and when the cookie is read, and printed escaped.
* The RPC browser, the RPC terminal and the admin pages (`/admin/*`, which had no protection at all) need the password. The session cookie is `SameSite=Lax`, and responses carry `X-Content-Type-Options`, `Referrer-Policy` and (except snippets) `X-Frame-Options`. There is no Content-Security-Policy yet.
* One request can no longer ask for a million blocks, thousands of heights or an xpub search with a huge gap: block ranges are limited to 10,000 blocks, height and transaction id lists to 100, xpub address lists to 1,000 and the gap limit to 100. Uncollected builds are dropped after an hour.
* The two Electrum client packages come from this account's forks, and the S3 upload, with its dependency, is gone.

###### Electrum

* With several Electrum servers the address page shows what most of them say and a trust warning, with each server's answer, when they differ. (The comparison never worked before.) A server that is down, or cannot answer, is left out as long as another one does.

###### Other changes

* Red theme and Blake2b branding, with better link contrast in the dark themes; all text says Bitcoin Knots and what this fork is; the upstream demo links are gone; the README and setup docs are rewritten for this fork; the original authors are credited on the About page and in the README.
* A block or transaction that does not exist answers 404 instead of 500.
* The fee rate chart and table of the mempool summary were in sat per weight unit while labelled sat/vB, so every rate was four times too low and most transactions fell into the "[0 - 1)" bucket. They are in sat/vB now.
* The RPC terminal and browser show the node's own error message.
* `/api/price/marketcap` no longer fails when exchange rates are disabled, and further bugs found by the review and by the tests are fixed.
* The block analysis asked for ten transactions at a time, which for a large block was hundreds of requests and used up the rate limit, after which nothing worked for a while. It asks for 50, and the calls the pages make in the background (`/internal-api/`) no longer count towards the rate limit.
* The difficulty history no longer reuses BLAKE2b epochs that an older version cached with a wrong difficulty (worked out from the bits as if the proof of work were SHA-256d), which left the BLAKE2b line short and put a bogus step in the chart.
* Docker: a multi-stage image that runs as a non-root user under `tini`, a compose file bound to localhost, and a CI job that builds it.
* Tests: about 600 tests run in CI on Node 20 and 22, among them page tests that run the whole explorer against recorded and made-up node answers.
* The charts of the transaction stats mark the block where the BLAKE2b chain splits off (a dashed line with a label); the line is grey before it (history shared with Bitcoin) and red after it.
* The change chart of the difficulty history is grey before the fork and red after it, like the other charts.
* The home page no longer nests a row without a column count inside the mempool row (Bootstrap column classes with no number), and pages no longer start with HTML comments in front of the doctype (template comments written with `//` were sent to the browser).


##### v3.5.1
###### 2025-07-02

* Minor cleanup
* Fix self-identified version number


##### v3.5.0
###### 2025-06-23

* Fix for node details page display on 28.0+
* Tweak display of miner "notes" (disclaimer for Patoshi)
* Fix for display of JSON-data content
* New holidays and quotes
* Updated miner IDs (including removal of 3 probably false positives from the "Patoshi" list)
* Updated dependencies


##### v3.4.0
###### 2023-06-14

* Breaking changes to the API (see [./api/changelog](/api/changelog))
* Homepage
	* New "Next Halving" widget in Network Summary
	* Show difficulty ATH comparison
	* Show "Next Block" fullness
	* Progress bar for difficulty adjustment estimate
	* Include median fee rate for next-block estimates (also on [/next-block](./next-block))
	* Show a banner if 'today' is a Bitcoin 'Holiday' (see more below)
* Minor fixes for running against Bitcoin Core v23
* Block Analysis: include top "days destroyed" transactions
* URL change: /mining-template -> /next-block (redirect is included for compatibility)
* On Extended PubKey pages, include balance data for various address (if Electrum server is configured)
* New [/next-halving](./next-halving) tool
* Several new API actions/changes; see [/api/changelog](./api/changelog)
* New [/holidays](./holidays), a curated list of Bitcoin 'Holidays'
* Support for different view options on [/fun](./fun)
* On [/difficulty-history](./difficulty-history), make delta graph honor timespan filtering
* Proper use of production-ready MemoryStore for session data
* Support for serving static assets via a configurable CDN
* Misc fixes for erroneous data display on non-mainnet nodes
* Switch from fontawesome to bootstrap-icons v1.8.0
* Refreshed miner-identification database
* Refreshed "Dark" theme with blues toned down (legacy dark theme still available)
* UI/UX tweaks
* Misc minor fixes
* Updated dependencies


##### v3.3.0
###### 2021-12-07

* New tool for viewing the UTXO Set: [/utxo-set](./utxo-set)
* New API actions:
	* [/api/blockchain/utxo-set](./api/blockchain/utxo-set)
	* [/api/address/yourAddress](./api/address/yourAddress)
	* [/api/mining/next-block](./api/mining/next-block)
	* [/api/mining/next-block/txids](./api/mining/next-block/txids)
	* [/api/mining/next-block/includes/:txid](./api/mining/next-block/includes/yourTxid)
	* [/api/mining/miner-summary](./api/mining/miner-summary?since=1d)
* Major fixes for data displayed in [/tx-stats](./tx-stats) tool
* Updated miners, including identification of "Patoshi"-pattern blocks
* [/node-details](./node-details): Include `coinstatsindex` status
* Support querying UTXO Set even with slowDeviceMode=true, iff coinstatsindex is available
* Fix for difficulty adjustment estimate
* [/difficulty-history](./difficulty-history): Support for viewing different time ranges
* When viewing unconfirmed transaction details, show an info dialog if the transaction is predicted to be confirmed in the next block
* Performance improvements
	* Fix for performance degradation over time due to slow "estimatedSupply" function
	* Homepage speedup by making "Estimated Next Block" data load asynchonously
	* Caching for [/difficulty-history](./difficulty-history) data
* Unicode formatting for OP_RETURN and other similar data (with ascii+hex accessible via toggle)
* New `.env` options for setting defaults (see `.env-sample` for details):
	* BTCEXP_DISPLAY_CURRENCY (btc,sat,local)
	* BTCEXP_LOCAL_CURRENCY (usd,eur,gbp)
	* BTCEXP_UI_TIMEZONE (utc,local)
	* BTCEXP_UI_HIDE_INFO_PANELS (true,false)
* Support for displaying timestamps in local timezone (by using browser default, or setting a manual offset)
* Cleanup treatment of `locktime` on transaction details pages
* Unique favicon color based on the active network (mainnet=orange, testnet=green, signet=magenta, regtest=gray)
* Lots of minor styling improvements
* Error handling improvements
* Fix for `/api/quotes/all`
* Fix for incorrect date on "Diario El Salvador..." fun item (thanks [@Dirkson643](https://github.com/Dirkson643))
* New `Fun` items related to Taproot activation
* Performance log admin page at [/admin/perf-log](./admin/perf-log)
* Updated dependencies


##### v3.2.0
###### 2021-08-10

* Public API! See the docs at [/api/docs](./api/docs) (thanks [@pointbiz](https://github.com/pointbiz))
* XPUB pages: search for any xpub (ypub, zpub, etc) and see summary details and a list of associated addresses (thanks [@pointbiz](https://github.com/pointbiz))
* Homepage: add "Predicted Next Block" section
* Mempool Summary: add top-fee transactions table
* Improvements to transaction details UI, especially on smaller screens
* Cleanup support for Taproot/bech32m
* New [/mining-template](./mining-template) tool, showing structured output of `getblocktemplate` command
* Various improvements to charts and graphs throughout the tool (including lots of y-axis changes: linear->log)
* Better support for BIP9 soft forks shown on [/node-details](./node-details) (e.g. Taproot ST in 0.21.1) (Thanks [@Pantamis](https://github.com/Pantamis))
* New "Recent" and "Favorites" sections on [/rpc-browser](./rpc-browser)
* Block lists: show (min, avg, max) fee rates instead of just avg
* Random Bitcoin-related quote shown in footer on each page load
* New [/quotes](./quotes), curated list of Bitcoin-related quotes (each quote also having its own page like [this](`./quote/0`))
* Preemptive support for upcoming format change to `getrawtransaction` output (thanks [@xanoni](https://github.com/xanoni))
* Fix for incorrect homepage block count when using `BTCEXP_UI_HOME_PAGE_LATEST_BLOCKS_COUNT`
* Fix for inaccurate difficulty adjustment estimates
* Link to Tor v3 Hidden Service in footer
* Fix for `DEBUG` environment variable being ignored
* Fix for [/rpc-terminal](./rpc-terminal) not parsing non-int parameters properly
* Fix for edge case where txindex availability check fails at startup (add retries with exp. backoff)
* Fix for tiny-value display (i.e. 1e-8 -> 0.00000001)
* Misc UI/UX tweaks
* Cache busting for frontend resources
* Improved error handling in many places
* Updated dependencies


##### v3.1.1
###### 2021-04-20

* Fix SSO flow broken by v3.0.0 update
* Fix for regtest network errors on homepage
* Fix for server errors in Docker-based installs


##### v3.1.0
###### 2021-04-14

* Improvements to no-`txindex` support: now available for all versions of Bitcoin Core
* Move public sites to [BitcoinExplorer.org](https://bitcoinexplorer.org) (BIG thanks [@SatoshisDomains](https://twitter.com/SatoshisDomains))
* Add back the [/peers](./peers) tool in the "Tools" menu
	* Note: The map on the peers tool now requires users set their own `BTCEXP_MAPBOX_APIKEY` in `.env`
* Response compression
* Remove reference to unused `fonts.css`
* Increased static-files cache: 1hr -> 1mo
* Clearer UX around RPC connection failures (show the fact clearly, instead of flooding the log with cryptic errors)
* Fixed changelog for v3.0.0 release (added/clarified some issues)
* Updated favicons (Thanks [realfavicongenerator.net](https://realfavicongenerator.net))
* Fix for homepage error after failure to get AU exchange rate
* UX improvements on [/peers](./peers) page
* Graphs for top items in [/admin/stats](./admin/stats)
* Optional support for plausible.io analytics
* Fix to avoid displaying empty "Summary" section when we fail to get address txid list
* UX improvement around electrs too-many-txs-for-address errors


##### v3.0.0
###### 2021-04-08

* Major visual refresh!
	* All new design (layout, fonts, colors, etc)
	* Redesigned Dark Mode (now the default)
	* New app icon
* Support for pruned nodes and nodes with disabled `txindex`! (HUGE Thanks to [@shesek](https://github.com/shesek))
	* Note: Currently only Bitcoin Core versions 0.21+ are able to support this feature (a future improvement is planned to make it available to all versions)
* Mempool Summary improvements
	* Greatly improved performance for multiple loads via caching
	* Added: "Blocks Count" column by fee-rate bucket
	* Tool for estimating Block Depth of a transaction or a fee rate (Thanks [@pointbiz](https://github.com/pointbiz))
* Mining Summary: added doughnut chart for rev. breakdown, simplified table data
* Upgraded to Bootstrap 5 (currently beta3...)
* Update mapbox API (Thanks [@shesek](https://github.com/tyzbit))
	* Note: The map on the [/peers](./peers) page now requires that users set the env var `BTCEXP_MAPBOX_APIKEY` to their own API key
* Fix for 404 pages hanging (Thanks [@shesek](https://github.com/shesek))
* Add convenience redirect for baseUrl (Thanks [@shesek](https://github.com/shesek))
* Make url in logs clickable (Thanks [@shesek](https://github.com/shesek))
* Caching for static files (maxAge=1hr)
* Frontend performance optimizations
* Smarter performance/memory defaults for slow devices
* Major refactoring, modernization, and code-reuse improvements
* UX improvements and polish throughout
* URL changes
	* `/node-status` -> `/node-details`
	* `/unconfirmed-tx` -> `/mempool-transactions`
* Environment variable changes
	* The below changes were made to more clearly acknowledge that multiple Electrum-protocol implementations (e.g. ElectrumX, Electrs) can be used for address queries:
	* `BTCEXP_ADDRESS_API` value `electrumx` -> `electrum` (`electrumx` should still works)
	* `BTCEXP_ELECTRUMX_SERVERS` -> `BTCEXP_ELECTRUM_SERVERS` (`BTCEXP_ELECTRUMX_SERVERS` should still work)
* Updated dependencies
	* jQuery: v3.4.1 -> v3.6.0
	* highlight.js: v9.14.2 -> v10.7.1
	* fontawesome: v5.7.1 -> v5.15.3


##### v2.2.0
###### 2021-01-22

* New "Fun" item for the tx containing the whitepaper and new tool to extract the whitepaper and display it
* New fee rate data on `/block-analysis` pages
* New minor misc peer data available in Bitcoin Core RPC v0.21+
* New gold exchange rate on homepage
* Fix for SSO token generation URL encoding (Thanks [@shesek](https://github.com/shesek) and [@Kixunil](https://github.com/Kixunil))
* Fix for [/peers](./peers) map
* Fix for README `git clone` instructions (Thanks [@jonasschnelli](https://github.com/jonasschnelli))


#### v2.1.0
##### 2020-12-15

* Support for running on a configurable BASEURL, e.g. "/explorer/" (Thanks [@ketominer](https://github.com/ketominer), [@Kixunil](https://github.com/Kixunil), [@shesek](https://github.com/shesek))
* Support for SSO (Thanks [@Kixunil](https://github.com/Kixunil))
* Support for signet and taproot (Thanks [@guggero](https://github.com/guggero))
* Support for listening on 0.0.0.0 (Thanks [@lukechilds](https://github.com/lukechilds))
* Support for viewing list of block heights for each miner on `/mining-summary`
* Sanitizing of environment variables (Thanks [@lukechilds](https://github.com/lukechilds))
* Fix for XSS vulnerabilities (Thanks [@shesek](https://github.com/shesek))
* Fix for low severity lodash dependency vulnerability (Thanks [@abhiShandy](https://github.com/abhiShandy))
* Fix for zero block reward (eventually on mainnet, now on regtest) (Thanks [@MyNameIsOka](https://github.com/MyNameIsOka))
* Fix for cryptic error when running regtest with no blocks
* Fix for pagination errors on [/blocks](./blocks) (not displaying genesis block on the last page; error on last page when sort=asc)
* Electrum connect/disconnect stats on `/admin`
* Add P2SH bounty address `/fun` items (Thanks [@cd2357](https://github.com/cd2357))
* Misc cleanup (Thanks [@AaronDewes](https://github.com/AaronDewes))
* Add "Thanks" notes to changelog


#### v2.0.2
##### 2020-07-03

* Lots of improvements to connect/disconnect/error management with configured Electrum servers
* Include pending balance for addresses queried via ElectrumX, when available
* Include basic stats for Electrum queries on `/admin`
* Bug fixes
	* Fix for erroneous defaults for boolean env vars in some scenarios (slow device mode)
* Updated dependences and mining pools
* Misc cleanup (Thanks [@JosephGoulden](https://github.com/JosephGoulden))


#### v2.0.1
##### 2020-05-28

* Highlight coinbase spends in transaction I/O details
* Highlight very old UTXOs (5+ years) in transaction I/O details
* Transaction page: show "days destroyed"
* Bug fixes
	* Fix for "verifymessage" in RPC browser accepting multi-line messages
	* Fix to make "--slow-device-mode=false" work
	* Don't show errors on address page for bech32 due to trying to parse as base58
	* Fix "failure to render homepage when fee estimates are unavailable"
* Minor additions to "fun" data
* Updated dependences


#### v2.0.0
##### 2020-03-25

* New data points in homepage "Network Summary":
	* Fee estimates (estimatesmartfee) for 1, 6, 144, 1008 blocks
	* Hashrate estimate for 1+7 days
	* New item for 'Chain Rewrite Days', using 7day hashrate
	* New data based on UTXO-set summary. Note that UTXO-set querying is resource intensive and therefore disabled by default to protect slower nodes. Set `BTCEXP_SLOW_DEVICE_MODE` to `false` in your `.env` file to enjoy associated features:
		* UTXO-set size
		* Total coins in circulation
		* Market cap
	* 24-hour network volume (sum of tx outputs). This value is calculated at app launch and refreshed every 30min.
	* Avg block time for current difficulty epoch with estimate of next difficulty adjustment
* Tweaks to data in blocks lists:
	* Simpler timestamp formatting for easy reading
	* Include "Time-to-Mine" (TTM) for each block (with green/red highlighting for "fast"/"slow" (<5min / >15min) blocks)
	* Display average fee in sat/vB
	* Add total fees
	* Add output volume (if `getblockstats` rpc call is supported, i.e. 0.17.0+)
	* Show %Full instead of weight/size
* Block Detail page improvements
	* New data in "Summary" on Block pages (supported for bitcoind v0.17.0+)
		* Outputs total volume
		* Input / Output counts
		* UTXO count change
		* Min / Max tx sizes
	* New "Fees Summary" section (bitcoind v0.17.0+)
		* Fee rate percentiles
		* Fee rates: min, avg, max
		* Fee totals: min, avg, max
	* New "Technical Details" section. Items from "Summary" in previous versions have been moved here. This section is collapsible if desired.
* Improvements to transaction input/output displays
	* Change primary input data to be tx outpoint ("txid #voutIndex")
	* Zero-indexing for tx inputs/outputs (#173)
	* Labels for transaction input/output types
	* Inputs: when available, show "input address" below tx outpoint
	* Coinbase and OP_RETURN items: show ascii data inline with link to show hex data
* New tool `/block-stats` for viewing summarized block data from recent blocks
* New tool [/mining-summary](./mining-summary) for viewing summarized mining data from recent blocks
* New tool `/block-analysis` for analyzing the details of transactions in a block.
	* **IMPORTANT**: Use of `/block-analysis` can put heavy memory pressure on this app, depending on the details of the block being analyzed. If your app is crashing, consider setting a higher memory ceiling: `node --max_old_space_size=XXX bin/www` (where `XXX` is measured in MB).
* New tool [/difficulty-history](./difficulty-history) showing a graph of the history of all difficulty adjustments
* Change `/mempool-summary` to load data via ajax (UX improvement to give feedback while loading large data sets)
* Zero-indexing for tx index-in-block values
* Reduced memory usage
* Versioning for cache keys if using persistent cache (redis)
* Configurable UI "sub-header" links
* Start of RPC API versioning support
* Tweaked styling across site
* Homepage UI tweaks
	* Remove "Bitcoin Explorer" H1 (it's redundant)
	* Hide the "Date" (timestamp) column for recent blocks (the Age+TTM is more valuable)
* Updated miner configs
* Lots of minor bug fixes


#### v1.1.9
##### 2020-02-23

* Fix for unescaped user search query display (#183)
* More detailed network info on `/node-status`
* Updated bootstrap, jquery
* Disable stacktrace log output by default (#170)
* Updated miner configs


#### v1.1.8
##### 2020-01-09

* Fix for missing changelog file when installed via npm
* Updated miner configs


#### v1.1.5
##### 2019-12-22

* Fix startup issues when connecting to a node that's not ready to serve data (e.g. verifying blocks)
* Homepage header: show exchange rate in selected currency (rather than hardcoded USD)
* Homepage header: show sat/USD or sat/EUR


#### v1.1.4
###### 2019-12-04

* First-class support for testnet/regtest

#### v1.1.3
###### 2019-12-02

* Fixes related to running bitcoind 0.19.0.1
* Updated dependencies
* Version number in footer
* `/changelog` linked in footer

#### v1.1.2 
###### 2019-10-17

* Add back map on `/peers` that was lost with recent bug

#### v1.1.1
###### 2019-10-01

* Add new default blacklist items for some 'hidden' RPCs
* Print app version info to log on startup
* Remove LTC site from footer

#### v1.1.0
###### 2019-09-30

* Show spent/unspent status on tx detail pages
* Show mempool ancestor/descendant txs on tx detail pages
* Blacklist 'createwallet' by default
* Show RBF status for unconfirmed txs
* Faster, more reliable display of `/mempool-summary` and `/mempool-transactions` pages
* Fix for persisting arg values in UI on `/rpc-browser`
* Misc minor fixes and ux tweaks

#### v1.0.3
###### 2019-04-27

* Pluggable address API supporting different implementations
* Logging improvements
* Fix to avoid caching unconfirmed txs
* Identify destroyed fees
* Misc minor fixes and ux tweaks

#### v1.0.2
###### 2019-03-13

* Fix for background color on light theme

#### v1.0.1
###### 2019-03-13

* Dark theme
* Tx rate graph on homepage
* Improved caching
* Misc minor fixes and ux tweaks

#### v1.0.0
###### 2019-02-23

* Initial release
