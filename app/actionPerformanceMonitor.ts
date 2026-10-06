import type { NextFunction, Request, RequestHandler, Response } from "express";
import onHeaders from "on-headers";
import debug from "debug";
const debugLog = debug("monitor");

import { getCrawlerFromUserAgentString } from "./helpers/http.js";
import type * as StatTracker from "./statTracker.js";

interface ActionMonitorOptions {
	ignoredEndsWithActions?: RegExp | string;
	ignoredStartsWithActions?: string;
	normalizeAction?: (action: string) => string;
}

interface ActionMonitorConfig extends ActionMonitorOptions {
	ignoredEndsWithActionsRegex: RegExp;
	ignoredStartsWithActionsRegex: RegExp;
}

const onHeadersListener = (config: ActionMonitorConfig, req: Request, statusCode: number, startTimeNanos: bigint, statTracker: typeof StatTracker) => {
	try {
		const responseTimeNanos = process.hrtime.bigint() - startTimeNanos;
		const responseTimeMillis = Number(responseTimeNanos) * 1e-6;

		const category = Math.floor(statusCode / 100);

		let action = req.baseUrl + req.path;

		if (config.ignoredEndsWithActionsRegex.test(action)) {
			return;
		}

		if (config.ignoredStartsWithActionsRegex.test(action)) {
			return;
		}

		if (config.normalizeAction) {
			action = config.normalizeAction(action);
		}

		statTracker.trackPerformance(`action.${action}`, responseTimeMillis);
		statTracker.trackPerformance("action.*", responseTimeMillis);

		statTracker.trackEvent(`action-status.${action}.${category}00`);
		statTracker.trackEvent(`action-status.*.${category}00`);

		const userAgent = req.headers['user-agent'];
		const crawler = getCrawlerFromUserAgentString(userAgent);
		if (crawler) {
			statTracker.trackEvent(`site-crawl.${crawler}`);
		}

	} catch (err) {
		debugLog(err);
	}
};

const validateConfig = (cfg?: ActionMonitorOptions): ActionMonitorConfig => {
	const options: ActionMonitorOptions = (cfg || {});

	const ignoredEndsWithActions = options.ignoredEndsWithActions || /\.js|\.css|\.svg|\.png/;
	const ignoredStartsWithActions = options.ignoredStartsWithActions || "ignoreStartsWithThis|andIgnoreStartsWithThis";

	return {
		...options,
		ignoredEndsWithActions: ignoredEndsWithActions,
		ignoredEndsWithActionsRegex: new RegExp(ignoredEndsWithActions + "$", "i"),
		ignoredStartsWithActions: ignoredStartsWithActions,
		ignoredStartsWithActionsRegex: new RegExp("^" + ignoredStartsWithActions, "i")
	};
};

// Express middleware that records how long each action took and its status, in the stat tracker.
const middlewareWrapper = (statTracker: typeof StatTracker, cfg?: ActionMonitorOptions): RequestHandler & { middleware: RequestHandler } => {
	const config = validateConfig(cfg);

	const middleware = (req: Request, res: Response, next: NextFunction) => {
		const startTimeNanos = process.hrtime.bigint();

		onHeaders(res, () => {
			onHeadersListener(config, req, res.statusCode, startTimeNanos, statTracker);
		});

		next();
	};

	return Object.assign(middleware, { middleware });
};

export = middlewareWrapper;
