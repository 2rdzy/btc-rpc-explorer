import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { buildApp, startApp } from "./helpers/app.js";
import type { RunningApp } from "./helpers/app.js";
import { startFakeNode } from "./helpers/fakeNode.js";
import type { Recorded } from "./helpers/fakeNode.js";
import { nodeSpecific } from "./fixtures/nodeSpecific.js";

// The settings come from a link and from a cookie, and the time zone ones are printed into a script of every page: in
// the running explorer, what is not a plain value must not get there.

describe("the settings in the running explorer", () => {
	let node: Awaited<ReturnType<typeof startFakeNode>>;
	let app: RunningApp;

	before(async () => {
		const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "rpc.json"), "utf8")) as Record<string, Recorded>;
		const info = (fixtures["getblockchaininfo []"] as { result: Record<string, unknown> }).result;
		const difficultyKey = "difficulty_blake2b" in info ? "difficulty_blake2b" : "difficulty";
		const tip = { height: info.blocks as number, hash: info.bestblockhash as string, bits: info.bits as string, difficultyKey, difficulty: info[difficultyKey] as number, time: info.time as number };

		buildApp();
		node = await startFakeNode(fixtures, (method, params) => nodeSpecific(method, params, tip));
		app = await startApp(node.port, {});
	}, { timeout: 240000 });

	after(async () => {
		await app?.stop();
		await node?.close();
	});

	// follows /changeSetting and returns the cookie it sets
	const change = async (name: string, value: string) => {
		const response = await fetch(`${app.baseUrl}/changeSetting?name=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`, { redirect: "manual" });

		assert.equal(response.status, 302);

		return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
	};

	const script = async (cookie: string) => {
		const page = await (await fetch(`${app.baseUrl}/about`, { headers: { cookie } })).text();

		return { browser: /var browserTzOffset = "([^\n]*)";/.exec(page)?.[1], user: /var userTzOffset = "([^\n]*)";/.exec(page)?.[1] };
	};

	test("a time zone offset that is a number is used", async () => {
		assert.deepEqual(await script(await change("browserTzOffset", "-5.5")), { browser: "-5.5", user: "unset" });
		assert.deepEqual(await script(await change("userTzOffset", "2")), { browser: "0", user: "2" });
	});

	for (const name of ["browserTzOffset", "userTzOffset"]) {
		test(`${name} with script in it is not kept`, async () => {
			const cookie = await change(name, '1";window.pwned=1;//');

			assert.ok(!cookie.includes("user-settings="));
			assert.deepEqual(await script(cookie), { browser: "0", user: "unset" });
		});
	}

	test("a cookie with script in it is cleaned, and one that is not JSON is ignored", async () => {
		const evil = encodeURIComponent(JSON.stringify({ browserTzOffset: '";window.pwned=1;//', userTzOffset: '1";window.pwned=2;//', uiTheme: "dark" }));

		assert.deepEqual(await script(`user-settings=${evil}`), { browser: "0", user: "unset" });

		const broken = await fetch(`${app.baseUrl}/about`, { headers: { cookie: "user-settings=%7Bnot-json" } });

		assert.equal(broken.status, 200);
	});

	test("a setting of another name is not kept when its value is not plain", async () => {
		assert.ok(!(await change("uiTheme", '"><img src=x onerror=alert(1)>')).includes("user-settings="));
		assert.ok(!(await change('a"b', "x")).includes("user-settings="));
		assert.match(await change("uiTheme", "dark"), /user-settings=/);
	});
});
