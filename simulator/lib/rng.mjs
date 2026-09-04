/**
 * Deterministic pseudo-randomness for the simulator.
 *
 * `mulberry32` is the same PRNG `tools/generate-neihu-fixtures.mjs` uses, so the
 * whole project has one seedable generator. `subStream` derives an independent
 * stream from a master seed plus a string label and a few integers, which is how
 * every random decision in the engine stays keyed to `(what, round, who, ...)`
 * rather than to call order.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mixInts(ints) {
  let hash = 0x9e3779b9;
  for (const value of ints) {
    let n = value | 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n ^= n >>> 16;
    hash = (Math.imul(hash ^ n, 0x27d4eb2d) + 0x9e3779b9) | 0;
  }
  return hash >>> 0;
}

export function subStream(masterSeed, label, ...ints) {
  return mulberry32(((masterSeed >>> 0) ^ fnv1a(label) ^ mixInts(ints)) >>> 0);
}

/** In-place deterministic Fisher–Yates. Mutates and returns `array`. */
export function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
