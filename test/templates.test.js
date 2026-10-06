'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');

const pug = require('pug');
const Decimal = require('decimal.js');

const { config } = require('./helpers/setup.js');
const utils = require('../app/utils.js');

const viewsDir = path.join(__dirname, '..', 'views');

function pugFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);

		return entry.isDirectory() ? pugFiles(full) : (entry.name.endsWith('.pug') ? [full] : []);
	});
}

describe('templates', () => {
	for (const file of pugFiles(viewsDir)) {
		test(`${path.relative(viewsDir, file)} compiles`, () => {
			pug.compileFile(file, { basedir: viewsDir });
		});
	}
});

describe('network summary', () => {
	// the summary include on its own, with the mixins it needs
	const source = 'include /includes/shared-mixins.pug\ninclude /includes/index-network-summary.pug\n';

	const locals = getblockchaininfo => ({
		utils, Decimal, config, coinConfig: global.coinConfig,
		moment: require('moment'),
		getblockchaininfo,
		hashrate7d: 3.8e16,
		hashrate30d: 3.4e16,
		difficultyAdjustmentData: null,
		nextHalvingData: null,
		halvingSoon: false,
		chainTxStats: null,
		targetBlocksPerDay: 144,
		userSettings: {},
		global,
		assetUrl: p => p,
	});

	const render = getblockchaininfo => pug.render(source, { basedir: viewsDir, ...locals(getblockchaininfo) });

	const baseInfo = { chain: 'main', blocks: 975700, headers: 975700, chainwork: '00000000000000000000000000000000000000013e0038c97bb05c9264ca25d5', size_on_disk: 8e11, pruned: false, verificationprogress: 0.999, time: 1791210940, mediantime: 1791208407 };

	test('renders a BLAKE2b chain, which has difficulty_blake2b and no difficulty', () => {
		const html = render({ ...baseInfo, difficulty_blake2b: 1.986469847209289e+19 });

		assert.match(html, /19\.865/);
		assert.match(html, /<sup>18<\/sup>/);
	});

	test('renders a SHA-256d chain', () => {
		const html = render({ ...baseInfo, difficulty: 127479855693691.4 });

		assert.match(html, /127\.48/);
		assert.match(html, /<sup>12<\/sup>/);
	});

	test('does not compare a BLAKE2b difficulty with the SHA-256d all-time high', () => {
		global.athDifficulty = 1.56e14;

		const html = render({ ...baseInfo, difficulty_blake2b: 1.986469847209289e+19 });

		assert.doesNotMatch(html, /All-Time High|% lower than/);
		assert.match(html, /19\.865/); // the difficulty itself is still shown

		delete global.athDifficulty;
	});

	test('compares a SHA-256d difficulty with the all-time high', () => {
		global.athDifficulty = 1.56e14;

		const html = render({ ...baseInfo, difficulty: 1.27e14 });

		assert.match(html, /lower than the All-Time High/);

		delete global.athDifficulty;
	});
});
