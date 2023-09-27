/*
 * @param {Array|String} a Input array or string.
 * @param {Array|String} b Input array or string.
 * @param {Function} [cmp] Optional function used to compare array values, by default `===` (strict equal operator) is used.
 * @param {Boolean} [atomicChanges=false] Whether an array of `inset|delete|equal` operations should
 * be returned instead of changes set. This makes this function compatible with {@link module:utils/diff~diff `diff()`}.
 * @returns {Array} Array of changes.
 */
function fastDiff(a, b, cmp, atomicChanges = false) {
	// Set the comparator function.
	cmp = cmp || function (a, b) {
		return a === b;
	};
	if (!Array.isArray(a)) {
		a = Array.prototype.slice.call(a);
	}

	if (!Array.isArray(b)) {
		b = Array.prototype.slice.call(b);
	}

	// Find first and last change.
	const changeIndexes = findChangeBoundaryIndexes(a, b, cmp);

	// Transform into changes array.
	return atomicChanges ? changeIndexesToAtomicChanges(changeIndexes, b.length) : changeIndexesToChanges(b, changeIndexes);
}
function findChangeBoundaryIndexes(arr1, arr2, cmp) {
	// Find the first difference between passed values.
	const firstIndex = findFirstDifferenceIndex(arr1, arr2, cmp);

	// If arrays are equal return -1 indexes object.
	if (firstIndex === -1) {
		return { firstIndex: -1, lastIndexOld: -1, lastIndexNew: -1 };
	}

	// Remove the common part of each value and reverse them to make it simpler to find the last difference between them.
	const oldArrayReversed = cutAndReverse(arr1, firstIndex);
	const newArrayReversed = cutAndReverse(arr2, firstIndex);
	const lastIndex = findFirstDifferenceIndex(oldArrayReversed, newArrayReversed, cmp);

	// Use `lastIndex` to calculate proper offset, starting from the beginning (`lastIndex` kind of starts from the end).
	const lastIndexOld = arr1.length - lastIndex;
	const lastIndexNew = arr2.length - lastIndex;

	return { firstIndex, lastIndexOld, lastIndexNew };
}

function findFirstDifferenceIndex(arr1, arr2, cmp) {
	for (let i = 0; i < Math.max(arr1.length, arr2.length); i++) {
		if (arr1[i] === undefined || arr2[i] === undefined || !cmp(arr1[i], arr2[i])) {
			return i;
		}
	}

	return -1; // Return -1 if arrays are equal.
}


function cutAndReverse(arr, howMany) {
	return arr.slice(howMany).reverse();
}
function changeIndexesToChanges(newArray, changeIndexes) {
	const result = [];
	const { firstIndex, lastIndexOld, lastIndexNew } = changeIndexes;

	if (lastIndexNew - firstIndex > 0) {
		result.push({
			index: firstIndex,
			type: 'insert',
			values: newArray.slice(firstIndex, lastIndexNew)
		});
	}

	if (lastIndexOld - firstIndex > 0) {
		result.push({
			index: firstIndex + (lastIndexNew - firstIndex), // Increase index of what was inserted.
			type: 'delete',
			howMany: lastIndexOld - firstIndex
		});
	}

	return result;
}


function changeIndexesToAtomicChanges(changeIndexes, newLength) {
	const { firstIndex, lastIndexOld, lastIndexNew } = changeIndexes;

	// No changes.
	if (firstIndex === -1) {
		return Array(newLength).fill('equal');
	}

	let result = [];
	if (firstIndex > 0) {
		result = result.concat(Array(firstIndex).fill('equal'));
	}

	if (lastIndexNew - firstIndex > 0) {
		result = result.concat(Array(lastIndexNew - firstIndex).fill('insert'));
	}

	if (lastIndexOld - firstIndex > 0) {
		result = result.concat(Array(lastIndexOld - firstIndex).fill('delete'));
	}

	if (lastIndexNew < newLength) {
		result = result.concat(Array(newLength - lastIndexNew).fill('equal'));
	}

	return result;
}

