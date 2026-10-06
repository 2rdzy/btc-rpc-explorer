import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import hashes from "../app/resourceIntegrityHashes.js";

const root = path.join(__dirname, '..');
const dirs = ['public/js', 'public/style', 'public/leaflet', 'public/font'];

// Pages ask the browser to check each script and stylesheet against these hashes. A file that
// changed without regenerating them (npm run integrity, which npm run css also does) is
// silently refused by the browser.
describe('integrity hashes', () => {
	const files = new Map();

	for (const dir of dirs) {
		for (const file of fs.readdirSync(path.join(root, dir))) {
			if (/\.(js|css)$/.test(file)) {
				files.set(file, path.join(root, dir, file));
			}
		}
	}

	test('there is a hash for every script and stylesheet', () => {
		const missing = [...files.keys()].filter(file => !hashes[file]);

		assert.deepEqual(missing, []);
	});

	for (const [file, filepath] of files) {
		test(`${file} matches its hash`, () => {
			const actual = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(filepath)).digest('base64');

			assert.equal(hashes[file], actual, `${file} changed: run npm run integrity`);
		});
	}
});
