/**
 * @zakkster/lite-cellular v0.1.0 -- hand-written types (no drift).
 *
 * v0.1.0 (C0) ships the euclidean, instance-only skeleton. manhattan/chebyshev
 * and the module free-function surface land in v1.0.0.
 *
 * @license MIT
 */

/** Package version. Kept in lockstep with package.json (two-place sync). */
export const VERSION: string;

/** The euclidean metric id (the default, and the only id accepted in v0.1.0). */
export const METRIC_EUCLIDEAN: 0;

/** The per-query result: the two nearest feature-point distances and the F1 owner id. */
export interface CellularResult {
    /** Distance to the nearest feature point (true euclidean). */
    f1: number;
    /** Distance to the second-nearest feature point (true euclidean); f1 <= f2. */
    f2: number;
    /** The F1 owner cell's hash, signed int32 (SMI-safe). Opaque, stable per region. */
    id: number;
}

/** Construction options. metric and jitter are fixed at creation and immutable. */
export interface CellularOptions {
    /** Distance metric id. v0.1.0 accepts only METRIC_EUCLIDEAN (0). Default 0. */
    metric?: number;
    /** Feature-point scatter in [0, 1]: 0 = exact grid of centres, 1 = full Worley. Default 1. */
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
