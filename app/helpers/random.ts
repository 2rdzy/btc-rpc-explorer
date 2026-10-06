// A number from 0 up to (not including) 1 that is always the same for the same seed.
export function seededRandom(seed: number): number {
	const x = Math.sin(seed++) * 10000;

	return x - Math.floor(x);
}

// Despite the name, the result is not rounded: it is a number from min up to (not including) max.
export function seededRandomIntBetween(seed: number, min: number, max: number): number {
	const rand = seededRandom(seed);

	return (min + (max - min) * rand);
}

// A whole number from min up to (not including) min + max: the second argument is a span, not an upper bound.
export function randomInt(min: number, max: number): number {
	return min + Math.floor(Math.random() * max);
}
