// Fields the explorer's middleware adds to the express request.

export {};

declare global {
	namespace Express {
		interface Request {
			startTime: number;
			authenticated: boolean;
		}
	}
}
