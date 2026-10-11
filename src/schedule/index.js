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
//
// This is the Node entry: it registers the LabMCP instrument catalogue. The
// browser entry (./browser.js) is the same module without it.

"use strict";

require("./labmcp-catalog.js");

module.exports = require("./browser.js");
