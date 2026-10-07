// The user's display settings (theme, currency, time zone, which sections are open, ...). They come from the query
// string of /changeSetting and from a cookie, so they are not to be trusted: some end up in scripts and attributes.

const nameFormat = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
// words, numbers and the characters of a decimal number: no quote, space, angle bracket or semicolon
const valueFormat = /^[A-Za-z0-9.-]{1,32}$/;
const timeZoneOffsetFormat = /^-?\d{1,2}(\.\d{1,2})?$/;

export function isValidSetting(name: unknown, value: unknown): value is string {
	if (typeof name !== "string" || typeof value !== "string" || !nameFormat.test(name) || !valueFormat.test(value)) {
		return false;
	}

	if (name == "userTzOffset" || name == "browserTzOffset") {
		return timeZoneOffsetFormat.test(value) && Math.abs(parseFloat(value)) <= 14;
	}

	return true;
}

// The settings of a user-settings cookie that are valid; none when the cookie is not JSON.
export function settingsFromCookie(cookie: string | undefined): Record<string, string> {
	const settings: Record<string, string> = {};

	try {
		const parsed: unknown = JSON.parse(cookie || "{}");

		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			for (const [name, value] of Object.entries(parsed)) {
				if (isValidSetting(name, value)) {
					settings[name] = value;
				}
			}
		}

	} catch {
		// a cookie that is not JSON is ignored
	}

	return settings;
}
