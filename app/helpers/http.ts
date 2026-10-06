import type { Request, Response } from "express";

const crawlerBotUserAgentStrings: Record<string, RegExp> = {
	"google": new RegExp("adsbot-google|Googlebot|mediapartners-google", "i"),
	"microsoft": new RegExp("Bingbot|bingpreview|msnbot", "i"),
	"yahoo": new RegExp("Slurp", "i"),
	"duckduckgo": new RegExp("DuckDuckBot", "i"),
	"baidu": new RegExp("Baidu", "i"),
	"yandex": new RegExp("YandexBot", "i"),
	"teoma": new RegExp("teoma", "i"),
	"sogou": new RegExp("Sogou", "i"),
	"exabot": new RegExp("Exabot", "i"),
	"facebook": new RegExp("facebot", "i"),
	"alexa": new RegExp("ia_archiver", "i"),
	"aol": new RegExp("aolbuild", "i"),
	"moz": new RegExp("dotbot", "i"),
	"semrush": new RegExp("SemrushBot", "i"),
	"majestic": new RegExp("MJ12bot", "i"),
	"python-requests": new RegExp("python-requests", "i"),
	"openai": new RegExp("OAI-SearchBot", "i"),
	"unidentifiedCrawler": new RegExp("Test Certificate Info", "i"),
	"amazon": new RegExp("amazonbot", "i"),
	"bytedance": new RegExp("bytespider", "i"),
	"scrapy": new RegExp("Scrapy", "i"),
};

// The name of the crawler bot that sent the request, from its user agent; null for anything else.
export const getCrawlerFromUserAgentString = (userAgentString: string | undefined): string | null => {
	for (const [name, regex] of Object.entries(crawlerBotUserAgentStrings)) {
		if (regex.test(userAgentString as string)) {
			return name;
		}
	}

	return null;
};

// Sends the visitor to the connect page (and remembers where they were going) when the session has no host.
// Returns whether it redirected.
export function redirectToConnectPageIfNeeded(req: Request, res: Response): boolean {
	if (!req.session.host) {
		req.session.redirectUrl = req.originalUrl;

		res.redirect("/");
		res.end();

		return true;
	}

	return false;
}

// The parts of a request that are worth logging, as plain JSON.
export function expressRequestToJson(req: Request) {
	return {
		method: req.method,
		url: req.url,
		headers: req.headers,
		query: req.query,
		params: req.params,
		body: req.body,
		cookies: req.cookies,
		signedCookies: req.signedCookies,
		ip: req.ip,
		ips: req.ips,
		protocol: req.protocol,
		secure: req.secure,
		originalUrl: req.originalUrl,
		hostname: req.hostname,
		baseUrl: req.baseUrl,
	};
}
