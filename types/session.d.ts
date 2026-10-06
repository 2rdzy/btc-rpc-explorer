// Fields the explorer keeps in the express session (req.session.<name>).

import "express-session";

declare module "express-session" {
	interface SessionData {
		host: string;
		port: string | number;
		username: string;
		userSettings: any;
		userMessage: string | null;
		userMessageType: string | null;
		query: any;
		redirectUrl: string;
		favoriteRpcCommands: any;
		recentRpcCommands: any;
	}
}
