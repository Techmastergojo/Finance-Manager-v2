export class HashMap<K, V> {
  private buckets: Array<Array<[K, V]>>;
  private size: number = 0;
  private capacity: number;

  constructor(capacity: number = 31) {
    this.capacity = capacity;
    this.buckets = Array.from({ length: capacity }, () => []);
  }

  private hash(key: K): number {
    const str = String(key);
    let hashVal = 0;
    for (let i = 0; i < str.length; i++) {
      hashVal = (hashVal << 5) - hashVal + str.charCodeAt(i);
      hashVal |= 0; // Convert to 32bit integer
    }
    return Math.abs(hashVal % this.capacity);
  }

  public put(key: K, value: V): void {
    const index = this.hash(key);
    const bucket = this.buckets[index];
    for (let i = 0; i < bucket.length; i++) {
      if (bucket[i][0] === key) {
        bucket[i][1] = value;
        return;
      }
    }
    bucket.push([key, value]);
    this.size++;
  }

  public get(key: K): V | undefined {
    const index = this.hash(key);
    const bucket = this.buckets[index];
    for (const pair of bucket) {
      if (pair[0] === key) {
        return pair[1];
      }
    }
    return undefined;
  }

  public remove(key: K): boolean {
    const index = this.hash(key);
    const bucket = this.buckets[index];
    for (let i = 0; i < bucket.length; i++) {
      if (bucket[i][0] === key) {
        bucket.splice(i, 1);
        this.size--;
        return true;
      }
    }
    return false;
  }

  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  public keys(): K[] {
    const keysList: K[] = [];
    for (const bucket of this.buckets) {
      for (const pair of bucket) {
        keysList.push(pair[0]);
      }
    }
    return keysList;
  }

  public values(): V[] {
    const valuesList: V[] = [];
    for (const bucket of this.buckets) {
      for (const pair of bucket) {
        valuesList.push(pair[1]);
      }
    }
    return valuesList;
  }

  public clear(): void {
    this.buckets = Array.from({ length: this.capacity }, () => []);
    this.size = 0;
  }

  public getSize(): number {
    return this.size;
  }
}
