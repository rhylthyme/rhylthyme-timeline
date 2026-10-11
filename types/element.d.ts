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
  'rt-factors': CustomEvent<{ factors: Record<string, unknown>; skipped: boolean; source: string }>;
}

export interface RhylthymeTimelineElement extends HTMLElement {
  program: Program | null;
  readonly currentTime: number;
  readonly status: 'stopped' | 'running' | 'paused' | 'completed';
  readonly timings: Timings;
  readonly stepStates: Record<string, StepState>;
  start(): void;
  pause(): void;
  stop(): void;
  toggle(): void;
  /** While paused. */
  seek(seconds: number): void;
  startStep(stepId: string): boolean;
  completeStep(stepId: string): boolean;
  tick(): void;
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
