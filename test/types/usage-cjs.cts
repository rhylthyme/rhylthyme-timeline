// The CommonJS side: require() returns the functions by name, no .default.
import Rhylthyme = require('@rhylthyme/timeline');
import Schedule = require('@rhylthyme/timeline/schedule');

export const svg: string = Rhylthyme.renderTimelineSvg({ tracks: [] });
export const steps: number = Rhylthyme.itinerary({ tracks: [] }).length;
export const ok: boolean = Schedule.validateProgram({ tracks: [] }).valid;
// @ts-expect-error there is no default export under require()
export const nope = Rhylthyme.default;
