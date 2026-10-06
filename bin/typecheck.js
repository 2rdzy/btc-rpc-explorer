"use strict";

// Type-check the project with TypeScript (tsconfig.json), failing only on errors that are not already
// listed in typecheck-baseline.txt. The code base predates the checker, so its existing findings are
// recorded, and the build fails if a change adds a new one. Fix a recorded finding and the baseline
// shrinks (run with --update to rewrite it); it should only ever get shorter.
//
//   node bin/typecheck.js            check against the baseline
//   node bin/typecheck.js --update   rewrite the baseline from the current findings

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const baselineFile = path.join(root, "typecheck-baseline.txt");

// "routes/x.js(12,5): error TS2339: Property 'a' does not exist..." -> "routes/x.js: TS2339: Property 'a' ..."
// Line and column are left out, so that moving code around does not change a finding's identity.
/** @param {string} output */
function parseErrors(output) {
	const errors = [];

	for (const line of output.split("\n")) {
		const match = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line);

		if (match) {
			// messages can contain absolute paths; keep the baseline the same on every machine
			const message = match[3].trim().split(root + path.sep).join("");

			errors.push(`${match[1]}: ${match[2]}: ${message}`);
		}
	}

	return errors.sort();
}

/** @param {string[]} items */
function count(items) {
	const counts = new Map();

	items.forEach(item => counts.set(item, (counts.get(item) || 0) + 1));

	return counts;
}

// what is in `current` more often than in `baseline`
/**
 * @param {string[]} current
 * @param {string[]} baseline
 */
function difference(current, baseline) {
	const baselineCounts = count(baseline);
	const found = [];

	for (const [item, n] of count(current)) {
		const extra = n - (baselineCounts.get(item) || 0);

		for (let i = 0; i < extra; i++) {
			found.push(item);
		}
	}

	return found;
}

/**
 * @param {string[]} current
 * @param {string[]} baseline
 */
function compare(current, baseline) {
	return {
		added: difference(current, baseline),
		fixed: difference(baseline, current)
	};
}

function readBaseline() {
	if (!fs.existsSync(baselineFile)) {
		return [];
	}

	return fs.readFileSync(baselineFile, "utf8").split("\n").filter(line => line.trim() != "" && !line.startsWith("#")).sort();
}

function runTsc() {
	const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", root, "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

	if (result.error) {
		throw result.error;
	}

	return result.stdout + result.stderr;
}

function main() {
	const current = parseErrors(runTsc());

	if (process.argv.includes("--update")) {
		const header = "# Type errors that existed when type checking was added. Do not add to this file: fix the code instead.\n# Rewritten by: npm run typecheck -- --update\n";

		fs.writeFileSync(baselineFile, header + current.join("\n") + (current.length ? "\n" : ""));

		console.log(`Wrote ${current.length} findings to ${path.basename(baselineFile)}.`);

		return 0;
	}

	const { added, fixed } = compare(current, readBaseline());

	if (fixed.length) {
		console.log(`${fixed.length} recorded finding(s) are fixed. Run "npm run typecheck -- --update" to shrink the baseline:`);
		fixed.slice(0, 10).forEach(item => console.log(`  fixed: ${item}`));
	}

	if (added.length) {
		console.error(`${added.length} new type error(s):`);
		added.forEach(item => console.error(`  ${item}`));

		return 1;
	}

	console.log(`No new type errors (${current.length} recorded in the baseline).`);

	return 0;
}

if (require.main === module) {
	process.exitCode = main();
}

module.exports = { parseErrors, compare };
