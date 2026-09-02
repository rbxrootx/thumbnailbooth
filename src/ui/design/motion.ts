import type { Transition } from "motion/react";

/**
 * One motion vocabulary for the whole surface. Paper has mass: it settles
 * rather than snapping, and nothing bounces past its resting state.
 */

/** Sheets and panels arriving. */
export const settle: Transition = {
  type: "spring", stiffness: 260, damping: 30, mass: 0.9,
};

/** Small controls, chips, marks. */
export const snap: Transition = {
  type: "spring", stiffness: 520, damping: 34, mass: 0.5,
};

/** Long, exponential ease-out — for anything travelling a distance. */
export const glide: Transition = {
  duration: 0.55, ease: [0.16, 1, 0.3, 1],
};

/** The registration target converging as a render begins. */
export const converge: Transition = {
  duration: 0.9, ease: [0.22, 1, 0.36, 1],
};
