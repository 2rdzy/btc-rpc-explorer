import crypto from "crypto";
import fs from "fs";
import path from "path";

// Writes the SHA-384 integrity hash of each script, stylesheet and font under public/ to
// app/resourceIntegrityHashes.ts (npm run integrity, which npm run css runs last).

const dirs = [
	"public/js/",
	"public/style/",
	"public/leaflet/",
	"public/font/",
];

const filetypeMatch = /^.*\.(js|css)$/;

const hashesByFilename: Record<string, string> = {};

dirs.forEach(dirPath => {
	console.log("\nDirectory: " + dirPath);

	fs.readdirSync(path.join(process.cwd(), dirPath)).forEach(file => {
		if (file.match(filetypeMatch)) {
			const content = fs.readFileSync(path.join(dirPath, file));

			const hash = crypto.createHash("sha384");

			const data = hash.update(content);

			const gen_hash = data.digest('base64');

			console.log("\t" + file + " -> " + gen_hash);

			hashesByFilename[file] = `sha384-${gen_hash}`;
		}
	});
});

const fileContent = "const resourceIntegrityHashes: Record<string, string> = " + JSON.stringify(hashesByFilename, null, 4) + ";\n\nexport = resourceIntegrityHashes;\n";

fs.writeFileSync(path.join(process.cwd(), "app/resourceIntegrityHashes.ts"), fileContent);

console.log("\napp/resourceIntegrityHashes.ts written.\n");
