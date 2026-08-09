/**
 * @zakkster/lite-cellular v1.0.0 -- the honest core.
 *
 * Zero-GC Worley/cellular noise for 2D. `cellular2(x, y, out?)` returns the two
 * nearest feature-point distances `f1`/`f2` and the F1 owner's cell `id`, written
 * into a caller-owned out-struct -- zero allocation on the query path.
 *
 * v1.0.0 (C1) opens the three distance metrics (euclidean/manhattan/chebyshev),
 * fixed at instance creation via an integer id, and adds the module free-function
 * surface (`cellular2`, `seedCellular`) modelled line-for-line on lite-noise's
 * shared `_perm` + `seedNoise` dev-warn-once. The field baker and the exact
 * tileable wrap land in C2; `cellular3` in C3.
 *
 * The metric is NOT threaded into the hot loop. There are three metric-specific
 * kernels, each with its distance expression inlined and the metric param DROPPED;
 * the constructor resolves the id to exactly one kernel reference (`this._kernel`)
 * once, so the per-query cost is one indirect call OFF the 9-cell loop and ZERO
 * metric branches per neighbour (0001). `grep -n 'metric' Cellular.js` finds it
 * only in the constructor validation and the binding -- never in a loop body.
 *
 * Conventions pinned here and ratified by decisions/0001..0004:
 *   - feature point of cell (cx,cy) = (cx + 0.5 + jitter*(u-0.5),
 *                                      cy + 0.5 + jitter*(v-0.5))  (0003)
 *   - euclidean returns TRUE distance: squared distance accumulates in the loop,
 *     one sqrt for f1 and one for f2 at the very end -- no sqrt inside the 9-cell
 *     loop. manhattan (|dx|+|dy|) and chebyshev (max(|dx|,|dy|)) accumulate their
 *     linear distance directly, no sqrt. All three report in the SAME linear
 *     units, so the metric-sanity law and the caller's `f2 - f1` stay coherent
 *     (0001).
 *   - the kernel returns exactly { f1, f2, id } -- combination is the caller's
 *     one subtraction, never a per-query option (0002).
 *   - id = the F1 owner's primary hash coerced with `| 0` (signed int32, SMI-safe,
 *     NOT `>>> 0`), a stable opaque per-region tag. The owner is metric-dependent
 *     by design (0004).
 *
 * Fail closed: non-finite coords, an unknown metric id (anything but 0/1/2), and
 * an out-of-range jitter each throw a library Error. null is not zero.
 *
 * Zero runtime dependencies.
 *
 * @license MIT
 */

export const VERSION = '1.0.0';

// The metric id space (0001). C0 opened id 0; C1 opens 1 and 2. The guard widens
// the accepted set (0/1/2) -- it never loosens: any other value still throws.
export const METRIC_EUCLIDEAN = 0;   // default
export const METRIC_MANHATTAN = 1;
export const METRIC_CHEBYSHEV = 2;

// 2^32, the divisor that maps a uint32 hash draw into [0, 1).
const _UINT32 = 4294967296;

// --- hash: integer cell coords + seed -> uint32 -----------------------------
// Two decorrelated draws give the feature point's (u, v) offset inside the cell.
// Integer-only, allocation-free, modelled on Noise.js `_seedPerm`'s Math.imul +
// xorshift finalizer. Pure functions of the INTEGER cell coords and the seed, so
// the feature field is stable under sub-cell query motion and reproducible
// bit-for-bit (the determinism anchor the goldens pin). Correct for negative cell
// coords: Math.imul distributes signed int32 inputs without an axis artefact.
// Shared verbatim by all three metric kernels -- placement is metric-independent
// (0003), so the three kernels differ ONLY in the one distance line.

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

// --- the three kernels: ZERO allocation, fixed 3x3 loop, scalar only --------
// State is the first parameter (mirroring Noise.js), so the hot loop reads locals,
// never `this.*`. The `metric` param is DROPPED (0001 Decision 2): each kernel
// inlines exactly one distance expression, so V8 sees one shape per kernel and
// there is no per-neighbour metric branch. The constructor binds one of these to
// `this._kernel` once; the choice is off the loop.
//
// All three share the feature-point placement verbatim (`_hash2`/`_hash2b`,
// `cell + 0.5 + jitter*(u-0.5)`, `id = h | 0` on the F1 swap) and differ ONLY in
// the one distance line and, for euclidean, the two end-sqrts. They are kept as
// three functions rather than one metric-parameterised loop on purpose: staying
// monomorphic is worth more than deduping the shared scaffold (0001).

/**
 * EUCLIDEAN kernel. Accumulates SQUARED distance in the loop (no sqrt per
 * neighbour) and takes one sqrt for f1 and one for f2 at the very end -- TRUE
 * euclidean distance (0001 Decision 3). The numerics here are byte-identical to
 * the C0 kernel's euclidean path; the euclidean golden must re-derive unchanged.
 */
function _cellular2Euclid(seed, jitter, x, y, out) {
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
            const d = dx * dx + dy * dy;       // euclidean: squared, no sqrt here
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }   // | 0 not >>> 0 (0004)
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = Math.sqrt(f1);   // two sqrts, off the loop, once each (0001)
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/**
 * MANHATTAN (L1) kernel. Distance is `|dx| + |dy|`, accumulated directly -- no
 * sqrt anywhere. f1/f2 are in manhattan units, the same LINEAR units as the other
 * two metrics (0001), so the metric-sanity law and `f2 - f1` stay coherent.
 */
