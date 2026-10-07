import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.join(__dirname, "..", "..");

const buildDir = path.join(root, ".test-build");

// Compiles the explorer with tsc, as `npm run build` does (into .test-build, next to the sources, so that it finds the
// views and public files). It is compiled and not run through tsx because the code depends on its imports being kept in
// the order they are written, which tsc does and tsx does not.
export function buildApp(): void {
	const result = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json", "--outDir", buildDir, "--sourceMap", "false"], { cwd: root, encoding: "utf8" });

	if (result.status !== 0) {
		throw new Error(`Building the explorer failed:\n${result.stdout}${result.stderr}`);
	}
}

// a free port (it can be taken by someone else before it is used, which is unlikely enough here)
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();

		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as net.AddressInfo).port;

			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

// the password the explorer is started with for the page tests (the RPC browser and terminal need one)
export const smokePassword = "smoke-password";

export interface RunningApp {
	baseUrl: string,
	// what the explorer wrote to its output so far
	output: () => string,
	stop: () => Promise<void>
}

// Starts the built explorer (see buildApp) as its own process, against the node on `nodePort`, and waits until it answers.
// It runs in an empty directory with its own HOME, so that no .env file or setting of this machine reaches it: only
// `env` does.
export async function startApp(nodePort: number, env: Record<string, string> = {}): Promise<RunningApp> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explorer-app-"));
	const port = await freePort();
	const child: ChildProcess = spawn(process.execPath, [path.join(buildDir, "bin", "www.js")], {
		cwd: dir,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: dir,
			NODE_ENV: "production",
			BTCEXP_HOST: "127.0.0.1",
			BTCEXP_PORT: String(port),
			BTCEXP_BITCOIND_HOST: "127.0.0.1",
			BTCEXP_BITCOIND_PORT: String(nodePort),
			BTCEXP_BITCOIND_USER: "user",
			BTCEXP_BITCOIND_PASS: "pass",
			BTCEXP_FILESYSTEM_CACHE_DIR: path.join(dir, "cache"),
			BTCEXP_NO_RATES: "true",
			BTCEXP_PRIVACY_MODE: "true",
			BTCEXP_RATE_LIMIT_WINDOW_MAX_REQUESTS: "100000",
			...env
		},
		stdio: ["ignore", "pipe", "pipe"]
	});

	let output = "";

	child.stdout!.on("data", chunk => { output += chunk; });
	child.stderr!.on("data", chunk => { output += chunk; });

	const baseUrl = `http://127.0.0.1:${port}`;
	const started = Date.now();

	// ready when the home page answers (it needs the node)
	const readyAuth: Record<string, string> = env.BTCEXP_BASIC_AUTH_PASSWORD === undefined ? {} : { authorization: 'Basic ' + Buffer.from(`user:${env.BTCEXP_BASIC_AUTH_PASSWORD}`).toString('base64') };

	for (;;) {
		if (child.exitCode !== null) {
			throw new Error(`The explorer stopped at start: ${output}`);
		}

		try {
			if ((await fetch(baseUrl + "/", { headers: readyAuth })).status === 200) {
				break;
			}
		} catch {
			// not listening yet
		}

		if (Date.now() - started > 60000) {
			child.kill();

			throw new Error(`The explorer did not answer within a minute: ${output}`);
		}

		await new Promise(resolve => setTimeout(resolve, 200));
	}

	return {
		baseUrl,
		output: () => output,
		stop: () => new Promise<void>(resolve => {
			if (child.exitCode !== null) {
				resolve();

				return;
			}

			child.once("exit", () => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); });
			child.kill();
		})
	};
}

export interface PageResult {
	status: number,
	location: string | null,
	text: string
}

// Requests a page (see test/fixtures/pages.ts): a GET, or a POST that carries the CSRF token of a session that was
// just started (a GET with `csrf` carries it in the query, as the pages that execute something do). Redirects are not followed.
export async function requestPage(baseUrl: string, page: { path: string, post?: Record<string, string>, csrf?: boolean }, password?: string): Promise<PageResult> {
	let response: Response;

	// (the explorer asks for a password when BTCEXP_BASIC_AUTH_PASSWORD is set)
	const auth: Record<string, string> = password === undefined ? {} : { authorization: 'Basic ' + Buffer.from(`user:${password}`).toString('base64') };

	if (page.post || page.csrf) {
		const home = await fetch(baseUrl + "/", { headers: auth });
		const cookie = (home.headers.get("set-cookie") || "").split(";")[0];
		const token = /name="csrf-token" content="([^"]+)"/.exec(await home.text())?.[1] ?? "";

		if (!page.post) {
			response = await fetch(`${baseUrl}${page.path}${page.path.includes("?") ? "&" : "?"}_csrf=${encodeURIComponent(token)}`, { redirect: "manual", headers: { ...auth, cookie } });

			return { status: response.status, location: response.headers.get("location"), text: await response.text() };
		}

		response = await fetch(baseUrl + page.path, {
			method: "POST",
			redirect: "manual",
			headers: { ...auth, "content-type": "application/x-www-form-urlencoded", cookie },
			body: new URLSearchParams({ ...page.post, _csrf: token }).toString()
		});

	} else {
		response = await fetch(baseUrl + page.path, { redirect: "manual", headers: auth });
	}

	return { status: response.status, location: response.headers.get("location"), text: await response.text() };
}
