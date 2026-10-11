// The CommonJS side: require() returns the functions by name, no .default.
import Rhylthyme = require('@rhylthyme/timeline');
import Schedule = require('@rhylthyme/timeline/schedule');
import LabmcpCatalog = require('@rhylthyme/timeline/schedule/labmcp-catalog');

export const svg: string = Rhylthyme.renderTimelineSvg({ tracks: [] });
export const steps: number = Rhylthyme.itinerary({ tracks: [] }).length;
export const ok: boolean = Schedule.validateProgram({ tracks: [] }).valid;
export const catalog: Schedule.LabmcpCatalog = Schedule.labmcp.registerCatalog(LabmcpCatalog);
// @ts-expect-error there is no default export under require()
export const nope = Rhylthyme.default;
