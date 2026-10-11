// Types for @rhylthyme/timeline/element: the <rhylthyme-timeline> player.
/// <reference lib="dom" />

import type { Program, Timings } from './index';

export type StepState = 'pending' | 'waiting' | 'active' | 'done';

/** Who began a step: a person (`startStep()`) or the plan (its own trigger). */
export type StepBeganBy = 'person' | 'plan';
/**
 * Who ended a step, from the run record's `endedBy`: `person` (completeStep(),
 * endedBy "executor"), `timer` (a fixed duration or a variable step's maxSeconds),
 * `trigger` (capped by a negative-offset hand-off), `abort` (stop() while it ran).
 *
 * `dropped`: the run was dropped while the step ran — the program was replaced
 * (`program` property or `src`) or the element was removed from the document for
 * good (re-inserted synchronously, with no `await` in between, it was moved and
 * keeps its run). Only a run under way is dropped; an idle element fires nothing.
 * Each step still running ends `dropped` at `currentTime` (or at its own begin if
 * that is later, after a backward seek), in program order, then the `abandoned`
 * run record follows and nothing else fires for that run, so every began has its
 * ended. The dropped run is inert: start(), pause(), seek() do nothing and
 * startStep()/completeStep() return false until stop() (only rt-stop) or a new
 * program. It is not `abort`: nobody stopped the work, and the
 * run record still leaves the step open (no end, no endedBy). A framework
 * re-render that swaps the program produces these; filter `by !== 'dropped'` to
 * see only real ends.
 */
export type StepEndedBy = 'person' | 'timer' | 'trigger' | 'abort' | 'dropped';
/** detail of rt-step-began / rt-step-ended: `time` is the transition's own second on the program clock. */
export interface StepTransitionDetail<By extends string> {
  stepId: string;
  time: number;
  by: By;
}

/** detail of rt-seek: the program-clock seconds before and after the seek. */
export interface SeekDetail {
  from: number;
  to: number;
}

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
  /** Every step (replicate instances included) began, once per run, in time order. */
  'rt-step-began': CustomEvent<StepTransitionDetail<StepBeganBy>>;
  /**
   * Every step ended, once per run, in time order (stop() ends running steps with
   * `abort`, a dropped run with `dropped`). A handler that calls stop() takes effect
   * after the current batch: the rest of the batch, then the `abort` ends, then rt-stop.
   */
  'rt-step-ended': CustomEvent<StepTransitionDetail<StepEndedBy>>;
  /**
   * seek() changed the time; fired once per such seek, after the step transitions a
   * forward seek fires. A seek() from a handler queues behind the outer seek's
   * rt-seek, so these arrive in call order and each `from` is the previous `to`. A backward seek fires no step events (each step fires at most
   * once per run), so a host that mirrors the playhead resyncs from `stepStates` here;
   * a record-keeping host can ignore it.
   */
  'rt-seek': CustomEvent<SeekDetail>;
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
  /** One playback-speed option, e.g. `2` -> "2×"; `formatted` is the factor in the `locale` (else as is). */
  speedOption: LabelFn<[factor: number, formatted: string]>;
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
  /**
   * The empty state. In a template, `{0}` and `{1}` are drawn as
   * `<code>program</code>` and `<code>src</code>`; a function receives
   * `'program'` and `'src'` and its text is shown escaped, without markup.
   */
  noProgram: LabelFn<[property: 'program', attribute: 'src']>;
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
  /**
   * The chart's subtitle, "5 tracks · 3h55 total". `total` is the compact
   * duration; `totalSeconds` the same in seconds, to format it yourself.
   */
  chartSubtitle: LabelFn<[tracks: number, total: string, totalSeconds: number]>;
  /**
   * Legend terms. Overriding any of them draws the renderer's configurable
   * legend (the step kinds the program uses) instead of the fixed key.
   */
  legendDependency: LabelText;
  legendNegativeOffset: LabelText;
  legendIndefinite: LabelText;
  legendVariable: LabelText;
  legendManual: LabelText;
  legendBarrier: LabelText;
  legendBarrierAny: LabelText;
  legendInFlight: LabelText;
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
   *
   * The `labels` attribute takes the same table as JSON (strings only, with
   * `{0}`, `{1}`... for arguments): `labels='{"stop":"Arrêter"}'`. As with
   * `factors` / `data-factors`, whichever of the attribute and the property
   * was set last supplies the whole table and the getter reports it; setting
   * the property does not rewrite the attribute. An attribute that is not a
   * JSON object is ignored with a console warning (the labels in effect
   * stay); removing the attribute clears the labels it supplied. Writing the
   * attribute again with its current value counts as setting it. A property
   * set before the element was defined wins over an attribute that was also
   * present when it upgraded.
   */
  get labels(): RhylthymeTimelineLabels;
  set labels(value: Partial<RhylthymeTimelineLabels> | null);
  /** Reflect the attributes of the same names. */
  mode: 'player' | 'static';
  speed: number;
  timeFormat: 'minutes' | 'seconds' | 'hours' | 'clock' | (string & {});
  startAt: Date | null;
  /**
   * Reflects the `locale` attribute. Set (a BCP 47 tag, or `''`/`'auto'` for
   * the browser's), the clock, durations and speed options are formatted
   * with Intl; null (the default) keeps the fixed formats.
   */
  locale: string | null;
  /** The clock text for a program time in seconds, in `timeFormat` (and `locale`). */
  formatTime(seconds: number): string;
  start(): void;
  pause(): void;
  stop(): void;
  toggle(): void;
  /** While paused (ignored while running, and on a dropped run). Fires rt-seek when the time changes. */
  seek(seconds: number): void;
  /** false when the step is unknown or already started, or the run was dropped. */
  startStep(stepId: string): boolean;
  /** false when the step is unknown, already done, under its minSeconds, or the run was dropped. */
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
