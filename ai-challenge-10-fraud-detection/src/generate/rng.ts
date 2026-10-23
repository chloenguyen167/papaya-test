/** mulberry32: a small, fast 32-bit seeded PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The generator's only source of randomness. */
export class Rng {
  private readonly next01: () => number;

  constructor(seed: number) {
    this.next01 = mulberry32(seed);
  }

  next(): number {
    return this.next01();
  }

  /** Integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next01() * (hi - lo + 1));
  }

  uniform(lo: number, hi: number): number {
    return lo + this.next01() * (hi - lo);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next01() * items.length)] as T;
  }

  /** Standard normal via Box–Muller. */
  normal(): number {
    const u1 = 1 - this.next01(); // (0, 1], avoids log(0)
    const u2 = this.next01();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Fisher–Yates, in place. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next01() * (i + 1));
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }
}
