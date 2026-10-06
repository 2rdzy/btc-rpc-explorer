export interface Rgb { r: number, g: number, b: number }
export interface Hsl { h: number, s: number, l: number }

export function rgbToHsl(r: number, g: number, b: number): Hsl {
	r /= 255; g /= 255; b /= 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;

	let h = 0;
	let s = 0;

	if (max != min) {
		const d = max - min;

		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}

		h /= 6;
	}

	return {h:h, s:s, l:l};
}

// "#0033ff", "0033FF" and "03F" all give {r: 0, g: 51, b: 255}; null when it is not a hex colour.
export function colorHexToRgb(hex: string): Rgb | null {
	// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	hex = hex.replace(shorthandRegex, function(m, r, g, b) {
		return r + r + g + g + b + b;
	});

	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

export function colorHexToHsl(hex: string): Hsl {
	const rgb = colorHexToRgb(hex);

	if (!rgb) {
		throw new Error(`Not a hex colour: ${hex}`);
	}

	return rgbToHsl(rgb.r, rgb.g, rgb.b);
}
