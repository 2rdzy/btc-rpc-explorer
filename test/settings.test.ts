import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isValidSetting, settingsFromCookie } from "../app/helpers/settings.js";

describe("settings", () => {
	test("plain names and values are valid", () => {
		for (const [name, value] of [["uiTheme", "dark-v1"], ["uiTimezone", "utc"], ["displayCurrency", "usd"], ["hideInfoNotes", "true"], ["blockPageShowTechSummary", "false"], ["userTzOffset", "-5.5"], ["browserTzOffset", "2"], ["userTzOffset", "0"]]) {
			assert.ok(isValidSetting(name, value), `${name}=${value}`);
		}
	});

	test("what could break out of a script or an attribute is refused", () => {
		for (const value of ['";window.pwned=1;//', "1\";alert(1)//", "<script>", "a b", "a;b", "a'b", "x\ny", "", "a".repeat(33), "</script>"]) {
			assert.ok(!isValidSetting("uiTheme", value), JSON.stringify(value));
		}

		for (const name of ['a"b', "a b", "", "1abc", "a-b", "__proto__x;", "a".repeat(65)]) {
			assert.ok(!isValidSetting(name, "true"), JSON.stringify(name));
		}
	});

	test("things that are not strings are refused", () => {
		assert.ok(!isValidSetting("uiTheme", undefined));
		assert.ok(!isValidSetting("uiTheme", ["dark"]));
		assert.ok(!isValidSetting("uiTheme", 5));
		assert.ok(!isValidSetting(undefined, "dark"));
		assert.ok(!isValidSetting(["uiTheme"], "dark"));
	});

	test("a time zone offset has to be a number of hours", () => {
		for (const value of ["abc", "1abc", "1e3", "99", "-15", "1.234", "--1", "1-"]) {
			assert.ok(!isValidSetting("userTzOffset", value), value);
			assert.ok(!isValidSetting("browserTzOffset", value), value);
		}
	});

	test("a cookie keeps only its valid settings", () => {
		assert.deepEqual(settingsFromCookie(JSON.stringify({ uiTheme: "dark", browserTzOffset: '";alert(1)//', "bad name": "x", userTzOffset: 3, hideInfoNotes: "true" })), { uiTheme: "dark", hideInfoNotes: "true" });
	});

	test("a cookie that is missing, not JSON or not an object gives no settings", () => {
		for (const cookie of [undefined, "", "{", "not json", "[1,2]", "null", "5", '"text"']) {
			assert.deepEqual(settingsFromCookie(cookie), {}, String(cookie));
		}
	});
});