function diff(a, b, cmp) {
	cmp = cmp || function (a, b) {
		return a === b;
	};

	const aLength = a.length;
	const bLength = b.length;

	// Perform `fastDiff` for longer strings/arrays (see #269).
	if (aLength > 200 || bLength > 200 || aLength + bLength > 300) {
		return fastDiff(a, b, cmp, true);
	}

	// Temporary action type statics.
	let _insert, _delete;

	// Swapped the arrays to use the shorter one as the first one.
	if (bLength < aLength) {
		const tmp = a;

		a = b;
		b = tmp;

		// We swap the action types as well.
		_insert = 'delete';
		_delete = 'insert';
	} else {
		_insert = 'insert';
		_delete = 'delete';
	}

	const m = a.length;
	const n = b.length;
	const delta = n - m;

	// Edit scripts, for each diagonal.
	const es = {};
	// Furthest points, the furthest y we can get on each diagonal.
	const fp = {};

	function snake(k) {
		// We use -1 as an alternative below to handle initial values ( instead of filling the fp with -1 first ).
		// Furthest points (y) on the diagonal below k.
		const y1 = (fp[k - 1] !== undefined ? fp[k - 1] : -1) + 1;
		// Furthest points (y) on the diagonal above k.
		const y2 = fp[k + 1] !== undefined ? fp[k + 1] : -1;
		// The way we should go to get further.
		const dir = y1 > y2 ? -1 : 1;

		// Clone previous changes array (if any).
		if (es[k + dir]) {
			es[k] = es[k + dir].slice(0);
		}

		// Create changes array.
		if (!es[k]) {
			es[k] = [];
		}

		// Push the action.
		es[k].push(y1 > y2 ? _insert : _delete);

		// Set the beginning coordinates.
		let y = Math.max(y1, y2);
		let x = y - k;

		// Traverse the diagonal as long as the values match.
		while (x < m && y < n && cmp(a[x], b[y])) {
			x++;
			y++;
			// Push no change action.
			es[k].push('equal');
		}

		return y;
	}

	let p = 0;
	let k;

	// Traverse the graph until we reach the end of the longer string.
	do {
		// Updates furthest points and edit scripts for diagonals below delta.
		for (k = -p; k < delta; k++) {
			fp[k] = snake(k);
		}

		// Updates furthest points and edit scripts for diagonals above delta.
		for (k = delta + p; k > delta; k--) {
			fp[k] = snake(k);
		}

		// Updates furthest point and edit script for the delta diagonal.
		// note that the delta diagonal is the one which goes through the sink (m, n).
		fp[delta] = snake(delta);

		p++;
	} while (fp[delta] !== n);

	// Return the final list of edit changes.
	// We remove the first item that represents the action for the injected nulls.
	return es[delta].slice(1);
}

function diffToChanges(diff, output) {
	const changes = [];
	let index = 0;
	let lastOperation;

	diff.forEach(change => {
		if (change == 'equal') {
			pushLast();

			index++;
		} else if (change == 'insert') {
			if (isContinuationOf('insert')) {
				lastOperation.values.push(output[index]);
			} else {
				pushLast();

				lastOperation = {
					type: 'insert',
					index,
					values: [output[index]]
				};
			}

			index++;
		} else /* if ( change == 'delete' ) */ {
			if (isContinuationOf('delete')) {
				lastOperation.howMany++;
			} else {
				pushLast();

				lastOperation = {
					type: 'delete',
					index,
					howMany: 1
				};
			}
		}
	});

	pushLast();

	return changes;

	function pushLast() {
		if (lastOperation) {
			changes.push(lastOperation);
			lastOperation = null;
		}
	}

	function isContinuationOf(expected) {
		return lastOperation && lastOperation.type == expected;
	}
}
