#!/usr/bin/env node

import path from "path";
import fs from "fs";
import axios from "axios";
import { projectRoot } from "../app/paths.js";
import coins from "../app/coins.js";

// Downloads the mining pool lists of each coin into public/txt/mining-pools-configs/<coin>/ (npm run miners).

async function refreshMiningPoolsForCoin(coinName: string): Promise<void> {
	console.log(`Refreshing mining pools for ${coinName}...`);

	if (coins[coinName].miningPoolsConfigUrls) {
		const miningPoolsConfigDir = path.join(projectRoot, "public", "txt", "mining-pools-configs", coinName);

		// delete the existing files first: the downloads below write files into the same directory
		let files: string[];

		try {
			files = fs.readdirSync(miningPoolsConfigDir);

		} catch {
			throw new Error(`Unable to delete existing files from '${miningPoolsConfigDir}'`);
		}

		files.forEach(function(file) {
			fs.unlinkSync(path.join(miningPoolsConfigDir, file));
		});

		const miningPoolsConfigUrls = coins[coinName].miningPoolsConfigUrls;

		const promises: Promise<void>[] = [];

		console.log(`${miningPoolsConfigUrls.length} mining pool config(s) found for ${coinName}`);

		for (let i = 0; i < miningPoolsConfigUrls.length; i++) {
			promises.push(refreshMiningPoolConfig(coinName, i, miningPoolsConfigUrls[i]));
		}

		await Promise.all(promises);

		console.log(`Refreshed ${miningPoolsConfigUrls.length} mining pool config(s) for ${coinName}\n---------------------------------------------`);

	} else {
		console.log(`No mining pool URLs configured for ${coinName}`);

		throw new Error(`No mining pool URLs configured for ${coinName}`);
	}
}

async function refreshMiningPoolConfig(coinName: string, index: number, url: string): Promise<void> {
	try {
		const response = await axios.get(url, { transformResponse: res => res });

		const filename = path.join(projectRoot, "public", "txt", "mining-pools-configs", coinName, index + ".json");

		try {
			fs.writeFileSync(filename, response.data);

		} catch (err) {
			console.log(`Error writing file '${filename}': ${err}`);

			throw err;
		}

		console.log(`Wrote '${coinName}/${index}.json' with contents of url: ${url}`);

	} catch (err) {
		console.log(`Error downloading mining pool config for ${coinName}: url=${url}`);

		throw err;
	}
}

async function refreshAllMiningPoolConfigs(): Promise<void> {
	for (const coinName of Object.keys(coins)) {
		await refreshMiningPoolsForCoin(coinName);
	}
}

refreshAllMiningPoolConfigs().then(() => {
	process.exit();
});
