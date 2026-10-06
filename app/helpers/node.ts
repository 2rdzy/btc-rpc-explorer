// Parse a node's subversion string ('/Satoshi:29.4.2/Knots:20260508/') into its version and a
// semver (major.minor.patch) used to gate RPC calls. The fourth part of a 4-part version is a
// bug fix release, irrelevant for RPC versioning, and is dropped. When the version cannot be
// read, the semver is one that passes every version check, which may cause unexpected results.
export function parseNodeVersion(subversion: string | undefined): { version: string | null, semver: string } {
	const match = /\/Satoshi:([^/]*)\//.exec(subversion as string);

	if (!match) {
		return { version: null, semver: "1000.1000.0" };
	}

	const version = match[1];
	const parts = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:\.[0-9]+)?$/.exec(version);

	if (!parts) {
		return { version: version, semver: "1000.1000.0" };
	}

	return { version: version, semver: `${parts[1]}.${parts[2]}.${parts[3]}` };
}

interface BlockDifficulty {
	difficulty?: number | null;
	difficulty_blake2b?: number | null;
}

// Knots reports "difficulty" for SHA256d blocks and "difficulty_blake2b" for BLAKE2b (header-v2) blocks.
export function getDifficulty(obj: BlockDifficulty): number | null | undefined {
	return obj.difficulty != null ? obj.difficulty : obj.difficulty_blake2b;
}

export function isBlake2bDifficulty(obj: BlockDifficulty): boolean {
	return obj.difficulty == null && obj.difficulty_blake2b != null;
}
