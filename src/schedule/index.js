// @rhylthyme/timeline/schedule: the program validator and schedule analyzer
// that mcp.rhylthyme.com runs, as a library. Pure and dependency-free: no
// network, no filesystem, no clock reads unless you pass a time.
//
//   validateProgram(program)        -> { valid, errors, warnings, info, stats }
//   analyzeSchedule(program, opts?) -> { makespanSeconds, steps, tracks,
//                                        criticalPath, resourceConflicts, ... }
//
// The instrument helpers (galago-tools commands, LabMCP servers) and the
// run-history predictor the analyzer uses are exported as namespaces.

"use strict";

const Schedule = require("./schedule.js");

module.exports = Object.assign({}, Schedule, {
  galago: require("./galago.js"),
  labmcp: require("./labmcp.js"),
  history: require("./history.js"),
});
