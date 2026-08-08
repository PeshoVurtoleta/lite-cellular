/**
 * @zakkster/lite-cellular v0.1.0
 *
 * Zero-GC Worley/cellular noise for 2D. `cellular2(x, y, out?)` returns the two
 * nearest feature-point distances `f1`/`f2` and the F1 owner's cell `id`, written
 * into a caller-owned out-struct -- zero allocation on the query path.
 *
 * This is the v0.1.0 (C0) skeleton: the EUCLIDEAN metric only, INSTANCE-only. The
 * manhattan/chebyshev metrics and the module free-function surface (`seedCellular`,
 * a bare `cellular2`) are DEFERRED to C1 (v1.0.0); the field baker and the exact
 * tileable wrap land in C2. C0 is instance-only, so there is no shared mutable
 * state to warn about yet -- the dev-warn-once discipline arrives with the module
 * half.
 *
 * Conventions pinned here and ratified by decisions/0001..0004:
 *   - feature point of cell (cx,cy) = (cx + 0.5 + jitter*(u-0.5),
 *                                      cy + 0.5 + jitter*(v-0.5))  (0003)
 *   - euclidean returns TRUE distance: squared distance accumulates in the loop,
 *     one sqrt for f1 and one for f2 at the very end -- no sqrt inside the 9-cell
 *     loop (0001).
 *   - the kernel returns exactly { f1, f2, id } -- combination is the caller's
 *     one subtraction, never a per-query option (0002).
 *   - id = the F1 owner's primary hash coerced with `| 0` (signed int32, SMI-safe,
 *     NOT `>>> 0`), a stable opaque per-region tag (0004).
 *
 * Fail closed: non-finite coords, an unknown metric id (anything but 0 in C0), and
 * an out-of-range jitter each throw a library Error. null is not zero.
 *
 * Zero runtime dependencies.
 *
 * @license MIT
 */

export const VERSION = '0.1.0';

// The metric id space is opened here; C1 adds METRIC_MANHATTAN (1) and
// METRIC_CHEBYSHEV (2). C0 accepts only 0 and the guard rejects the rest (0001).
export const METRIC_EUCLIDEAN = 0;

// 2^32, the divisor that maps a uint32 hash draw into [0, 1).
const _UINT32 = 4294967296;

// --- hash: integer cell coords + seed -> uint32 -----------------------------
// Two decorrelated draws give the feature point's (u, v) offset inside the cell.
// Integer-only, allocation-free, modelled on Noise.js `_seedPerm`'s Math.imul +
// xorshift finalizer. Pure functions of the INTEGER cell coords and the seed, so
// the feature field is stable under sub-cell query motion and reproducible
// bit-for-bit (the determinism anchor the goldens pin). Correct for negative cell
// coords: Math.imul distributes signed int32 inputs without an axis artefact.

