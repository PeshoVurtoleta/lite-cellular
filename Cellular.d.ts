/**
 * @zakkster/lite-cellular v1.0.0 -- hand-written types (no drift).
 *
 * v1.0.0 (C1) opens the three distance metrics (euclidean/manhattan/chebyshev),
 * fixed at instance creation via an integer id, and adds the module free-function
 * surface (`cellular2`, `seedCellular`). The field baker + exact tileable wrap
 * land in v1.1.0 (C2); `cellular3` in v1.2.0 (C3).
 *
 * @license MIT
 */

/** Package version. Kept in lockstep with package.json (two-place sync). */
export const VERSION: string;

/**
 * The euclidean (L2) metric id -- the default. Returns TRUE distance (squared in
 * the loop, one sqrt each for f1/f2 at the end). See `decisions/0001`.
 */
export const METRIC_EUCLIDEAN: 0;

/**
 * The manhattan (L1) metric id: distance = `|dx| + |dy|`, no sqrt. Linear units,
 * so the cross-metric law and `f2 - f1` stay coherent. See `decisions/0001`.
 */
export const METRIC_MANHATTAN: 1;

/**
 * The chebyshev (Linf) metric id: distance = `max(|dx|, |dy|)`, no sqrt. Linear
 * units. Satisfies `chebyshev <= euclidean <= manhattan` pointwise. See
 * `decisions/0001`.
 */
export const METRIC_CHEBYSHEV: 2;

/** The per-query result: the two nearest feature-point distances and the F1 owner id. */
export interface CellularResult {
    /** Distance to the nearest feature point, in this instance's metric. */
    f1: number;
    /** Distance to the second-nearest feature point, same metric; f1 <= f2. */
    f2: number;
    /**
     * The F1 owner cell's hash, signed int32 (SMI-safe, `| 0` not `>>> 0`).
     * Opaque, stable per Voronoi region; the owner is metric-dependent. See
     * `decisions/0004`.
     */
    id: number;
}

/** Construction options. metric and jitter are fixed at creation and immutable. */
export interface CellularOptions {
    /**
     * Distance metric id: 0 (euclidean, default), 1 (manhattan), or 2 (chebyshev).
     * Anything else throws at construction (fail-closed). See `decisions/0001`.
     */
    metric?: number;
    /**
     * Feature-point scatter in [0, 1]: 0 = exact grid of centres, 1 = full Worley.
     * `jitter <= 1` is the correctness precondition of the 3x3 scan (keeps every
     * feature point inside its home cell). Default 1. See `decisions/0003`.
     */
    jitter?: number;
}

/**
 * A cellular (Worley) noise field owning one reused out-struct. Construct via
 * `createCellular`. The metric and jitter are immutable for the instance's life.
 */
export declare class Cellular {
    constructor(seed?: number, opts?: CellularOptions);

    /**
     * Sample the field at (x, y). Writes into `out` if given (and returns it),
     * otherwise returns the instance's reused out-struct. Zero allocation.
     * Throws on non-finite `x` or `y`.
     */
    cellular2(x: number, y: number, out?: CellularResult): CellularResult;

    /** Re-seed this instance in place. Returns `this`. Setup cost only. */
    reseed(seed: number): this;
}

/** Create an independent cellular noise instance. Throws on a bad metric id or jitter. */
export declare function createCellular(seed?: number, opts?: CellularOptions): Cellular;

/**
 * Module free surface: sample the shared module field at (x, y). Deliberately
 * EUCLIDEAN with jitter = 1 on the shared module seed -- the zero-config
 * convenience. Metric and jitter control require an instance (`createCellular`).
 * Writes into `out` if given (and returns it), else the shared module out-struct.
 * Zero allocation. Throws on non-finite `x` or `y`. See `decisions/0003`.
 */
export declare function cellular2(x: number, y: number, out?: CellularResult): CellularResult;

/**
 * Re-seed the shared module field. Setup cost only. Auto-seeded with 0 on load.
 * Mutates one shared module-scoped seed -- every module-level consumer sees the
 * change (the last caller wins). Warns once in dev builds when called more than
 * once; silent when `NODE_ENV === 'production'`. For independent fields, give each
 * its own `createCellular(seed)`. See `decisions/0003`.
 */
export declare function seedCellular(seed?: number): void;
