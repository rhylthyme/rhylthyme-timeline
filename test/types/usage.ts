// Compiled with `tsc --noEmit` in CI: the published types must accept real use.
import Rhylthyme, { computeStepTimings, itinerary, renderTimelineSvg, type ItineraryEntry, type Program, type StepTiming } from '@rhylthyme/timeline';
import Schedule, { validateProgram, analyzeSchedule, itinerary as scheduleItinerary, labmcp, schemaFindings, programSchema, checkJsonSchema, findingCodes, type Finding, type Analysis, type SchemaError, type FindingCode, type FindingSeverity } from '@rhylthyme/timeline/schedule';

const program: Program = {
  schemaVersion: '0.3.0-alpha',
  programId: 'tea',
  name: 'Tea',
  tracks: [{
    trackId: 'tea', name: 'Tea', steps: [
      { stepId: 'boil', name: 'Boil', startTrigger: { type: 'programStart' }, duration: { type: 'fixed', seconds: '3m' }, task: 'kettle' },
      { stepId: 'steep', name: 'Steep', startTrigger: { type: 'afterStep', stepId: 'boil', offsetSeconds: -30 },
        duration: { type: 'variable', minSeconds: 120, maxSeconds: 300 }, alerts: [{ event: 'end', offsetSeconds: '-1m' }] },
      { stepId: 'serve', name: 'Serve', startTrigger: { logic: 'all', triggers: [{ type: 'afterStep', stepId: 'steep' }, { type: 'manual' }] },
        duration: { type: 'indefinite', defaultSeconds: 60 } },
    ],
  }],
  resourceConstraints: [{ task: 'kettle', maxConcurrent: 1 }],
};

const t: StepTiming = computeStepTimings(program, { now: 30 })['boil'];
const plan: ItineraryEntry[] = itinerary(program, { finishAt: '2026-11-26T18:00:00Z', now: 0 });
const firstAt: string | undefined = plan[0]?.startAt;
const of: string | null = Rhylthyme.itinerary(program, { startAt: new Date() })[0]?.instanceOf ?? null;
const estimated: ItineraryEntry[] = scheduleItinerary(program, { startAt: 0 });
const svg: string = renderTimelineSvg(program, { style: 'web', palette: 'vivid', legend: { position: 'right', items: ['tracks', 'manual'] } });
const same: string = Rhylthyme.renderTimelineSvg(program);

const v = validateProgram(program);
const first: Finding | undefined = v.errors[0];
const a: Analysis = analyzeSchedule(labmcp.withEstimates(program), { finishAt: '2026-11-26T18:00:00Z' });
const wall: string | undefined = analyzeSchedule(program).wallClock?.startAt;
const off: number | null = Schedule.parseAlertOffset('-5m');
const grey: string = renderTimelineSvg(program, { palette: 'grayscale' });
const conflicts: number = a.resourceConflicts.length + Schedule.analyzeSchedule(program).criticalPath.length;
const schemaCodes: string[] = schemaFindings(program).map((f: Finding) => f.code);
const schemaErrors: SchemaError[] = checkJsonSchema({ maxConcurrent: '2' }, programSchema(program.schemaVersion));
const errorPath: Array<string | number> | undefined = schemaErrors[0]?.path;
const v02 = Schedule.programSchema();
// The finding-code catalogue: look up what a finding means and how to fix it.
const about: FindingCode | undefined = first ? findingCodes.codes[first.code] : undefined;
const severities: FindingSeverity[] = findingCodes.codes['track_overlap'].severity;
const pyCode: string | null = Schedule.findingCodes.codes['schema_required'].python.cli;
const areaTitle: string = findingCodes.areas[findingCodes.codes['dangling_step_ref'].area].title;
export const out = [firstAt, of, plan.length, estimated.length, wall, off, grey, t.end, svg.length, same.length, v.valid, first?.fix, a.wallClock?.startAt, conflicts,
  schemaCodes, errorPath, schemaErrors[0]?.keyword, v02, about?.fix, severities, pyCode, areaTitle];

// @ts-expect-error a step needs a startTrigger
const bad: Program = { tracks: [{ trackId: 'x', name: 'x', steps: [{ stepId: 's', name: 's' }] }] };
export { bad };
