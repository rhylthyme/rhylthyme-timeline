// Types for @rhylthyme/timeline/element: the <rhylthyme-timeline> player.
/// <reference lib="dom" />

import type { Program, Timings } from './index';

export type StepState = 'pending' | 'waiting' | 'active' | 'done';

export interface RhylthymeTimelineEventMap {
  'rt-load': CustomEvent<{ program: Program }>;
  'rt-start': CustomEvent<{ time: number }>;
  'rt-pause': CustomEvent<{ time: number }>;
  'rt-tick': CustomEvent<{ time: number }>;
  'rt-stop': CustomEvent<{}>;
  /** A person started a step that waits for them (a manual gate or a negative-offset hand-off). */
  'rt-step-start': CustomEvent<{ stepId: string; time: number }>;
  /** A step that waits for a person was finished, or a variable step reached its maximum (automatic). */
  'rt-step-complete': CustomEvent<{ stepId: string; time: number; automatic: boolean }>;
  'rt-complete': CustomEvent<{ time: number }>;
  'rt-run-record': CustomEvent<{ record: unknown; outcome: 'completed' | 'aborted' | 'abandoned' }>;
  /** The variance-factor answers; `skipped` lists the declared keys left unanswered. */
  'rt-factors': CustomEvent<{ factors: Record<string, unknown>; skipped: string[]; source: 'prompt' | 'property' | 'attribute' }>;
}

export interface RhylthymeTimelineElement extends HTMLElement {
  program: Program | null;
  readonly currentTime: number;
  readonly status: 'stopped' | 'running' | 'paused' | 'completed';
  readonly timings: Timings;
  readonly stepStates: Record<string, StepState>;
  /** Steps grouped for display (replicate instances, barriers). */
  readonly groups: unknown;
  /** The program's metadata.varianceFactors, normalised; [] when none. */
  readonly declaredFactors: { key: string; type?: string; [field: string]: unknown }[];
  /** From metadata.offsetsUse. */
  readonly offsetsUse: 'planned' | 'predicted';
  /** Steps whose negative offset is resolved against a predicted anchor end, in seconds. */
  readonly predictedAnchors: Record<string, number>;
  /** The last finished run's record (runs schema), a live snapshot during a run, or null. */
  readonly runRecord: unknown;
  /** Answers to the declared variance factors; setting it skips the factor form. */
  factors: Record<string, unknown>;
  /** History-based duration predictions, as analyze_schedule returns them. */
  predictions: Record<string, { seconds: number; low?: number; high?: number; basis?: string }>;
  /** Reflect the attributes of the same names. */
  mode: 'player' | 'static';
  speed: number;
  timeFormat: 'minutes' | 'seconds' | 'hours' | 'clock' | (string & {});
  startAt: Date | null;
  start(): void;
  pause(): void;
  stop(): void;
  toggle(): void;
  /** While paused. */
  seek(seconds: number): void;
  startStep(stepId: string): boolean;
  completeStep(stepId: string): boolean;
  tick(): void;
  /** Open the variance-factor form; false when the program declares no factors. */
  askFactors(): boolean;
  /** Re-sync after the page was suspended (called on visibilitychange). */
  reconcileClock(): void;
  /** Replace the millisecond clock (and optionally the wall clock used for pauses); for tests. */
  setClock(clock: () => number, wallClock?: () => number): void;
  addEventListener<K extends keyof RhylthymeTimelineEventMap>(
    type: K, listener: (this: RhylthymeTimelineElement, ev: RhylthymeTimelineEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof RhylthymeTimelineEventMap>(
    type: K, listener: (this: RhylthymeTimelineElement, ev: RhylthymeTimelineEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'rhylthyme-timeline': RhylthymeTimelineElement;
  }
}
