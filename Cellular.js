/**
 * @zakkster/lite-cellular v1.3.0 -- the texture surface, in 2D and 3D.
 *
 * Zero-GC Worley/cellular noise for 2D. `cellular2(x, y, out?)` returns the two
 * nearest feature-point distances `f1`/`f2` and the F1 owner's cell `id`, written
 * into a caller-owned out-struct -- zero allocation on the query path.
 *
 * v1.3.0 (C4) makes the neighbourhood EXACT (0008). A fixed 3x3 / 3x3x3 scan is
 * sufficient only for chebyshev (L-inf never reaches past the adjacent cell); an
 * L1/L2 unit-cell ball can reach a feature TWO cells away, so the radius-1 euclid and
 * manhattan kernels missed the true `f1`/`f2` in rare edge cases (~2e-6 euclid, ~2e-4
 * manhattan). The 8 euclid/manhattan kernels are widened to radius 2 (2D 5x5 = 25
 * cells, 3D 5x5x5 = 125 cells); the 4 chebyshev kernels stay radius 1 (byte-unchanged).
 * Now every metric's scan is guaranteed to contain the true nearest and second-nearest
 * feature at its exact radius -- proven bit-for-bit against a radius-3 oracle. The
 * euclid/manhattan goldens re-derive to new digests; the chebyshev goldens do not move.
 *
 * v1.0.0 (C1) opens the three distance metrics (euclidean/manhattan/chebyshev),
 * fixed at instance creation via an integer id, and adds the module free-function
 * surface (`cellular2`, `seedCellular`) modelled line-for-line on lite-noise's
 * shared `_perm` + `seedNoise` dev-warn-once.
 *
 * v1.1.0 (C2) adds the money surface -- two INSTANCE methods, both zero-alloc:
 *   - `fillCellField2(dst, w, h, opts?)` bakes a whole `w*h` field into a
 *     caller-owned typed array, with `combo` (f1 / f2-f1 / f2) resolved ONCE
 *     before the loop and an optional in-place normalize (decisions/0005).
 *   - `tileableCell2(x, y, periodX, periodY, out?)` is `cellular2` with the integer
 *     CELL coords wrapped mod an integer period, so the field is EXACTLY periodic
 *     (`===`, not epsilon) and seamless by construction (decisions/0006).
 * The plain `cellular2` path is byte-for-byte unchanged from C1 -- the tiling wrap
 * lives in three SEPARATE kernels, so the per-query hot loop pays nothing for it.
 *
 * v1.2.0 (C3) LIFTS the whole 2D surface into 3D -- a verbatim lift of decisions
 * 0001..0006 with the coordinate count bumped 2 -> 3, closing decisions/0007. Three
 * INSTANCE methods, all zero-alloc, over a per-metric neighbourhood (chebyshev
 * 3x3x3 = 27 cells; euclid/manhattan 5x5x5 = 125 cells since 1.3.0, 0008):
 *   - `cellular3(x, y, z, out?)` -- the neighbourhood scan; same `{f1,f2,id}` shape.
 *   - `fillCellField3(dst, w, h, d, opts?)` -- 0005's baker lifted to a volume.
 *   - `tileableCell3(x, y, z, periodX, periodY, periodZ, out?)` -- 0006's exact
 *     integer-cell wrap on all three axes.
 * There are SIX 3D kernels (three plain + three tiling), each fully inlined with the
 * metric dropped and bound once (`this._kernel3` / `this._tileKernel3`) -- twelve
 * kernels across 2D+3D, NEVER one dimension-parameterised loop (0007 Decision 3). The
 * entire 2D surface is byte-unchanged; there is no module 3D surface and no 4D (0007
 * Decision 4). The 3D hashes extend the C0 `_hash2` chain with a third decorrelated
 * draw `w` for the z axis (0003).
 *
 * The metric is NOT threaded into the hot loop. There are three metric-specific
 * kernels, each with its distance expression inlined and the metric param DROPPED;
 * the constructor resolves the id to exactly one kernel reference (`this._kernel`)
 * once, so the per-query cost is one indirect call OFF the neighbourhood loop and ZERO
 * metric branches per neighbour (0001). `grep -n 'metric' Cellular.js` finds it
 * only in the constructor validation and the binding -- never in a loop body.
 *
 * Conventions pinned here and ratified by decisions/0001..0004:
 *   - feature point of cell (cx,cy) = (cx + 0.5 + jitter*(u-0.5),
 *                                      cy + 0.5 + jitter*(v-0.5))  (0003)
 *   - euclidean returns TRUE distance: squared distance accumulates in the loop,
 *     one sqrt for f1 and one for f2 at the very end -- no sqrt inside the
 *     neighbourhood loop. manhattan (|dx|+|dy|) and chebyshev (max(|dx|,|dy|)) accumulate their
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

export const VERSION = '1.3.0';

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

// --- the three kernels: ZERO allocation, fixed neighbourhood loop, scalar only --------
// (euclid/manhattan scan 5x5 = 25 cells, chebyshev 3x3 = 9 cells -- 0008.)
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
    // Radius 2 (5x5 = 25 cells): an L2 unit-cell ball can reach a feature point two
    // cells away, so the true f1/f2 are only guaranteed inside the 5x5 neighbourhood --
    // the radius-1 3x3 missed them ~2e-6 of the time (0008). Chebyshev stays radius 1.
    for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
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
    // Radius 2 (5x5 = 25 cells): an L1 unit-cell ball reaches farther than an L2 ball,
    // so manhattan needs the 5x5 neighbourhood too -- the radius-1 3x3 missed the true
    // f1/f2 ~2e-4 of the time (0008). Chebyshev stays radius 1 (L-inf is exact at 3x3).
    for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
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

// --- the tiling wrap (0006) -------------------------------------------------
// Positive integer modulo: reduce a signed cell coordinate into [0, P) so cells
// near (and left of) the origin wrap correctly. `_hash2`/`_hash2b` already key on
// integer cell coords, so a reduced coord is still an EXACT integer -- the hash of
// cell `P` equals the hash of cell `0` bit-for-bit, which is what makes the tile
// seamless with `===`, not with float epsilon (0006 Decision 2).
function _wrap(c, P) { return ((c % P) + P) % P; }

// The three TILING kernels mirror the three plain kernels above with ONE semantic
// change: the two hash inputs per neighbour are reduced mod the period via `_wrap`
// (0006 Decision 1/4). One numeric refinement makes the exact-`===` periodicity of
// 0006 Decision 2 REAL rather than epsilon: the distance is computed in the query
// cell's LOCAL frame. `rx = x - floor(x)` is the fractional position inside the home
// cell; the feature point's offset from the home cell is `gx + 0.5 + jitter*(u-0.5)`
// (a small value, ~[-1.5, 1.5], independent of the absolute cell index). At `x` and
// `x + periodX` the wrapped hash is identical (so `u`, `v`, `gx`, `gy` match) and, on
// a representable coordinate, `rx` is bit-identical -- so every `dx`/`dy`, the metric,
// and `id` are bit-for-bit equal. The plain kernels keep their absolute-frame
// `fx - x` (the golden anchor); the tiling kernels take the local frame because the
// absolute frame loses the low bits at the shifted magnitude and would only wrap to
// float epsilon (exactly the anti-pattern 0006 rejects). Distance line, jitter, and
// id are otherwise unchanged. Kept as three separate functions (not one parameterised
// loop) for the monomorphism reason 0001 keeps three.

/** EUCLIDEAN tiling kernel: euclid in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell2Euclid(seed, jitter, periodX, periodY, x, y, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(
            'lite-cellular: tileableCell2 requires finite x and y (got ' + x + ', ' + y + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y);
    const rx = x - ix, ry = y - iy;   // fractional home-cell position; bit-stable under +period
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (25 cells), matching the plain euclid kernel (0008). The wrap on the
    // INTEGER cell and the local-frame offset extend to the wider ring verbatim, so the
    // tile stays EXACTLY periodic (0006) AND the widened f1/f2 are exact.
    for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
            const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY);   // wrap the INTEGER cell (0006)
            const h = _hash2(wx, wy, seed);
            const u = h / _UINT32;
            const v = _hash2b(wx, wy, seed) / _UINT32;
            const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;   // local frame: small, magnitude-stable
            const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
            const d = dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/** MANHATTAN tiling kernel: L1 in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell2Manhattan(seed, jitter, periodX, periodY, x, y, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(
            'lite-cellular: tileableCell2 requires finite x and y (got ' + x + ', ' + y + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y);
    const rx = x - ix, ry = y - iy;
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (25 cells), matching the plain manhattan kernel (0008). The wrap on the
    // INTEGER cell and the local-frame offset extend to the wider ring verbatim, so the
    // tile stays EXACTLY periodic (0006) AND the widened f1/f2 are exact.
    for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
            const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY);
            const h = _hash2(wx, wy, seed);
            const u = h / _UINT32;
            const v = _hash2b(wx, wy, seed) / _UINT32;
            const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
            const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = id;
    return out;
}

/** CHEBYSHEV tiling kernel: Linf in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell2Chebyshev(seed, jitter, periodX, periodY, x, y, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(
            'lite-cellular: tileableCell2 requires finite x and y (got ' + x + ', ' + y + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y);
    const rx = x - ix, ry = y - iy;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gy = -1; gy <= 1; gy++) {
        for (let gx = -1; gx <= 1; gx++) {
            const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY);
            const h = _hash2(wx, wy, seed);
            const u = h / _UINT32;
            const v = _hash2b(wx, wy, seed) / _UINT32;
            const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
            const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
            else if (d < f2) { f2 = d; }
        }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = id;
    return out;
}

// --- 3D hash: integer cell coords + seed -> uint32 (0003, 0007) -------------
// The C0 `_hash2`/`_hash2b` chain extended with a third axis and a THIRD
// decorrelated draw `w` for the z placement (0007 Decision 2: lift 0003 to R^3).
// Three integer-only mixes with distinct salts, per-axis multipliers, and
// finalizers, so the feature point of a 3D cell scatters without a diagonal or an
// axis artefact. Pure functions of the INTEGER cell coords and the seed -- the same
// determinism anchor the 2D hashes are, so the 3D goldens pin them bit-for-bit.
// Shared verbatim by all six 3D kernels; placement is metric-independent (0003).

/** Primary 3D draw -> the cell's `u` and the cell `id` source. Returns a uint32. */
function _hash3(cx, cy, cz, seed) {
    let h = seed | 0;
    h = (h + Math.imul(cx | 0, 0x27d4eb2f)) | 0;
    h = (h + Math.imul(cy | 0, 0x165667b1)) | 0;
    h = (h + Math.imul(cz | 0, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return (h ^ (h >>> 14)) >>> 0;
}

/** Second, decorrelated 3D draw for the `v` axis (distinct salts). Returns a uint32. */
function _hash3b(cx, cy, cz, seed) {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = (h + Math.imul(cx | 0, 0x85ebca6b)) | 0;
    h = (h + Math.imul(cy | 0, 0xc2b2ae35)) | 0;
    h = (h + Math.imul(cz | 0, 0x27d4eb2f)) | 0;
    h = Math.imul(h ^ (h >>> 13), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 9), h | 63);
    return (h ^ (h >>> 16)) >>> 0;
}

/** Third, decorrelated 3D draw for the `w` axis (distinct salts). Returns a uint32. */
function _hash3c(cx, cy, cz, seed) {
    let h = (seed ^ 0x85ebca6b) | 0;
    h = (h + Math.imul(cx | 0, 0xc2b2ae35)) | 0;
    h = (h + Math.imul(cy | 0, 0x9e3779b1)) | 0;
    h = (h + Math.imul(cz | 0, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 14), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 11), h | 59);
    return (h ^ (h >>> 15)) >>> 0;
}

