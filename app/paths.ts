import fs from "fs";
import path from "path";

// The project root: the nearest directory above `startDir` that holds both package.json and views/.
//
// The code runs from dist/ (npm run build compiles it there), but views/, public/, the changelogs and
// package.json stay at the project root, so code reaches them through this instead of __dirname.
// Asking for views/ as well as package.json keeps a copy of package.json in dist/ from being taken for it.
export function findProjectRoot(startDir: string): string {
	let dir = path.resolve(startDir);

	for (;;) {
		if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "views"))) {
			return dir;
		}

		const parent = path.dirname(dir);

		if (parent === dir) {
			throw new Error(`Unable to find the project root (a directory with package.json and views/) above ${startDir}`);
		}

		dir = parent;
	}
}

export const projectRoot = findProjectRoot(__dirname);
