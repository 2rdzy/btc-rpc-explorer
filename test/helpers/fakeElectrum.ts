import net from "node:net";

// What a made-up Electrum server answers about an address.
export interface ElectrumAnswers {
	history: { tx_hash: string, height: number }[],
	balance: { confirmed: number, unconfirmed: number }
}

// A made-up Electrum server on a free local port, speaking newline-delimited JSON-RPC like the real thing.
export async function startFakeElectrum(answers: ElectrumAnswers): Promise<{ port: number, close: () => void }> {
	const sockets = new Set<net.Socket>();

	const server = net.createServer((socket: net.Socket) => {
		let buffer = "";

		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;

			let i;

			while ((i = buffer.indexOf("\n")) !== -1) {
				const message = JSON.parse(buffer.slice(0, i));
				const results: Record<string, unknown> = {
					"server.version": ["fake-electrum", "1.4"],
					"server.ping": null,
					"blockchain.scripthash.get_history": answers.history.map(x => ({ ...x })),
					"blockchain.scripthash.get_balance": { ...answers.balance },
					"blockchain.transaction.get_confirmed_blockhash": "blockhash1"
				};

				buffer = buffer.slice(i + 1);
				socket.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: results[message.method] }) + "\n");
			}
		});
	});

	await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));

	return {
		port: (server.address() as net.AddressInfo).port,
		close: () => {
			sockets.forEach(socket => socket.destroy());
			server.close();
		}
	};
}
