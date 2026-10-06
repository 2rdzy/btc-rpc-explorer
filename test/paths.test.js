'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const { findProjectRoot, projectRoot } = require('../app/paths.js');

describe('project root', () => {
	let dir;

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-'));

		// root/ (package.json, views/) with a build output dist/ that also holds a package.json, and nested folders
		fs.mkdirSync(path.join(dir, 'root', 'views'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'root', 'package.json'), '{}');
		fs.mkdirSync(path.join(dir, 'root', 'dist', 'app'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'root', 'dist', 'package.json'), '{}');
		fs.mkdirSync(path.join(dir, 'root', 'app', 'api'), { recursive: true });
		fs.mkdirSync(path.join(dir, 'empty'), { recursive: true });
	});

	after(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('is found from the project root itself and from folders below it', () => {
		const root = path.join(dir, 'root');

		assert.equal(findProjectRoot(root), root);
		assert.equal(findProjectRoot(path.join(root, 'app', 'api')), root);
	});

	test('is found from inside dist/, even though dist/ has a package.json of its own', () => {
		const root = path.join(dir, 'root');

		assert.equal(findProjectRoot(path.join(root, 'dist', 'app')), root);
		assert.equal(findProjectRoot(path.join(root, 'dist')), root);
	});

	test('a missing root is an error that says where it looked', () => {
		assert.throws(() => findProjectRoot(path.join(dir, 'empty')), /Unable to find the project root.*empty/);
	});

	test('the real project root has what the app reads from it', () => {
		for (const name of ['package.json', 'views', 'public', 'CHANGELOG.md']) {
			assert.ok(fs.existsSync(path.join(projectRoot, name)), `${name} should be in the project root`);
		}
	});
});
