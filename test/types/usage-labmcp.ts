// The LabMCP catalogue: registered by the Node entry, loaded on demand in a
// browser build through its own subpath.
import catalog from '@rhylthyme/timeline/schedule/labmcp-catalog';
import { labmcp, validateProgram, type LabmcpCatalog } from '@rhylthyme/timeline/schedule';

const loaded: boolean = labmcp.hasCatalog();
const same: LabmcpCatalog = labmcp.registerCatalog(catalog);
const current: LabmcpCatalog | null = labmcp.CATALOG;
const version: string | undefined = current?.source.labmcp;
const lazy: Promise<boolean> = import('@rhylthyme/timeline/schedule/labmcp-catalog')
  .then(() => validateProgram({ tracks: [] }).valid);
// @ts-expect-error CATALOG is read-only: use registerCatalog
labmcp.CATALOG = null;
// @ts-expect-error registerCatalog takes the catalogue
labmcp.registerCatalog('labmcp-catalog.json');
export const labmcpOut = [loaded, same, version, lazy];
