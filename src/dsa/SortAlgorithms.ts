// Stable Merge Sort
export function mergeSort<T>(array: T[], compare: (a: T, b: T) => number): T[] {
  if (array.length <= 1) return array;

  const mid = Math.floor(array.length / 2);
  const left = mergeSort(array.slice(0, mid), compare);
  const right = mergeSort(array.slice(mid), compare);

  return merge(left, right, compare);
}

function merge<T>(left: T[], right: T[], compare: (a: T, b: T) => number): T[] {
  const result: T[] = [];
  let i = 0, j = 0;

  while (i < left.length && j < right.length) {
    if (compare(left[i], right[j]) <= 0) {
      result.push(left[i]);
      i++;
    } else {
      result.push(right[j]);
      j++;
    }
  }

  return result.concat(left.slice(i)).concat(right.slice(j));
}

// In-place Quick Sort (returns a sorted copy of the array)
export function quickSort<T>(array: T[], compare: (a: T, b: T) => number): T[] {
  const copy = [...array];
  quickSortHelper(copy, 0, copy.length - 1, compare);
  return copy;
}

function quickSortHelper<T>(
  array: T[],
  left: number,
  right: number,
  compare: (a: T, b: T) => number
): void {
  if (left >= right) return;

  const pivotIndex = partition(array, left, right, compare);
  quickSortHelper(array, left, pivotIndex - 1, compare);
  quickSortHelper(array, pivotIndex + 1, right, compare);
}

function partition<T>(
  array: T[],
  left: number,
  right: number,
  compare: (a: T, b: T) => number
): number {
  const pivot = array[right];
  let i = left - 1;

  for (let j = left; j < right; j++) {
    if (compare(array[j], pivot) < 0) {
      i++;
      swap(array, i, j);
    }
  }
  swap(array, i + 1, right);
  return i + 1;
}

function swap<T>(array: T[], i: number, j: number): void {
  const temp = array[i];
  array[i] = array[j];
  array[j] = temp;
}
