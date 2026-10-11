// Types for @rhylthyme/timeline: the timing engine and the SVG renderer.

import type { Program, Step } from './program';

export * from './program';

/** Where a step sits on the plan, in seconds from the program's start. */
export interface StepTiming {
  start: number;
  end: number;
  duration: number;
  trackId: string;
  /** false when a trigger could not be satisfied (cycle or dangling reference); the step is placed at 0. */
  resolved: boolean;
}

export type Timings = Record<string, StepTiming>;

/** What has really happened, by expanded step id, in seconds from the start. */
export type Actual = Record<string, { start?: number; end?: number }>;

export interface TimingOptions {
  /** Observed starts and ends; the plan is recomputed around them. */
  actual?: Actual;
  /** The current time in seconds from the start; unfinished steps are not planned before it. */
  now?: number;
}

export type PaletteName =
  | 'classic' | 'vivid' | 'muted' | 'tableau' | 'google' | 'pastel' | 'd3' | 'cookbook' | 'okabe-ito' | 'grayscale';

export type LegendItem =
  | 'tracks' | 'tasks' | 'dependency' | 'negative-offset' | 'indefinite' | 'variable' | 'manual'
  | 'barrier' | 'barrier-any' | 'in-flight' | 'planned' | 'late' | 'early' | 'on-time'
  | (string & {});

export interface LegendOptions {
  show?: boolean;
  position?: 'bottom' | 'top' | 'right' | 'none';
  items?: LegendItem[];
  labels?: Record<string, string>;
  title?: string | false;
  columns?: number;
  frame?: boolean;
  onlyUsed?: boolean;
  capacity?: boolean;
  fontSize?: number;
}

export interface RenderOptions {
  style?: 'classic' | 'web' | 'publication';
  palette?: PaletteName | string[];
  colorBy?: 'track' | 'task';
  /** Colours by track id, track name or task. */
  colors?: Record<string, string>;
  legend?: boolean | LegendOptions;
  arrows?: boolean;
  marks?: boolean;
  title?: string | false;
  subtitle?: string | false;
  brand?: boolean;
  background?: string;
  fontFamily?: string;
  /** 0.5 to 3. */
  fontScale?: number;
  /** 0.8 to 1.6: widen text estimates for a rasteriser with a wider face. */
  fontWidthFactor?: number;
  width?: number;
  rowHeight?: number;
  labelWidth?: number;
  timeFormat?: 'clock' | 'minutes';
  /** Label the axis with wall-clock times from this start. */
  startAt?: Date | string;
  /** Seconds between axis ticks. */
  tickInterval?: number;
  axisTitle?: string | false;
  grid?: boolean;
  labelOverflow?: 'truncate' | 'hide' | 'outside';
  showDurations?: boolean;
  tooltips?: boolean;
  /** A run record: draw where steps actually ran, with the plan as ghost bars. */
  run?: unknown;
  /** Precomputed timings to draw instead of computing them. */
  timings?: Timings;
  [option: string]: unknown;
}

export const version: string;
export const supportedSchemaVersions: string[];
export const PALETTES: Record<PaletteName, string[]>;
export const STYLES: string[];

export function computeStepTimings(program: Program, opts?: TimingOptions): Timings;
export function renderTimelineSvg(program: Program, opts?: RenderOptions): string;
/** Sets container.innerHTML to the SVG and returns the markup. */
export function renderTimeline(container: { innerHTML: string } | null, program: Program, opts?: RenderOptions): string;
export function actualFromRun(record: unknown, program?: Program, opts?: { endsOnly?: boolean }): Actual;
export function timingsFromRun(program: Program, record: unknown, opts?: { endsOnly?: boolean; now?: number }): Timings;
/** knownIds: an object keyed by the expanded step ids (a timings object works). */
export function runtimeStepId(entry: { stepId: string; instance?: number }, knownIds?: Record<string, unknown>): string;
export function stepNeedsStart(step: Step): boolean;
export function stepNeedsFinish(step: Step): boolean;
/** A deep copy with track and step replicates expanded into plain tracks and steps. */
export function expandReplicates<P extends Program>(program: P): P;
/** 90, "90", "5m", "1h30m", "-20m" to seconds. */
export function parseSeconds(value: number | string | null | undefined): number;
/** Planning duration: fixed seconds, else the variable default, max or min; indefinite uses defaultSeconds. */
export function stepDurationSeconds(step: Step): number;
/** How long an instrument step without a duration is planned to take. */
export function instrumentEstimate(step: Step): { seconds: number; source: string } | null;
export function textWidth(text: string, size: number, bold?: boolean): number;
