import os from "os";
import v8 from "v8";
import pidusage from "pidusage";
import debug from "debug";

import * as statTracker from "./statTracker.js";

const debugLog = debug("systemMonitor");

// optional: the native module is not always installable
let eventLoopStats: { sense(): { min: number, max: number, sum: number, num: number } } | undefined;

try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	eventLoopStats = require("event-loop-stats");

} catch {
	debugLog("Failed loading event-loop-stats, skipping system monitor");
}

const systemMonitorInterval = setInterval(() => {
	pidusage(process.pid, (err, stat) => {
		if (err) {
			debugLog(err);

			return;
		}

		debugLog("pidusage: " + JSON.stringify(stat));

		statTracker.trackValue("process.cpu", stat.cpu);
		statTracker.trackValue("process.mem_mb", stat.memory / 1024 / 1024);
		statTracker.trackValue("process.ctime", stat.ctime);
		statTracker.trackValue("process.uptime_s", stat.elapsed / 1000);

		const loadavg = os.loadavg();

		statTracker.trackValue("os.loadavg.1min", loadavg[0]);
		statTracker.trackValue("os.loadavg.5min", loadavg[1]);
		statTracker.trackValue("os.loadavg.15min", loadavg[2]);

		const heapStats = v8.getHeapStatistics();

		statTracker.trackValue("mem.heap.total", heapStats.total_heap_size / 1024 / 1024);
		statTracker.trackValue("mem.heap.total-executable", heapStats.total_heap_size_executable / 1024 / 1024);
		statTracker.trackValue("mem.heap.total-physical", heapStats.total_physical_size / 1024 / 1024);
		statTracker.trackValue("mem.heap.total-available", heapStats.total_available_size / 1024 / 1024);
		statTracker.trackValue("mem.heap.used", heapStats.used_heap_size / 1024 / 1024);
		statTracker.trackValue("mem.heap.limit", heapStats.heap_size_limit / 1024 / 1024);
		statTracker.trackValue("mem.malloced", heapStats.malloced_memory / 1024 / 1024);
		statTracker.trackValue("mem.malloced-peak", heapStats.peak_malloced_memory / 1024 / 1024);

		if (eventLoopStats) {
			const loopStats = eventLoopStats.sense();

			statTracker.trackValue("eventloop.min", loopStats.min);
			statTracker.trackValue("eventloop.max", loopStats.max);
			statTracker.trackValue("eventloop.sum", loopStats.sum);
			statTracker.trackValue("eventloop.num", loopStats.num);
		}
	});
}, Number(process.env.SYSTEM_MONITOR_INTERVAL) || 60 * 60 * 1000);

systemMonitorInterval.unref();
