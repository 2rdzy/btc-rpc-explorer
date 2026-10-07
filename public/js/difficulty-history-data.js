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
	// The expected number of SHA-256d hashes per block at difficulty 1: 2^256 over the target of difficulty 1
	// (0xffff * 2^208), which is 2^48 / 0xffff.
	var SHA256D_HASHES_PER_DIFFICULTY = 4295032833;

	// The work a block takes, in expected hashes, for the difficulty a block header reports: the BLAKE2b difficulty of
	// Knots already is the expected number of hashes, the SHA-256d difficulty is a multiple of the easiest target.
	// Both are then on one scale, and can be compared.
	function hashesPerBlock(difficulty, isBlake2b) {
		return isBlake2b ? difficulty : difficulty * SHA256D_HASHES_PER_DIFFICULTY;
	}

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

			var hashes = hashesPerBlock(raw[heightStr].difficulty, isBlake2b);

			summary.difficultyData.push({epoch:i, date:raw[heightStr].time, difficulty:raw[heightStr].difficulty, hashes:hashes, blake2b:isBlake2b});

			summary.graphData.push({x:i, y:hashes});

			var yearIndex = Math.floor((raw.heights.length - i) / 26);

			for (let j = 0; j < yearItems.length; j++) {
				if (yearIndex < yearItems[j][1]) {
					(isBlake2b ? summary.blake2bGraphData_years : summary.graphData_years)[yearItems[j][1]].push({x:i, y:hashes});
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
				// the change in the work a block takes: across the switch of the proof of work too, where it fell by far
				var previousIsBlake2b = !!raw[previousHeightStr].blake2b;
				var d1 = hashes;
				var d0 = hashesPerBlock(raw[previousHeightStr].difficulty, previousIsBlake2b);

				var deltaPercent = 100 * (d1 / d0 - 1);

				summary.difficultyDeltaData.push(isBlake2b != previousIsBlake2b ? {epoch:i, algorithmChange:true, difficultyDelta:deltaPercent} : {epoch:i, difficultyDelta:deltaPercent});


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

	return { summarizeData: summarizeData, hashesPerBlock: hashesPerBlock, SHA256D_HASHES_PER_DIFFICULTY: SHA256D_HASHES_PER_DIFFICULTY };
});
