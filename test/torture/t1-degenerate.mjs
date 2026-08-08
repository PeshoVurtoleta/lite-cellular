/**
 * T1 -- degenerate query values. RESERVED for C1.
 *
 * C1 fills this: cross every query with 0, -0, +Inf, -Inf, NaN, subnormals,
 * f32 max, and the integer boundary pair 16777216/16777217, pinning the actual
 * answer (including "this throws" for non-finite coords). Registered now as a
 * no-op so the tier list is stable and later sessions extend one command.
 *
 * @license MIT
 */

export function run() {}
