// public/js/fork-marker.js is a script for the browser (and the tests); this describes what it exports.
declare module "*/fork-marker.js" {
	interface ChartLike {
		ctx: unknown,
		chartArea?: { left: number, right: number, top: number, bottom: number },
		scales?: { x?: { min: number, max: number, getPixelForValue(value: number): number } }
	}

	export function plugin(forkHeight: number | null | undefined, label: string, color: string): { id: string, afterDatasetsDraw(chart: ChartLike): void };
	export function segmentColor(forkHeight: number | null | undefined, before: string, after: string): (context: { p1: { parsed: { x: number } } }) => string;
}