// --- the six 3D kernels: ZERO allocation, fixed neighbourhood loop, scalar only ------
// A verbatim lift of the six 2D kernels with the coordinate count bumped 2 -> 3 (0007
// Decision 2/3). Per-metric radius (0008): chebyshev scans 3x3x3 = 27 cells, euclid and
// manhattan scan 5x5x5 = 125 cells (an L1/L2 ball reaches two cells away). The metric is
// DROPPED exactly as in 2D: three plain + three tiling kernels, each with one distance
// line inlined, bound once at construction to `this._kernel3` / `this._tileKernel3`, so
// the per-query cost is one indirect call OFF the neighbourhood loop and zero metric
// branches per neighbour. NEVER a dimension-parameterised loop (0007 Decision 3):
// keeping them separate and inlined is the monomorphism the package is built on.

/**
 * EUCLIDEAN 3D kernel. Accumulates SQUARED distance over the 125-cell loop (no sqrt
 * per neighbour) and takes one sqrt for f1 and one for f2 at the very end -- TRUE
 * euclidean distance in R^3 (0001 Decision 3, lifted 0007; radius 2 per 0008).
 */
function _cellular3Euclid(seed, jitter, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: cellular3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (5x5x5 = 125 cells): the 2D widening (0008) lifted to R^3 -- an L2 ball
    // reaches a feature two cells away on any axis, so the true f1/f2 live in the 5x5x5
    // neighbourhood. Chebyshev stays radius 1 (27 cells).
    for (let gz = -2; gz <= 2; gz++) {
        for (let gy = -2; gy <= 2; gy++) {
            for (let gx = -2; gx <= 2; gx++) {
                const cx = ix + gx, cy = iy + gy, cz = iz + gz;
                const h = _hash3(cx, cy, cz, seed);
                const u = h / _UINT32;
                const v = _hash3b(cx, cy, cz, seed) / _UINT32;
                const w = _hash3c(cx, cy, cz, seed) / _UINT32;
                const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
                const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
                const dz = (cz + 0.5 + jitter * (w - 0.5)) - z;
                const d = dx * dx + dy * dy + dz * dz;   // euclidean: squared, no sqrt here
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }   // | 0 not >>> 0 (0004)
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = Math.sqrt(f1);   // two sqrts, off the loop, once each (0001)
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/**
 * MANHATTAN (L1) 3D kernel. Distance is `|dx| + |dy| + |dz|`, accumulated directly
 * -- no sqrt anywhere. Branchless `Math.abs` (a V8 intrinsic) for the same reason
 * as the 2D kernel (0001 Measured). Linear units, so the metric-sanity law holds.
 */
function _cellular3Manhattan(seed, jitter, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: cellular3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (5x5x5 = 125 cells): the 2D manhattan widening (0008) lifted to R^3.
    // Chebyshev stays radius 1 (27 cells).
    for (let gz = -2; gz <= 2; gz++) {
        for (let gy = -2; gy <= 2; gy++) {
            for (let gx = -2; gx <= 2; gx++) {
                const cx = ix + gx, cy = iy + gy, cz = iz + gz;
                const h = _hash3(cx, cy, cz, seed);
                const u = h / _UINT32;
                const v = _hash3b(cx, cy, cz, seed) / _UINT32;
                const w = _hash3c(cx, cy, cz, seed) / _UINT32;
                const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
                const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
                const dz = (cz + 0.5 + jitter * (w - 0.5)) - z;
                const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);   // manhattan: no sqrt
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = f1;              // already linear -- no sqrt (0001)
    out.f2 = f2;
    out.id = id;
    return out;
}

/**
 * CHEBYSHEV (Linf) 3D kernel. Distance is `max(|dx|, |dy|, |dz|)`, accumulated
 * directly -- no sqrt anywhere. Branchless `Math.abs` / `Math.max` (0001 Measured).
 */
function _cellular3Chebyshev(seed, jitter, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: cellular3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -1; gz <= 1; gz++) {
        for (let gy = -1; gy <= 1; gy++) {
            for (let gx = -1; gx <= 1; gx++) {
                const cx = ix + gx, cy = iy + gy, cz = iz + gz;
                const h = _hash3(cx, cy, cz, seed);
                const u = h / _UINT32;
                const v = _hash3b(cx, cy, cz, seed) / _UINT32;
                const w = _hash3c(cx, cy, cz, seed) / _UINT32;
                const dx = (cx + 0.5 + jitter * (u - 0.5)) - x;
                const dy = (cy + 0.5 + jitter * (v - 0.5)) - y;
                const dz = (cz + 0.5 + jitter * (w - 0.5)) - z;
                const d = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));   // chebyshev: no sqrt
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = f1;              // already linear -- no sqrt (0001)
    out.f2 = f2;
    out.id = id;
    return out;
}

// The three TILING 3D kernels mirror the three plain 3D kernels with ONE change: the
// three hash inputs per neighbour are reduced mod their period via `_wrap` (0006
// Decision 1/4, lifted to R^3), and the distance is taken in the query cell's LOCAL
// frame (`rx = x - floor(x)`, etc.) so the exact-`===` periodicity is REAL, not float
// epsilon -- wrapping the FLOAT coord instead of the integer cell is the anti-pattern
// 0006 rejects. Kept as three separate inlined functions for the monomorphism 0001
// keeps three.

/** EUCLIDEAN 3D tiling kernel: euclid in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell3Euclid(seed, jitter, periodX, periodY, periodZ, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: tileableCell3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = x - ix, ry = y - iy, rz = z - iz;   // fractional home-cell position; bit-stable under +period
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (125 cells), matching the plain euclid 3D kernel (0008). The per-axis
    // wrap on the INTEGER cell and the local-frame offset extend to the wider ring
    // verbatim, so the volume stays EXACTLY periodic (0006) AND the widened f1/f2 exact.
    for (let gz = -2; gz <= 2; gz++) {
        for (let gy = -2; gy <= 2; gy++) {
            for (let gx = -2; gx <= 2; gx++) {
                const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY), wz = _wrap(iz + gz, periodZ);
                const h = _hash3(wx, wy, wz, seed);
                const u = h / _UINT32;
                const v = _hash3b(wx, wy, wz, seed) / _UINT32;
                const w = _hash3c(wx, wy, wz, seed) / _UINT32;
                const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;   // local frame: small, magnitude-stable
                const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
                const dz = (gz + 0.5 + jitter * (w - 0.5)) - rz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = Math.sqrt(f1);
    out.f2 = Math.sqrt(f2);
    out.id = id;
    return out;
}

/** MANHATTAN 3D tiling kernel: L1 in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell3Manhattan(seed, jitter, periodX, periodY, periodZ, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: tileableCell3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = x - ix, ry = y - iy, rz = z - iz;
    let f1 = Infinity, f2 = Infinity, id = 0;
    // Radius 2 (125 cells), matching the plain manhattan 3D kernel (0008). Wrap on the
    // INTEGER cell + local-frame offset extend to the wider ring verbatim -- the volume
    // stays EXACTLY periodic (0006) AND the widened f1/f2 are exact.
    for (let gz = -2; gz <= 2; gz++) {
        for (let gy = -2; gy <= 2; gy++) {
            for (let gx = -2; gx <= 2; gx++) {
                const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY), wz = _wrap(iz + gz, periodZ);
                const h = _hash3(wx, wy, wz, seed);
                const u = h / _UINT32;
                const v = _hash3b(wx, wy, wz, seed) / _UINT32;
                const w = _hash3c(wx, wy, wz, seed) / _UINT32;
                const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
                const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
                const dz = (gz + 0.5 + jitter * (w - 0.5)) - rz;
                const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = id;
    return out;
}

/** CHEBYSHEV 3D tiling kernel: Linf in the home-cell LOCAL frame, hash inputs wrapped mod period. */
function _tileableCell3Chebyshev(seed, jitter, periodX, periodY, periodZ, x, y, z, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            'lite-cellular: tileableCell3 requires finite x, y and z (got ' + x + ', ' + y + ', ' + z + ')');
    }
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = x - ix, ry = y - iy, rz = z - iz;
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let gz = -1; gz <= 1; gz++) {
        for (let gy = -1; gy <= 1; gy++) {
            for (let gx = -1; gx <= 1; gx++) {
                const wx = _wrap(ix + gx, periodX), wy = _wrap(iy + gy, periodY), wz = _wrap(iz + gz, periodZ);
                const h = _hash3(wx, wy, wz, seed);
                const u = h / _UINT32;
                const v = _hash3b(wx, wy, wz, seed) / _UINT32;
                const w = _hash3c(wx, wy, wz, seed) / _UINT32;
                const dx = (gx + 0.5 + jitter * (u - 0.5)) - rx;
                const dy = (gy + 0.5 + jitter * (v - 0.5)) - ry;
                const dz = (gz + 0.5 + jitter * (w - 0.5)) - rz;
                const d = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
                if (d < f1) { f2 = f1; f1 = d; id = h | 0; }
                else if (d < f2) { f2 = d; }
            }
        }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = id;
    return out;
}

// `combo` string -> small-int selector, decoded ONCE before the bake loop (0005
// Decision 2), mirroring lite-noise's `_TF2_MODELS`. The pixel loop branches on the
// small int, NEVER re-parses the string. `undefined` for an unknown key is the
// fail-closed signal.
const _COMBO = { 'f1': 0, 'f2-f1': 1, 'cracks': 1, 'f2': 2 };

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
        // per-query call is one indirect call off the neighbourhood loop; the loop each
        // kernel runs is monomorphic and branch-free. This is the only place the
        // metric touches the query path.
        this._kernel = metric === METRIC_MANHATTAN ? _cellular2Manhattan
                     : metric === METRIC_CHEBYSHEV ? _cellular2Chebyshev
                     : _cellular2Euclid;
        // Bind the matching TILING kernel once too (0006 Decision 4), so a tile
        // query / bake pays one indirect call off the loop -- and the plain
        // `cellular2` path above stays byte-for-byte C1 (no modulo, no branch).
        this._tileKernel = metric === METRIC_MANHATTAN ? _tileableCell2Manhattan
                         : metric === METRIC_CHEBYSHEV ? _tileableCell2Chebyshev
                         : _tileableCell2Euclid;
        // Bind the matching 3D pair once too (0007), metric-selected exactly as the
        // 2D pair above -- the per-query neighbourhood scan is one indirect call off the
        // loop. NO dimension parameter: 2D and
        // 3D are separate inlined kernel families (0007 Decision 3).
        this._kernel3 = metric === METRIC_MANHATTAN ? _cellular3Manhattan
                      : metric === METRIC_CHEBYSHEV ? _cellular3Chebyshev
                      : _cellular3Euclid;
        this._tileKernel3 = metric === METRIC_MANHATTAN ? _tileableCell3Manhattan
                          : metric === METRIC_CHEBYSHEV ? _tileableCell3Chebyshev
                          : _tileableCell3Euclid;
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
     * Sample the EXACTLY-TILEABLE field at (x, y) with a tile of `periodX` x
     * `periodY` CELLS. Identical to `cellular2` except each neighbour's integer
     * cell coordinate is reduced modulo the period before hashing, so the field is
     * bit-identically periodic (`f1`/`f2`/`id` at `x` and `x + periodX` are `===`,
     * not merely close) and seamless by construction -- strictly better than a
     * float-lattice tile's epsilon seam. See `decisions/0006`.
     *
     * `periodX`/`periodY` are REQUIRED positive integers (a whole number of cells);
     * `0`, negatives, non-integers, `NaN`, and `Infinity` throw (fail closed -- a
     * tile with no size is meaningless; there is no default). Writes into `out` if
     * given (and returns it), else the instance's reused out-struct. Zero allocation.
     * Throws on non-finite `x` or `y`.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} periodX  tile width in cells; positive integer.
     * @param {number} periodY  tile height in cells; positive integer.
     * @param {{ f1: number, f2: number, id: number }} [out]
     * @returns {{ f1: number, f2: number, id: number }}
     */
    tileableCell2(x, y, periodX, periodY, out) {
        if (!Number.isInteger(periodX) || periodX < 1 || !Number.isInteger(periodY) || periodY < 1) {
            throw new Error(
                'lite-cellular: tileableCell2 requires positive integer periodX and periodY (got ' +
                String(periodX) + ', ' + String(periodY) + ')');
        }
        return this._tileKernel(this._seed, this._jitter, periodX, periodY, x, y, out || this._out);
    }

    /**
     * Bake a whole `w` x `h` cellular field into a caller-owned typed array, row-
     * major, allocation-free. The baker OWNS NOTHING: it validates `dst` and writes
     * `w*h` values into it, returning `dst`. See `decisions/0005`.
     *
     * `opts` (all optional, guarded so the omitted-opts path allocates nothing --
     * `opts?.k ?? default`, never `opts = {}`):
     *   - `scale`   coord step per pixel (`px += scale`); default `0.01`.
     *   - `combo`   which texture to store: `'f1'` (blobs), `'f2-f1'` (cracks, alias
     *               `'cracks'`), or `'f2'` (soft cells); default `'f1'`. Decoded to a
     *               small-int selector ONCE before the loop; unknown throws (0005).
     *   - `jitter`  override the instance jitter for this bake; default the
     *               instance's jitter. Bounds-validated like the constructor -- a
     *               value outside `[0, 1]` (or non-finite / non-number) throws.
     *   - `ox`,`oy` world-space origin; default `0`.
     *   - `normalize` opt-in in-place remap to `[0,1]` (two-pass min/max, no temp
     *               buffer; a constant field maps to all-zero -- no divide-by-zero);
     *               default `false` (the raw distance field is the honest primitive).
     *   - `periodX`,`periodY` set BOTH (positive integers) to bake a seamless tile
     *               (0006's wrap in this loop -- pick `scale = periodX / w`); omit
     *               both for a plain field. A partial/invalid period throws.
     *
     * Fail closed: `w`/`h` must be positive integers and `dst` a typed array with
     * `length >= w*h`, else throw (an undersized buffer is a caller error, never a
     * silent short write). The metric is the instance's, bound once (0001) -- no
     * per-pixel metric branch; combo is a small-int select on two locals -- no
     * per-pixel string parse; the scan writes one reused scratch struct -- no
     * per-pixel object. Zero allocation once options are read.
     *
     * @param {Float64Array | Float32Array} dst  caller-owned, length `>= w*h`.
     * @param {number} w  positive integer width.
     * @param {number} h  positive integer height.
     * @param {{ scale?: number, combo?: string, jitter?: number, ox?: number,
     *          oy?: number, normalize?: boolean, periodX?: number, periodY?: number }} [opts]
     * @returns {Float64Array | Float32Array} `dst`.
     */
    fillCellField2(dst, w, h, opts) {
        // Fail closed at SETUP, before dst is touched (0005 Decision 1).
        if (!Number.isInteger(w) || w < 1 || !Number.isInteger(h) || h < 1) {
            throw new Error(
                'lite-cellular: fillCellField2 requires positive integer w and h (got ' +
                String(w) + ', ' + String(h) + ')');
        }
        if (!ArrayBuffer.isView(dst) || typeof dst.BYTES_PER_ELEMENT !== 'number' ||
            typeof dst.length !== 'number') {
            throw new Error(
                'lite-cellular: fillCellField2 requires a typed-array dst (Float64Array or Float32Array)');
        }
        const need = w * h;
        if (dst.length < need) {
            throw new Error(
                'lite-cellular: fillCellField2 dst too small -- length ' + dst.length +
                ' < w*h ' + need + ' (fail closed, no short write)');
        }

        // Guarded reads -- no `opts = {}` (0005). Zero-alloc whether opts is
        // undefined, null, or an object.
        const scale     = opts?.scale     ?? 0.01;
        const combo     = opts?.combo     ?? 'f1';
        const ox        = opts?.ox        ?? 0;
        const oy        = opts?.oy        ?? 0;
        const normalize = opts?.normalize ?? false;
        const periodX   = opts?.periodX;
        const periodY   = opts?.periodY;

        // The jitter override is bounds-validated at SETUP, mirroring the constructor
        // guard (fail closed: NaN, Infinity, out-of-[0,1], null, and non-numbers all
        // throw -- null is not the instance default). Omitted -> the instance's own
        // already-validated jitter, no throw. Off the loop, like combo/dst/w-h.
        let jitter = this._jitter;
        if (opts && opts.jitter !== undefined) {
            jitter = opts.jitter;
            if (typeof jitter !== 'number' || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
                throw new Error(
                    'lite-cellular: jitter must be a finite number in [0, 1] (got ' + String(jitter) + ')');
            }
        }

        // Decode combo ONCE (0005 Decision 2). The loop branches on `sel`, never the
        // string.
        const sel = _COMBO[combo];
        if (sel === undefined) {
            throw new RangeError(
                "lite-cellular: fillCellField2 unknown combo '" + combo +
                "' -- expected 'f1', 'f2-f1' (alias 'cracks'), or 'f2'");
        }

        // Select the kernel ONCE (0005 Decision 3 / 0006): tiling iff a period is
        // given; both periods required + positive integer, else throw (fail closed).
        const tiling = periodX !== undefined || periodY !== undefined;
        if (tiling && (!Number.isInteger(periodX) || periodX < 1 ||
                       !Number.isInteger(periodY) || periodY < 1)) {
            throw new Error(
                'lite-cellular: fillCellField2 tiling requires positive integer periodX and periodY (got ' +
                String(periodX) + ', ' + String(periodY) + ')');
        }

        const seed = this._seed;
        const s = this._out;   // one reused scratch out-struct -- never a per-pixel object
        let idx = 0;

        // Two monomorphic loop variants, chosen once. Neither branches on metric or
        // combo-string per pixel; the only per-pixel work is one kernel call, one
        // `sel` select on two locals, one `dst[idx++]` write.
        if (tiling) {
            const tk = this._tileKernel;
            let py = oy;
            for (let y = 0; y < h; y++) {
                let px = ox;
                for (let x = 0; x < w; x++) {
                    tk(seed, jitter, periodX, periodY, px, py, s);
                    dst[idx++] = sel === 0 ? s.f1 : sel === 1 ? s.f2 - s.f1 : s.f2;
                    px += scale;
                }
                py += scale;
            }
        } else {
            const k = this._kernel;
            let py = oy;
            for (let y = 0; y < h; y++) {
                let px = ox;
                for (let x = 0; x < w; x++) {
                    k(seed, jitter, px, py, s);
                    dst[idx++] = sel === 0 ? s.f1 : sel === 1 ? s.f2 - s.f1 : s.f2;
                    px += scale;
                }
                py += scale;
            }
        }

        // Optional exact-[0,1] remap: two in-place scalar-tracking passes, no temp
        // buffer; a constant field (range 0) maps to all-zero, never a 0/0 divide
        // (0005 Decision 4, identical to lite-noise `_fillField2`).
        if (normalize) {
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < need; i++) {
                const v = dst[i];
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            const range = mx - mn;
            const inv = range > 0 ? 1 / range : 0;
            for (let i = 0; i < need; i++) dst[i] = (dst[i] - mn) * inv;
        }

        return dst;
    }

    /**
     * Sample the 3D field at (x, y, z). Returns `{ f1, f2, id }`: the nearest and
     * second feature-point distances (in this instance's metric) and the F1 owner's
     * cell id -- the 2D shape plus depth. A verbatim lift of `cellular2` to the
     * 3D neighbourhood (0007): chebyshev 3x3x3 = 27 cells, euclid/manhattan 5x5x5 = 125
     * cells (0008), same zero-alloc shape. Instance-only (there is no module 3D surface).
     *
     * `out` is optional; if passed its `f1`/`f2`/`id` are written in place and it is
     * returned, else the instance's OWN reused out-struct is returned. No allocation
     * either way. Throws on non-finite `x`, `y`, or `z`.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {{ f1: number, f2: number, id: number }} [out]
     * @returns {{ f1: number, f2: number, id: number }}
     */
    cellular3(x, y, z, out) {
        return this._kernel3(this._seed, this._jitter, x, y, z, out || this._out);
    }

    /**
     * Sample the EXACTLY-TILEABLE 3D field at (x, y, z) with a tile of `periodX` x
     * `periodY` x `periodZ` CELLS. Identical to `cellular3` except each neighbour's
     * integer cell coordinate is reduced modulo its period before hashing, so the
     * volume is bit-identically periodic on all three axes (`f1`/`f2`/`id` at `x` and
     * `x + periodX` are `===`, not merely close) and seamless by construction. The
     * 0006 wrap lifted to R^3 (0007).
     *
     * `periodX`/`periodY`/`periodZ` are REQUIRED positive integers; `0`, negatives,
     * non-integers, `NaN`, and `Infinity` throw (fail closed -- 0006 Decision 3).
     * Writes into `out` if given (and returns it), else the reused struct. Zero
     * allocation. Throws on non-finite `x`, `y`, or `z`.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} periodX  tile width in cells; positive integer.
     * @param {number} periodY  tile height in cells; positive integer.
     * @param {number} periodZ  tile depth in cells; positive integer.
     * @param {{ f1: number, f2: number, id: number }} [out]
     * @returns {{ f1: number, f2: number, id: number }}
     */
    tileableCell3(x, y, z, periodX, periodY, periodZ, out) {
        if (!Number.isInteger(periodX) || periodX < 1 || !Number.isInteger(periodY) || periodY < 1 ||
            !Number.isInteger(periodZ) || periodZ < 1) {
            throw new Error(
                'lite-cellular: tileableCell3 requires positive integer periodX, periodY and periodZ (got ' +
                String(periodX) + ', ' + String(periodY) + ', ' + String(periodZ) + ')');
        }
        return this._tileKernel3(this._seed, this._jitter, periodX, periodY, periodZ, x, y, z, out || this._out);
    }

    /**
     * Bake a whole `w` x `h` x `d` cellular VOLUME into a caller-owned typed array,
     * row-major with z the outermost axis (`idx = (z*h + y)*w + x`), allocation-free.
     * 0005's baker lifted to 3D (0007). The baker OWNS NOTHING: it validates `dst`
     * and writes `w*h*d` values into it, returning `dst`.
     *
     * `opts` (all optional, guarded so the omitted-opts path allocates nothing):
     *   - `scale`   coord step per voxel on every axis (`px += scale`); default `0.01`.
     *   - `combo`   `'f1'` / `'f2-f1'` (alias `'cracks'`) / `'f2'`; default `'f1'`.
     *               Decoded to a small-int selector ONCE before the loop; unknown throws.
     *   - `jitter`  override the instance jitter for this bake; default the instance's.
     *               Bounds-validated like the constructor -- outside `[0, 1]` throws.
     *   - `ox`,`oy`,`oz` world-space origin; default `0`.
     *   - `normalize` opt-in in-place remap to `[0,1]` (two-pass min/max, no temp
     *               buffer; a constant volume maps to all-zero); default `false`.
     *   - `periodX`,`periodY`,`periodZ` set ALL THREE (positive integers) to bake a
     *               seamless tile (pick `scale = periodX / w`); omit all for a plain
     *               volume. A partial/invalid period throws.
     *
     * Fail closed: `w`/`h`/`d` must be positive integers and `dst` a typed array with
     * `length >= w*h*d`, else throw. Metric bound once (0001), combo a small-int
     * select, one reused scratch struct -- zero allocation once options are read.
     *
     * @param {Float64Array | Float32Array} dst  caller-owned, length `>= w*h*d`.
     * @param {number} w  positive integer width.
     * @param {number} h  positive integer height.
     * @param {number} d  positive integer depth.
     * @param {{ scale?: number, combo?: string, jitter?: number, ox?: number,
     *          oy?: number, oz?: number, normalize?: boolean, periodX?: number,
     *          periodY?: number, periodZ?: number }} [opts]
     * @returns {Float64Array | Float32Array} `dst`.
     */
    fillCellField3(dst, w, h, d, opts) {
        // Fail closed at SETUP, before dst is touched (0005 Decision 1).
        if (!Number.isInteger(w) || w < 1 || !Number.isInteger(h) || h < 1 ||
            !Number.isInteger(d) || d < 1) {
            throw new Error(
                'lite-cellular: fillCellField3 requires positive integer w, h and d (got ' +
                String(w) + ', ' + String(h) + ', ' + String(d) + ')');
        }
        if (!ArrayBuffer.isView(dst) || typeof dst.BYTES_PER_ELEMENT !== 'number' ||
            typeof dst.length !== 'number') {
            throw new Error(
                'lite-cellular: fillCellField3 requires a typed-array dst (Float64Array or Float32Array)');
        }
        const need = w * h * d;
        if (dst.length < need) {
            throw new Error(
                'lite-cellular: fillCellField3 dst too small -- length ' + dst.length +
                ' < w*h*d ' + need + ' (fail closed, no short write)');
        }

        // Guarded reads -- no `opts = {}` (0005). Zero-alloc whether opts is
        // undefined, null, or an object.
        const scale     = opts?.scale     ?? 0.01;
        const combo     = opts?.combo     ?? 'f1';
        const ox        = opts?.ox        ?? 0;
        const oy        = opts?.oy        ?? 0;
        const oz        = opts?.oz        ?? 0;
        const normalize = opts?.normalize ?? false;
        const periodX   = opts?.periodX;
        const periodY   = opts?.periodY;
        const periodZ   = opts?.periodZ;

        // The jitter override is bounds-validated at SETUP, mirroring the constructor
        // guard (fail closed: NaN, Infinity, out-of-[0,1], null, and non-numbers all
        // throw -- null is not the instance default). Omitted -> the instance's own
        // already-validated jitter, no throw. Off the loop, like combo/dst/w-h-d.
        let jitter = this._jitter;
        if (opts && opts.jitter !== undefined) {
            jitter = opts.jitter;
            if (typeof jitter !== 'number' || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
                throw new Error(
                    'lite-cellular: jitter must be a finite number in [0, 1] (got ' + String(jitter) + ')');
            }
        }

        // Decode combo ONCE (0005 Decision 2). The loop branches on `sel`, never the string.
        const sel = _COMBO[combo];
        if (sel === undefined) {
            throw new RangeError(
                "lite-cellular: fillCellField3 unknown combo '" + combo +
                "' -- expected 'f1', 'f2-f1' (alias 'cracks'), or 'f2'");
        }

        // Select the kernel ONCE (0005 Decision 3 / 0006): tiling iff a period is
        // given; ALL THREE periods required + positive integer, else throw.
        const tiling = periodX !== undefined || periodY !== undefined || periodZ !== undefined;
        if (tiling && (!Number.isInteger(periodX) || periodX < 1 ||
                       !Number.isInteger(periodY) || periodY < 1 ||
                       !Number.isInteger(periodZ) || periodZ < 1)) {
            throw new Error(
                'lite-cellular: fillCellField3 tiling requires positive integer periodX, periodY and periodZ (got ' +
                String(periodX) + ', ' + String(periodY) + ', ' + String(periodZ) + ')');
        }

        const seed = this._seed;
        const s = this._out;   // one reused scratch out-struct -- never a per-voxel object
        let idx = 0;

        // Two monomorphic loop variants, chosen once. The only per-voxel work is one
        // kernel call, one `sel` select on two locals, one `dst[idx++]` write.
        if (tiling) {
            const tk = this._tileKernel3;
            let pz = oz;
            for (let zz = 0; zz < d; zz++) {
                let py = oy;
                for (let y = 0; y < h; y++) {
                    let px = ox;
                    for (let x = 0; x < w; x++) {
                        tk(seed, jitter, periodX, periodY, periodZ, px, py, pz, s);
                        dst[idx++] = sel === 0 ? s.f1 : sel === 1 ? s.f2 - s.f1 : s.f2;
                        px += scale;
                    }
                    py += scale;
                }
                pz += scale;
            }
        } else {
            const k = this._kernel3;
            let pz = oz;
            for (let zz = 0; zz < d; zz++) {
                let py = oy;
                for (let y = 0; y < h; y++) {
                    let px = ox;
                    for (let x = 0; x < w; x++) {
                        k(seed, jitter, px, py, pz, s);
                        dst[idx++] = sel === 0 ? s.f1 : sel === 1 ? s.f2 - s.f1 : s.f2;
                        px += scale;
                    }
                    py += scale;
                }
                pz += scale;
            }
        }

        // Optional exact-[0,1] remap: two in-place passes, no temp buffer; a constant
        // volume (range 0) maps to all-zero, never a 0/0 divide (0005 Decision 4).
        if (normalize) {
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < need; i++) {
                const v = dst[i];
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            const range = mx - mn;
            const inv = range > 0 ? 1 / range : 0;
            for (let i = 0; i < need; i++) dst[i] = (dst[i] - mn) * inv;
        }

        return dst;
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
