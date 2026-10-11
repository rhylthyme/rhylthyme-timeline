// @rhylthyme/timeline/schedule/labmcp-catalog: registers the LabMCP
// instrument catalogue (about 350 KB) with the schedule validator. Import it
// for its side effect in a browser build that checks LabMCP steps; the Node
// entry of @rhylthyme/timeline/schedule already does. Exports the catalogue.

"use strict";

module.exports = require("./labmcp.js").registerCatalog(require("./labmcp-catalog.json"));
