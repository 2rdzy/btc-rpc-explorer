import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const root = path.join(__dirname, '..');

function jsFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);

		return entry.isDirectory() ? jsFiles(full) : (/\.[cm]?js$/.test(entry.name) ? [path.relative(root, full)] : []);
	});
}

describe('the code base', () => {
	test('is TypeScript: there is no JavaScript under app, routes, bin, docs or test', () => {
		const found = ['app', 'routes', 'bin', 'docs', 'test'].flatMap(dir => jsFiles(path.join(root, dir)));

		assert.deepEqual(found, [], 'convert these to TypeScript (tsc would not check them)');
	});

	test('app.ts is at the root, and the old app.js is gone', () => {
		assert.ok(fs.existsSync(path.join(root, 'app.ts')));
		assert.ok(!fs.existsSync(path.join(root, 'app.js')));
	});
});
