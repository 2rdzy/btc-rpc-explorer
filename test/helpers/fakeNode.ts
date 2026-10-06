import http from "node:http";
import type { AddressInfo } from "node:net";

// What a node answered: its result, or an error ({ code, message }).
export type Recorded = { result: unknown } | { error: { code: number, message: string } };

// the key of a call in the fixtures
export const callKey = (method: string, params: unknown): string => `${method} ${JSON.stringify(params ?? [])}`;

// A node on a local port that answers JSON-RPC calls from recorded answers (test/fixtures/rpc.json). A call that has
// not been recorded is answered with an error, and listed in `misses`.
export async function startFakeNode(fixtures: Record<string, Recorded>) {
	const misses = new Set<string>();

	const server = http.createServer((req, res) => {
		let body = "";

		req.on("data", chunk => { body += chunk; });
		req.on("end", () => {
			const call = JSON.parse(body);
			const key = callKey(call.method, call.params);
			const recorded = fixtures[key];

			let answer: Record<string, unknown>;

			if (recorded === undefined) {
				misses.add(key);

				answer = { error: { code: -32601, message: `No recorded answer for ${key}` } };

			} else {
				answer = "error" in recorded ? { error: recorded.error } : { result: recorded.result };
			}

			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...answer }));
		});
	});

	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));

	return {
		port: (server.address() as AddressInfo).port,
		misses,
		close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })
	};
}
