import debug from "debug";
import * as statTracker from "../statTracker.js";

const debugErrorLog = debug("btcexp:error");
const debugErrorVerboseLog = debug("btcexp:errorVerbose");

global.errorStats = {};

export interface LoggedError {
	errorId: string,
	error: unknown,
	userData?: Record<string, unknown>
}

// Records an error: logs it, counts it by id and property values (global.errorStats), keeps the last
// 100 in global.errorLog, and tracks it as a stat. Adds errorMsg to optionalUserData when err has a message.
export function logError(errorId: string, err: unknown, optionalUserData: Record<string, unknown> | null = {}, logStacktrace = true): LoggedError {
	const errLike = err as { stack?: string, message?: string } | null | undefined;

	debugErrorLog("Error " + errorId + ": " + err + ", json: " + JSON.stringify(err) + (optionalUserData != null ? (", userData: " + optionalUserData + " (json: " + JSON.stringify(optionalUserData) + ")") : ""));

	if (errLike && errLike.stack && logStacktrace) {
		debugErrorVerboseLog("Stack: " + errLike.stack);
	}

	if (!global.errorLog) {
		global.errorLog = [];
	}

	if (!global.errorStats[errorId]) {
		global.errorStats[errorId] = {
			count: 0,
			firstSeen: new Date().getTime(),
			properties: {}
		};
	}

	if (optionalUserData && errLike && errLike.message) {
		optionalUserData.errorMsg = errLike.message;
	}

	if (optionalUserData) {
		for (const [key, value] of Object.entries(optionalUserData)) {
			if (!global.errorStats[errorId].properties[key]) {
				global.errorStats[errorId].properties[key] = {};
			}

			if (!global.errorStats[errorId].properties[key][String(value)]) {
				global.errorStats[errorId].properties[key][String(value)] = 0;
			}

			global.errorStats[errorId].properties[key][String(value)]++;
		}
	}

	statTracker.trackEvent(`errors.${errorId}`);
	statTracker.trackEvent(`errors.*`);

	global.errorStats[errorId].count++;
	global.errorStats[errorId].lastSeen = new Date().getTime();

	global.errorLog.push({errorId:errorId, error:err, userData:optionalUserData, date:new Date()});
	while (global.errorLog.length > 100) {
		global.errorLog.splice(0, 1);
	}

	const returnVal: LoggedError = {errorId:errorId, error:err};
	if (optionalUserData) {
		returnVal.userData = optionalUserData;
	}

	return returnVal;
}
