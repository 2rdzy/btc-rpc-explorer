// Turn the raw difficulty-by-epoch data of the difficulty history page into what its charts and
// tables show. Kept in its own file, free of page code, so that it can be tested: it runs in the
// browser (as window.difficultyHistoryData) and in Node (require()).
(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();

	} else {
		root.difficultyHistoryData = factory();
	}
})(typeof self !== 'undefined' ? self : this, function () {
	// raw: { heights: [epoch start heights], <height>: { difficulty, time, blake2b }, ... }
	// yearItems: [[label, years], ...], the time windows the charts offer
	function summarizeData(raw, yearItems) {
		raw.heights.sort((a, b) => a - b);
	
		var summary = {};
		summary.difficultyData = [];
		summary.difficultyDeltaData = [];

		summary.graphData = [];
		summary.graphData_years = {};
		summary.blake2bGraphData_years = {};
		summary.firstBlake2bEpoch = null;
		for (let i = 0; i < yearItems.length; i++) {
			summary.graphData_years[yearItems[i][1]] = [];
			summary.blake2bGraphData_years[yearItems[i][1]] = [];
		}

		summary.changeGraphData_years = {};
		for (let i = 0; i < yearItems.length; i++) {
			summary.changeGraphData_years[yearItems[i][1]] = [];
		}

		for (var i = 0; i < raw.heights.length; i++) {
			var heightStr = `${raw.heights[i]}`;
			var previousHeightStr = `${raw.heights[i - 1]}`;

			var isBlake2b = !!raw[heightStr].blake2b;

			if (isBlake2b && summary.firstBlake2bEpoch == null) {
				summary.firstBlake2bEpoch = i;
			}

			summary.difficultyData.push({epoch:i, date:raw[heightStr].time, difficulty:raw[heightStr].difficulty, blake2b:isBlake2b});

			summary.graphData.push({x:i, y:raw[heightStr].difficulty});

			var yearIndex = Math.floor((raw.heights.length - i) / 26);

			for (let j = 0; j < yearItems.length; j++) {
				if (yearIndex < yearItems[j][1]) {
					(isBlake2b ? summary.blake2bGraphData_years : summary.graphData_years)[yearItems[j][1]].push({x:i, y:raw[heightStr].difficulty});
				}
			}


			if (i == 0) {
				for (let j = 0; j < yearItems.length; j++) {
					if (yearIndex < yearItems[j][1]) {
						summary.changeGraphData_years[yearItems[j][1]].push({x:i, y:0});
					}
				}

				summary.difficultyDeltaData.push({epoch:i});

			} else {
				var d1 = raw[heightStr].difficulty;
				var d0 = raw[previousHeightStr].difficulty

				if (isBlake2b != !!raw[previousHeightStr].blake2b) {
					// the proof of work changed between these epochs: the two difficulties are not comparable
					summary.difficultyDeltaData.push({epoch:i, algorithmChange:true});

					for (let j = 0; j < yearItems.length; j++) {
						if (yearIndex < yearItems[j][1]) {
							summary.changeGraphData_years[yearItems[j][1]].push({x:i, y:null});
						}
					}

					continue;
				}

				var deltaPercent = 100 * (d1 / d0 - 1);

				summary.difficultyDeltaData.push({epoch:i, difficultyDelta:deltaPercent});


				if (deltaPercent > 100) {
					deltaPercent = 100;
				}

				if (deltaPercent < -100) {
					deltaPercent = -100;
				}

				for (let j = 0; j < yearItems.length; j++) {
					if (yearIndex < yearItems[j][1]) {
						summary.changeGraphData_years[yearItems[j][1]].push({x:i, y:deltaPercent});
					}
				}
			}
		}



		return summary;
	}

	return { summarizeData: summarizeData };
});
