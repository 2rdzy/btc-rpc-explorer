// Marks the block where the BLAKE2b chain begins in a line chart whose x axis is the block height: a dashed vertical
// line with a label, and a line that is grey before the fork (blocks shared with Bitcoin) and red after it. Kept in its own
// file, free of page code, so that it can be tested: it runs in the browser (as window.forkMarker) and in Node (require()).
(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();

	} else {
		root.forkMarker = factory();
	}
})(typeof self !== 'undefined' ? self : this, function () {
	// A Chart.js plugin. Nothing is drawn when there is no fork height, or when it is outside what the chart shows.
	function plugin(forkHeight, label, color) {
		return {
			id: 'forkMarker',

			afterDatasetsDraw: function (chart) {
				var xScale = chart.scales && chart.scales.x;
				var area = chart.chartArea;

				if (forkHeight == null || !xScale || !area || forkHeight < xScale.min || forkHeight > xScale.max) {
					return;
				}

				var ctx = chart.ctx;
				var x = xScale.getPixelForValue(forkHeight);
				var labelOnTheRight = x < (area.left + area.right) / 2;

				ctx.save();
				ctx.strokeStyle = color;
				ctx.lineWidth = 1;
				ctx.setLineDash([5, 4]);
				ctx.beginPath();
				ctx.moveTo(x, area.top);
				ctx.lineTo(x, area.bottom);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = color;
				ctx.font = '11px sans-serif';
				ctx.textAlign = labelOnTheRight ? 'left' : 'right';
				ctx.fillText(label, x + (labelOnTheRight ? 4 : -4), area.top + 12);
				ctx.restore();
			}
		};
	}

	// The color of each piece of a line (Chart.js `segment.borderColor`): `after` where the piece ends at or after the
	// fork, `before` otherwise. Without a fork height the whole line is `after`.
	function segmentColor(forkHeight, before, after) {
		return function (context) {
			return forkHeight == null || context.p1.parsed.x >= forkHeight ? after : before;
		};
	}

	return { plugin: plugin, segmentColor: segmentColor };
});
