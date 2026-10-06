export const statNames = [
	"process.cpu",
	"process.mem_mb",
	"mem.heap.used",
	"mem.heap.limit",
	"os.loadavg.1min",
	"os.loadavg.5min"
];

interface DataPoint {
	time: number;
	value: number;
}

const dataPointsToKeep = 60;
const downsamplesToKeep = 72;
const dataPointsPerDownsample = 6;
const appStats: Record<string, DataPoint[]> = {};
const downsampledAppStats: Record<string, DataPoint[]> = {};

export const trackAppStats = (name: string, stats: { max?: number }) => {
	if (statNames.includes(name)) {
		if (!appStats[name]) {
			appStats[name] = [];
			downsampledAppStats[name] = [];
		}

		const dataset = appStats[name];

		if (stats.max) {
			dataset.push({time:new Date().getTime(), value: stats.max});
		}

		if (dataset.length > (dataPointsToKeep + dataPointsPerDownsample)) {
			const downsamplePoints = dataset.slice(0, dataPointsPerDownsample);
			let max = -Infinity;

			// find max of downsample
			downsamplePoints.forEach(x => { if (x.value > max) { max = x.value; } });

			downsampledAppStats[name].push({time:downsamplePoints[0].time, value:max});

			while (dataset.length > dataPointsToKeep) {
				dataset.shift();
			}
		}

		while (downsampledAppStats[name].length > downsamplesToKeep) {
			downsampledAppStats[name].shift();
		}
	}
};

export const getAllAppStats = () => {
	const allStats: Record<string, DataPoint[]> = {};

	if (appStats[statNames[0]]) {
		for (let i = 0; i < statNames.length; i++) {
			if (downsampledAppStats[statNames[i]]) {
				allStats[statNames[i]] = downsampledAppStats[statNames[i]].concat(appStats[statNames[i]]);

			} else {
				allStats[statNames[i]] = appStats[statNames[i]];
			}
		}
	}

	return allStats;
};
