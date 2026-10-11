// @rhylthyme/timeline/schedule without the LabMCP instrument catalogue: the
// entry for browsers (the "browser" export condition) and browser/schedule.js.
// Everything works as in src/schedule/index.js except LabMCP instrument
// steps, which get an instrument_catalog_not_loaded warning until the
// catalogue is registered:
//
//   import '@rhylthyme/timeline/schedule/labmcp-catalog';          // eagerly
//   await import('@rhylthyme/timeline/schedule/labmcp-catalog');   // lazily
//
// Programs without LabMCP steps never need it.

"use strict";

const Schedule = require("./schedule.js");

module.exports = Object.assign({}, Schedule, {
  galago: require("./galago.js"),
  labmcp: require("./labmcp.js"),
  history: require("./history.js"),
});
