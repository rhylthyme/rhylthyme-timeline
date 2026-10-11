// The shape of a Rhylthyme program, hand-written from rhylthyme-spec's
// program schema 0.3.0-alpha (which also accepts 0.1.0 and 0.2.0-alpha
// programs). The JSON Schema is the authority; these types are for editors.

/** Seconds as a number, or a time string such as "90", "5m", "1h30m" or "-20m". */
export type Seconds = number | string;

export interface Program {
  schemaVersion?: '0.1.0' | '0.2.0-alpha' | '0.3.0-alpha' | (string & {});
  programId?: string;
  name?: string;
  description?: string;
  version?: string;
  /** An environment id whose resource constraints apply. */
  environment?: string;
  environmentType?: string;
  /** How many people are available; limits steps that need attention at once. */
  actors?: number;
  tracks: Track[];
  resourceConstraints?: ResourceConstraint[];
  trackTemplates?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface Track {
  trackId: string;
  name: string;
  description?: string;
  steps: Step[];
  replicates?: Replicates;
  /** Legacy batching, expanded like `replicates`. */
  batch_size?: number;
  stagger?: Seconds;
  stagger_seconds?: number;
  templateId?: string;
  templateParameters?: Record<string, unknown>;
  priority?: number;
}

export interface Step {
  stepId: string;
  name: string;
  description?: string;
  startTrigger: StartTrigger;
  duration?: Duration;
  /** The resource constraint this step occupies. */
  task?: string;
  tasks?: string[];
  taskResources?: { name: string; fraction: number }[];
  priority?: number;
  flex?: Record<string, unknown>;
  preBuffer?: Record<string, unknown>;
  postBuffer?: Record<string, unknown>;
  alerts?: Alert[];
  choice?: Choice;
  canAbort?: boolean;
  replicates?: Replicates;
  instrument?: Instrument;
  codeBlock?: unknown;
  metadata?: Record<string, unknown>;
}

export type Duration =
  | { type: 'fixed'; seconds: Seconds; calibratedFrom?: unknown }
  | {
      type: 'variable';
      minSeconds: Seconds;
      maxSeconds: Seconds;
      defaultSeconds?: Seconds;
      optimalSeconds?: Seconds;
      /** A person ends the step (after minSeconds); it ends itself at maxSeconds. */
      triggerName?: string;
      calibratedFrom?: unknown;
    }
  | {
      /** Runs until a person ends it; planned at defaultSeconds. */
      type: 'indefinite';
      defaultSeconds: Seconds;
      triggerName?: string;
      calibratedFrom?: unknown;
    };

export type Instances = 'each' | 'all' | 'any';

export type SingleStartTrigger =
  | { type: 'programStart'; offsetSeconds?: Seconds }
  | { type: 'programStartOffset'; offsetSeconds: Seconds }
  | {
      type: 'afterStep';
      stepId: string;
      event?: 'start' | 'end';
      offsetSeconds?: Seconds;
      /** Only when this option of the referenced step's `choice` is taken. */
      choiceId?: string;
      instances?: Instances;
    }
  | {
      type: 'afterStepWithBuffer';
      stepId: string;
      bufferSeconds: Seconds;
      event?: 'start' | 'end';
      offsetSeconds?: Seconds;
      instances?: Instances;
    }
  | { type: 'manual'; triggerName?: string }
  | { type: 'onAbort'; stepId: string };

export type StartTrigger =
  | SingleStartTrigger
  | { logic: 'all' | 'any'; triggers: SingleStartTrigger[] };

export interface ResourceConstraint {
  task: string;
  maxConcurrent: number;
  description?: string;
}

export interface Replicates {
  count: number;
  mode?: 'parallel' | 'stagger' | 'serial';
  delay?: Seconds;
  /** At most this many instances in flight at once (schema 0.3.0-alpha). */
  maxInFlight?: number;
}

export interface Alert {
  event: 'start' | 'end';
  /** Relative to the event; negative is before it. */
  offsetSeconds?: Seconds;
  message?: string;
  level?: 'notice' | 'alarm';
}

export interface Choice {
  prompt?: string;
  /** The first option is the default. */
  options: { choiceId: string; label: string }[];
}

export interface Instrument {
  tool: string;
  command?: string;
  params?: Record<string, unknown>;
  toolType?: string;
  timeoutSeconds?: number;
  start?: unknown[];
  until?: unknown;
  end?: unknown[];
  onAbort?: unknown[];
}
