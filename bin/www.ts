#!/usr/bin/env node

import createDebug from "debug";
import v8 from "v8";
import type { AddressInfo } from "net";
import app from "../app.js";

const debug = createDebug("www");

const maxOldSpaceSize = parseInt(process.env.BTCEXP_OLD_SPACE_MAX_SIZE ?? "", 10) || 1024;
v8.setFlagsFromString(`--max_old_space_size=${maxOldSpaceSize}`);
debug(`Set max_old_space_size to ${maxOldSpaceSize} MB`);

app.set('port', process.env.PORT || process.env.BTCEXP_PORT || 3002);
app.set('host', process.env.BTCEXP_HOST || '127.0.0.1');

const server = app.listen(app.get('port'), app.get('host'), () => {
	const address = server.address() as AddressInfo;

	debug('Express server starting on ' + address.address + ':' + address.port);

	if (app.onStartup) {
		(async function() {
			await app.onStartup?.();

		})();
	}

	debug('Express server startup complete.');
});