/** Primary draw -> the cell's `u` and the cell `id` source. Returns a uint32. */
function _hash2(cx, cy, seed) {
    let h = seed | 0;
    h = (h + Math.imul(cx | 0, 0x27d4eb2f)) | 0;
    h = (h + Math.imul(cy | 0, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return (h ^ (h >>> 14)) >>> 0;
}

/** Second, decorrelated draw for the `v` axis (distinct salts). Returns a uint32. */
function _hash2b(cx, cy, seed) {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = (h + Math.imul(cx | 0, 0x85ebca6b)) | 0;
    h = (h + Math.imul(cy | 0, 0xc2b2ae35)) | 0;
    h = Math.imul(h ^ (h >>> 13), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 9), h | 63);
    return (h ^ (h >>> 16)) >>> 0;
}

// --- the kernel: ZERO allocation, fixed 3x3 loop, scalar only ---------------
// State is the first parameter (mirroring Noise.js), so the hot loop reads locals,
// never `this.*`. `metric` is threaded for signature parity with the C1 kernel
// split (0001) -- C0 has one metric, so the body is euclidean only.
function _cellular2(seed, metric, jitter, x, y, out) {
    // Guard the door once, before the loop -- fail closed on non-finite coords so
    // Math.floor is never handed a NaN (Number.isFinite rejects NaN and +/-Inf).
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(
            'lite-cellular: cellular2 requires finite x and y (got ' + x + ', ' + y + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -1; gy <= 1; gy++) {
        for (let gx = -1; gx <= 1; gx++) {
            const cx = ix + gx, cy = iy + gy;
            const h = _hash2(cx, cy, seed);
            const u = h / _UINT32;
            const v = _hash2b(cx, cy, seed) / _UINT32;
            const fx = cx + 0.5 + jitter * (u - 0.5);
            const fy = cy + 0.5 + jitter * (v - 0.5);
            const dx = fx - x, dy = fy - y;
            const d2 = dx * dx + dy * dy;      // euclidean: squared, no sqrt here
            if (d2 < f1) { f2 = f1; f1 = d2; id = h | 0; }   // | 0 not >>> 0 (0004)
            else if (d2 < f2) { f2 = d2; }
        }
    }
    out.f1 = Math.sqrt(f1);   // two sqrts, off the loop, once each (0001)
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/**
 * A cellular (Worley) noise field owning one reused out-struct. Construct via
 * `createCellular(seed, opts)`. The metric and jitter are fixed at construction
 * and immutable for the instance's life; `reseed(seed)` changes the seed only. To
 * change metric or jitter, create another instance.
 */
export class Cellular {
    /**
     * @param {number} [seed]
     * @param {{ metric?: number, jitter?: number }} [opts]
     */
    constructor(seed = 0, opts) {
        // Validate ONCE, at construction -- off every hot path. Fail closed.
        const metric = opts && opts.metric !== undefined ? opts.metric : METRIC_EUCLIDEAN;
        if (metric !== METRIC_EUCLIDEAN) {
            throw new Error(
                'lite-cellular: unknown metric id ' + String(metric) +
                ' -- v0.1.0 accepts only METRIC_EUCLIDEAN (0); manhattan/chebyshev land in v1.0.0');
        }
        const jitter = opts && opts.jitter !== undefined ? opts.jitter : 1;
        if (typeof jitter !== 'number' || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
            throw new Error(
                'lite-cellular: jitter must be a finite number in [0, 1] (got ' + String(jitter) + ')');
        }
        this._seed = seed | 0;
        this._metric = metric;
        this._jitter = jitter;
        // The instance's only owned allocation: one reused out-struct (0003). No
        // permutation table -- cellular scatters one point per cell on demand.
        this._out = { f1: 0, f2: 0, id: 0 };
    }

    /**
     * Sample the field at (x, y). Returns `{ f1, f2, id }`: the nearest and second
     * feature-point distances (true euclidean) and the F1 owner's cell id.
     *
     * `out` is optional. If passed, its `f1`/`f2`/`id` are written in place and it
     * is returned. If omitted, the instance's OWN reused out-struct is returned --
     * a caller that retains it across calls is holding scratch that the next call
     * overwrites. No allocation either way.
     *
     * @param {number} x
     * @param {number} y
     * @param {{ f1: number, f2: number, id: number }} [out]
     * @returns {{ f1: number, f2: number, id: number }}
     */
    cellular2(x, y, out) {
        return _cellular2(this._seed, this._metric, this._jitter, x, y, out || this._out);
    }

    /**
     * Re-seed this instance in place. Setup cost only -- not on any hot path.
     * @param {number} seed
     * @returns {this}
     */
    reseed(seed) {
        this._seed = seed | 0;
        return this;
    }
}

/**
 * Create an independent cellular noise instance.
 * @param {number} [seed]
 * @param {{ metric?: number, jitter?: number }} [opts]
 * @returns {Cellular}
 */
export function createCellular(seed = 0, opts) {
    return new Cellular(seed, opts);
}
