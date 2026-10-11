// The CommonJS side: require() returns the functions by name, no .default.
import Rhylthyme = require('@rhylthyme/timeline');
import Schedule = require('@rhylthyme/timeline/schedule');

export const svg: string = Rhylthyme.renderTimelineSvg({ tracks: [] });
export const ok: boolean = Schedule.validateProgram({ tracks: [] }).valid;
export const schemaOk: boolean = Schedule.schemaFindings({ tracks: [] }).length === 0;
// @ts-expect-error there is no default export under require()
export const nope = Rhylthyme.default;
