import http from "node:http";
import type { AddressInfo } from "node:net";

// What a node answered: its result, or an error ({ code, message }).
export type Recorded = { result: unknown } | { error: { code: number, message: string } };

// the key of a call in the recording
export const callKey = (method: string, params: unknown): string => `${method} ${JSON.stringify(params ?? [])}`;

// A node on a local port. It answers JSON-RPC calls: the ones that belong to a node (its peers, its mempool, ...) from
// `nodeSpecific`, the others (blocks, transactions, ...) from the recording in test/fixtures/rpc.json. A call that is in
// neither gets an error, and is listed in `misses`.
export async function startFakeNode(fixtures: Record<string, Recorded>, nodeSpecific: (method: string, params: unknown[]) => Recorded | undefined) {
	const misses = new Set<string>();

	const server = http.createServer((req, res) => {
		let body = "";

		req.on("data", chunk => { body += chunk; });
		req.on("end", () => {
			const call = JSON.parse(body);
			const key = callKey(call.method, call.params);
			const recorded = nodeSpecific(call.method, call.params ?? []) ?? fixtures[key];

			let answer: Record<string, unknown>;

			if (recorded === undefined) {
				misses.add(key);

				answer = { error: { code: -32601, message: `No answer for ${key}` } };

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
