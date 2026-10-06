export interface Stat {
	min: number;
	max: number;
	sum: number;
	count: number;
	avg?: number;
	firstDate: Date;
	lastDate?: Date;
}

type Stats = Record<string, Stat>;

let performanceStats: Stats = {};
let valueStats: Stats = {};
let eventStats: Record<string, number> = {};

const track = (stats: Stats, name: string, value: number) => {
	if (!stats[name]) {
		stats[name] = {
			min: value,
			max: value,
			sum: 0,
			count: 0,
			firstDate: new Date()
		};
	}

	if (value < stats[name].min) {
		stats[name].min = value;
	}

	if (value > stats[name].max) {
		stats[name].max = value;
	}

	stats[name].count++;
	stats[name].sum += value;
	stats[name].avg = stats[name].sum / stats[name].count;
	stats[name].lastDate = new Date();
};

export const trackPerformance = (name: string, time: number) => track(performanceStats, name, time);

export const trackValue = (name: string, val: number) => track(valueStats, name, val);

export const trackEvent = (name: string, count = 1) => {
	if (!eventStats[name]) {
		eventStats[name] = 0;
	}

	eventStats[name] += count;
};

// Hand every statistic gathered so far to the given functions, then start again from nothing.
export const processAndReset = (
	perfFunc: (name: string, stat: Stat) => void,
	valueFunc: (name: string, stat: Stat) => void,
	eventFunc: (name: string, stat: { count: number }) => void
) => {
	for (const [key, value] of Object.entries(performanceStats)) {
		perfFunc(key, value);
	}

	for (const [key, value] of Object.entries(valueStats)) {
		valueFunc(key, value);
	}

	for (const [key, value] of Object.entries(eventStats)) {
		eventFunc(key, {count:value});
	}

	performanceStats = {};
	valueStats = {};
	eventStats = {};
};

export const currentStats = () => {
	return {
		performance: performanceStats,
		event: eventStats,
		value: valueStats
	};
};