function _cellular2Manhattan(seed, jitter, x, y, out) {
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
            // Branchless abs (Math.abs is a V8 intrinsic): a data-dependent
            // `dx<0?-dx:dx` mispredicts on scattered coords and measured ~2x
            // slower -- the abs branch, not the missing sqrt, was euclidean's
            // speed lead (0001 Measured; digest-identical since dx is never -0).
            const d = Math.abs(dx) + Math.abs(dy);   // manhattan: |dx| + |dy|, no sqrt
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = f1;              // already linear -- no sqrt (0001)
    out.f2 = f2;
    out.id = id;
    return out;
}

/**
 * CHEBYSHEV (Linf) kernel. Distance is `max(|dx|, |dy|)`, accumulated directly --
 * no sqrt anywhere. f1/f2 are in chebyshev units, LINEAR like the others (0001).
 */
function _cellular2Chebyshev(seed, jitter, x, y, out) {
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
            // Branchless abs + max (both V8 intrinsics) for the same reason as the
            // manhattan kernel: the ternary abs/max mispredicted and measured ~2x
            // slower on scattered coords (0001 Measured; digest-identical).
            const d = Math.max(Math.abs(dx), Math.abs(dy));   // chebyshev: max(|dx|,|dy|), no sqrt
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = f1;              // already linear -- no sqrt (0001)
    out.f2 = f2;
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
        if (metric !== METRIC_EUCLIDEAN && metric !== METRIC_MANHATTAN && metric !== METRIC_CHEBYSHEV) {
            throw new Error(
                'lite-cellular: unknown metric id ' + String(metric) +
                ' -- expected METRIC_EUCLIDEAN (0), METRIC_MANHATTAN (1), or METRIC_CHEBYSHEV (2)');
        }
        const jitter = opts && opts.jitter !== undefined ? opts.jitter : 1;
        if (typeof jitter !== 'number' || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
            throw new Error(
                'lite-cellular: jitter must be a finite number in [0, 1] (got ' + String(jitter) + ')');
        }
        this._seed = seed | 0;
        this._metric = metric;
        this._jitter = jitter;
        // Resolve the metric id to exactly one kernel reference, ONCE (0001). The
        // per-query call is one indirect call off the 9-cell loop; the loop each
        // kernel runs is monomorphic and branch-free. This is the only place the
        // metric touches the query path.
        this._kernel = metric === METRIC_MANHATTAN ? _cellular2Manhattan
                     : metric === METRIC_CHEBYSHEV ? _cellular2Chebyshev
                     : _cellular2Euclid;
        // The instance's only owned allocation: one reused out-struct (0003). No
        // permutation table -- cellular scatters one point per cell on demand.
        this._out = { f1: 0, f2: 0, id: 0 };
    }

    /**
     * Sample the field at (x, y). Returns `{ f1, f2, id }`: the nearest and second
     * feature-point distances (in this instance's metric) and the F1 owner's cell
     * id.
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
        return this._kernel(this._seed, this._jitter, x, y, out || this._out);
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

// -- Module-level shared field --
// One seed, shared by every consumer that imports the free `cellular2`. Seeded
// with 0 at load. Deliberately EUCLIDEAN with jitter = 1: the zero-config
// convenience surface, mirroring lite-noise's shared-`_perm` free functions.
// Metric and jitter control require an instance (createCellular) -- a scoping
// choice stated in the README, not a missing feature (0003, Law 6). This is the
// compatibility surface; createCellular is the way to avoid the shared-seed hazard.
let _moduleSeed = 0;
const _moduleOut = { f1: 0, f2: 0, id: 0 };

/**
 * Sample the shared module field at (x, y): EUCLIDEAN, jitter = 1, on the shared
 * module seed. Returns `{ f1, f2, id }` written into the shared module out-struct
 * (or `out` if given). Zero allocation. Throws on non-finite x or y.
 *
 * The module `cellular2` free export and the class method `cellular2` share the
 * name across the module/instance boundary exactly as lite-noise's `simplex2`
 * does -- one is the shared surface, one is `this._kernel`.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ f1: number, f2: number, id: number }} [out]
 * @returns {{ f1: number, f2: number, id: number }}
 */
export function cellular2(x, y, out) {
    return _cellular2Euclid(_moduleSeed, 1, x, y, out || _moduleOut);
}

// `seedCellular` called more than once re-seeds one shared module field every
// module-level consumer reads. Fire a single dev-build warning naming the fix,
// the first time a second call happens. Silent in production (NODE_ENV ===
// 'production'); vocal everywhere the environment can't be proven to be
// production (browsers, where `process` is undefined). Line-for-line off
// lite-noise's seedNoise/_isProd.
let _seedCalls = 0;
function _isProd() {
    return typeof process !== 'undefined'
        && process.env
        && process.env.NODE_ENV === 'production';
}

/**
 * Re-seed the shared module field from `seed`. Call once, or re-seed. Setup cost
 * only -- not on any hot path. Auto-seeded with 0 on load.
 *
 * Shared module state: this mutates a single module-scoped seed. Every consumer
 * importing this module reseeds the SAME field. For two subsystems that need
 * independent seed streams (e.g. terrain + particles), give each its own
 * `createCellular(seed)` instance instead.
 *
 * @param {number} [seed]
 */
export function seedCellular(seed = 0) {
    if (++_seedCalls === 2 && !_isProd()) {
        console.warn(
            '[lite-cellular] seedCellular() called more than once. It re-seeds '
            + 'one shared module field, so every module-level consumer sees the change -- '
            + 'the last caller wins. For independent fields, give each its own '
            + 'createCellular(seed). (This warning fires once.)');
    }
    _moduleSeed = seed | 0;
}
