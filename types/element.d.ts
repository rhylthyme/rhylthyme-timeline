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

/** A message: fixed text, or text with `{0}`, `{1}`... standing for the arguments. */
type LabelText = string;
/** A message with arguments: a template string (`'Démarrer : {0}'`) or a function. */
type LabelFn<A extends unknown[]> = string | ((...args: A) => string);

/**
 * Every user-visible string of the player, keyed. Set a partial object as
 * `el.labels` to translate; keys left out stay English. Glyphs (▶ ❚❚ ■ ✓) are
 * not part of the text: they are drawn beside it with aria-hidden, and each
 * button's aria-label is the text alone. Text is escaped, never parsed as HTML.
 */
export interface RhylthymeTimelineLabels {
  start: LabelText;
  pause: LabelText;
  resume: LabelText;
  stop: LabelText;
  speed: LabelText;
  /** One playback-speed option, e.g. `2` -> "2×". */
  speedOption: LabelFn<[factor: number]>;
  statusStopped: LabelText;
  statusRunning: LabelText;
  statusPaused: LabelText;
  statusCompleted: LabelText;
  /** The button on a step that waits for a person: "Start: <name>". */
  startStep: LabelFn<[name: string]>;
  /** The button on a step that runs until marked done: "Done: <name>". */
  doneStep: LabelFn<[name: string]>;
  /** A replicate instance's suffix: "[2 of 3]"; `count` may be "?". */
  instance: LabelFn<[index: number, count: number | string]>;
  /** A replicate group's heading: "Bake tray ×3 — 1 done". */
  groupProgress: LabelFn<[name: string, count: number, done: number]>;
  actionsHint: LabelText;
  loading: LabelText;
  /** The empty state; the arguments are drawn as `<code>program</code>` and `<code>src</code>`. */
  noProgram: LabelFn<[property: string, attribute: string]>;
  loadError: LabelFn<[url: string, message: string]>;
  factorsTitle: LabelText;
  factorsHint: LabelText;
  /** The empty option of an enum factor's picker. */
  factorSkip: LabelText;
  factorsStart: LabelText;
  factorNotNumber: LabelFn<[text: string]>;
  factorNotInteger: LabelFn<[text: string]>;
  /** `values` is the allowed values joined with ", ". */
  factorNotOneOf: LabelFn<[text: string, values: string]>;
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
  /**
   * Translations: a partial table merged over the English defaults (null
   * clears it). Reading it returns the whole table in effect.
   */
  get labels(): RhylthymeTimelineLabels;
  set labels(value: Partial<RhylthymeTimelineLabels> | null);
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
