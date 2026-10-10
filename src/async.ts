export class RequestQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await fn(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
export function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.delete(key); cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
