// Types for @rhylthyme/timeline/schedule: the validator and analyzer that
// mcp.rhylthyme.com runs.

import type { Program, Step, Seconds, Alert } from './program';
import type { StepTiming, Timings } from './index';

export type { Program } from './program';

/** One validator finding. `fix` says how to repair the program. */
export interface Finding {
  code: string;
  message: string;
  /**
   * e.g. "step:bake", "track:oven", "resourceConstraints"; for schema_*
   * findings a path such as "tracks[0].steps[1].duration" ("program" for
   * the root); null when program-wide.
   */
  where: string | null;
  fix: string | null;
}

export interface SeverityFinding extends Finding {
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationResult {
  /** true when there are no errors; warnings and info do not count. */
  valid: boolean;
  errors: Finding[];
  warnings: Finding[];
  /** Advisory notes such as I_IMPLICIT_BARRIER. */
  info: Finding[];
  /** null when the program could not be read at all. */
  stats: {
    tracks: number;
    steps: number;
    makespanSeconds: number;
    resourceConstraints: number;
    variableSteps: number;
  } | null;
}

export interface ProjectedAlert {
  event: 'start' | 'end';
  offsetSeconds: number;
  /** Seconds from the program's start. */
  atSeconds: number;
  /** ISO 8601, when the analysis is anchored to a wall clock. */
  at?: string;
  message: string;
  level?: 'notice' | 'alarm';
}

export interface AnalyzedStep {
  stepId: string;
  name: string;
  trackId: string;
  parentTrackId: string | null;
  /** The authored step a replicate instance came from. */
  instanceOf: string | null;
  instanceIndex: number | null;
  task: string | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** "m:ss" or "h:mm:ss" from the start. */
  startClock: string;
  /** ISO 8601, with startAt or finishAt. */
  startAt?: string;
  endAt?: string;
  critical: boolean;
  resolved: boolean;
  alerts?: ProjectedAlert[];
  /** With history: what the program's runs predict for this step. */
  predicted?: unknown;
  [field: string]: unknown;
}

export interface AnalyzedTrack {
  trackId: string;
  name: string;
  parentTrackId: string | null;
  startSeconds: number;
  endSeconds: number;
  busySeconds: number;
  idleSeconds: number;
  /** How long before the program's end this track finishes. */
  slackBeforeFinishSeconds: number;
  steps: number;
}

export interface ResourceConflict {
  kind: 'maxConcurrent' | (string & {});
  task: string;
  maxConcurrent: number;
  demand: number;
  startSeconds: number;
  endSeconds: number;
  steps: string[];
  fix: string;
}

export interface BindingConstraint {
  from: string;
  to: string;
  kind: 'dependency' | 'maxConcurrent' | 'offset' | (string & {});
  task: string | null;
  limit: number | null;
}

export interface Analysis {
  programId: string | null;
  name: string | null;
  makespanSeconds: number;
  /** e.g. "1h 14m". */
  makespan: string;
  tracks: AnalyzedTrack[];
  steps: AnalyzedStep[];
  /** Step ids, first to last. */
  criticalPath: string[];
  bindingConstraints: BindingConstraint[];
  resourceConflicts: ResourceConflict[];
  inFlight: unknown[];
  actorPeak: { concurrentSteps: number; atSeconds: number; declaredActors: number | null };
  /** null unless startAt or finishAt is given. */
  wallClock: { startAt: string; finishAt: string; anchoredBy: 'startAt' | 'finishAt' } | null;
  /** With history. */
  predictedMakespanSeconds?: number;
  predictedMakespan?: string;
  predictedCriticalPath?: string[];
  predictedSteps?: unknown;
  [field: string]: unknown;
}

export interface AnalyzeOptions {
  /** ISO 8601: everything ends then; start times are worked backwards. */
  finishAt?: string;
  /** ISO 8601 start. Ignored with finishAt. */
  startAt?: string;
  /** Run records (rhylthyme-spec's runs schema) of this program. */
  history?: unknown[];
  predictionContext?: Record<string, unknown>;
  /** "planned" (default) analyses the program as written; "predicted" uses the history's durations. */
  useDurations?: 'planned' | 'predicted';
}

export function validateProgram(program: Program): ValidationResult;
export function analyzeSchedule(program: Program, opts?: AnalyzeOptions): Analysis;
/** Markdown summaries, as the MCP tools return them. */
export function formatValidation(result: ValidationResult): string;
export function formatAnalysis(analysis: Analysis): string;

/** One JSON Schema failure from checkJsonSchema. */
export interface SchemaError {
  /** The keyword that failed: "required", "type", "oneOf", "additionalProperties", ... */
  keyword: string;
  /** Keys and array indexes from the root to the failing value; [] is the root. */
  path: Array<string | number>;
  message: string;
  fix: string;
}

/**
 * The program checked against the bundled rhylthyme-spec schema its
 * schemaVersion selects (0.3.x: 0.3.0-alpha, otherwise 0.2.0-alpha), with
 * time strings read as seconds first, as the Python validator does. Each
 * failure is a finding with code `schema_<keyword>`. validateProgram
 * includes these in `errors`.
 */
export function schemaFindings(program: Program): Finding[];
/** The bundled program schema (Draft 7 JSON) that a schemaVersion selects. */
export function programSchema(schemaVersion?: string | null): Record<string, unknown>;
/**
 * Check a value against a Draft 7 schema that uses only the keywords the
 * program schemas use (type, enum, const, required, properties,
 * additionalProperties, items, min/maxItems, min/maxLength, pattern,
 * minimum, maximum, exclusiveMinimum/Maximum, oneOf, anyOf, allOf, not,
 * if/then/else, local $ref; format is ignored). [] means valid.
 */
export function checkJsonSchema(value: unknown, schema: Record<string, unknown> | boolean): SchemaError[];

/** Schema 0.3.0-alpha `instances` / `replicates` checks on the unexpanded program. */
export function instanceFindings(program: Program): SeverityFinding[];
export function alertFindings(program: Program): SeverityFinding[];
/** An alert offset in seconds (negative is before the event); 0 when absent, null when it cannot be read. */
export function parseAlertOffset(value: Seconds | null | undefined): number | null;
export function alertDefaultMessage(event: Alert['event'], offsetSeconds: number): string;
export function projectedAlerts(step: Step, timing: StepTiming): ProjectedAlert[];
/** A copy of the program with the given durations, by step id. */
export function withDurations(program: Program, secondsByStep: Record<string, number>): Program;
export function predictDurations(program: Program, records: unknown[], opts?: Record<string, unknown>): Record<string, unknown>;
export function predictedSeconds(predictions: Record<string, unknown>): Record<string, number>;
export function inFlightGroups(program: Program): unknown[];
export function inFlightWindows(program: Program, timings: Timings): unknown[];
export function inFlightConflicts(program: Program, timings: Timings): unknown[];

export { expandReplicates, parseSeconds, stepDurationSeconds, computeStepTimings } from './index';

/** galago-tools instrument commands. */
export const galago: {
  validateCommand(...args: unknown[]): unknown;
  instrumentFindings(program: Program): SeverityFinding[];
  instrumentCalls(...args: unknown[]): unknown;
  blockingCall(instrument: unknown): unknown;
  TOOL_TYPES: unknown;
  CATALOG: unknown;
  [member: string]: unknown;
};

/** LabMCP instrument servers. */
export const labmcp: {
  instrumentFindings(program: Program): SeverityFinding[];
  /** A copy of the program with planned durations for LabMCP steps that have none. */
  withEstimates<P extends Program>(program: P): P;
  stepEstimate(step: Step): { seconds: number; source: string } | null;
  CATALOG: unknown;
  [member: string]: unknown;
};

/** Run history: which runs are usable, and duration prediction. */
export const history: {
  predictDurations: typeof predictDurations;
  predictedSeconds: typeof predictedSeconds;
  [member: string]: unknown;
};
