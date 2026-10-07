// What the Electrum servers say when more than one is configured, and what to do when they differ.

export interface ServerAnswer<T> {
	result: T,
	server: string | null
}

// One thing the servers did not agree on. `used` is the server whose answer the page shows.
export interface ServerConflict {
	what: string,
	used: string,
	answers: { server: string, summary: string }[]
}

const label = (answer: ServerAnswer<unknown>) => answer.server ?? "unknown server";

// Picks the answer most servers give; on a tie the first group (the first server to answer) wins.
// `key` reduces an answer to what has to match, `summary` says it in words for the warning.
export function chooseAnswer<T>(answers: ServerAnswer<T>[], what: string, key: (result: T) => string, summary: (result: T) => string): { chosen: ServerAnswer<T>, conflict?: ServerConflict } {
	const groups = new Map<string, ServerAnswer<T>[]>();

	for (const answer of answers) {
		const k = key(answer.result);

		groups.set(k, [...(groups.get(k) ?? []), answer]);
	}

	// Map keeps insertion order and the sort is stable, so the first answer's group wins ties
	const largest = [...groups.values()].sort((a, b) => b.length - a.length)[0];
	const chosen = largest[0];

	if (groups.size == 1) {
		return { chosen };
	}

	return {
		chosen,
		conflict: { what, used: label(chosen), answers: answers.map(a => ({ server: label(a), summary: summary(a.result) })) }
	};
}

export interface HistoryEntry { tx_hash: string, height: number }

// Unconfirmed transactions (height 0 or -1) are left out: servers see different mempools, which is no conflict.
function confirmed(history: HistoryEntry[]): HistoryEntry[] {
	return history.filter(x => x.height > 0);
}

export function historyKey(history: HistoryEntry[]): string {
	return confirmed(history).map(x => `${x.tx_hash}:${x.height}`).sort().join(",");
}

export function historySummary(history: HistoryEntry[]): string {
	const n = confirmed(history).length;

	return `${n} confirmed transaction${n == 1 ? "" : "s"}`;
}

// Only the confirmed balance is compared, for the same reason.
export function balanceKey(balance: { confirmed: number }): string {
	return `${balance.confirmed}`;
}

export function balanceSummary(balance: { confirmed: number }): string {
	return `${balance.confirmed} sat confirmed`;
}
