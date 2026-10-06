// public/js/difficulty-history-data.js is a script for the browser (and the tests); this describes what it exports.
declare module "*/difficulty-history-data.js" {
	export interface Point { x: number, y: number | null }

	export interface DifficultySummary {
		difficultyData: { epoch: number, date: number, difficulty: number, blake2b: boolean }[],
		difficultyDeltaData: { epoch: number, algorithmChange?: boolean, difficultyDelta?: number }[],
		graphData: Point[],
		graphData_years: Record<string, Point[]>,
		blake2bGraphData_years: Record<string, Point[]>,
		changeGraphData_years: Record<string, Point[]>,
		firstBlake2bEpoch: number | null
	}

	// raw: the heights of the epoch starts, and for each height (as a key) its difficulty, time and blake2b flag
	export function summarizeData(raw: { heights: number[], [height: string]: any }, yearItems: [string, number][]): DifficultySummary;
}
