export function binarySearch<T>(
  array: T[],
  target: any,
  getVal: (item: T) => any
): number {
  let low = 0;
  let high = array.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midVal = getVal(array[mid]);

    if (midVal === target) {
      return mid;
    } else if (midVal < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return -1; // Not found
}

// Find first index where getVal(item) >= target (lower bound)
export function lowerBound<T>(
  array: T[],
  target: any,
  getVal: (item: T) => any
): number {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getVal(array[mid]) >= target) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

// Find first index where getVal(item) > target (upper bound)
export function upperBound<T>(
  array: T[],
  target: any,
  getVal: (item: T) => any
): number {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getVal(array[mid]) > target) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

// Returns sub-array of items between minVal and maxVal (inclusive)
// ASSUMES the array is pre-sorted in ascending order by getVal(item)
export function binarySearchRange<T>(
  array: T[],
  minVal: any,
  maxVal: any,
  getVal: (item: T) => any
): T[] {
  if (array.length === 0) return [];
  const start = lowerBound(array, minVal, getVal);
  const end = upperBound(array, maxVal, getVal);
  return array.slice(start, end);
}
