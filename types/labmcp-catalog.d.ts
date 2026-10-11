// Types for @rhylthyme/timeline/schedule/labmcp-catalog: importing it
// registers the LabMCP instrument catalogue with @rhylthyme/timeline/schedule
// (needed only in browser builds; the Node entry registers it itself).
// The module's value is the catalogue.

import type { LabmcpCatalog } from './schedule';

declare const catalog: LabmcpCatalog;
export = catalog;
