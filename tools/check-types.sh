#!/bin/sh
# Type-checks test/types/*.ts against the package as a user installs it:
# npm pack, install the tarball into an empty ESM project, run tsc there.
# Needs network for `npx typescript` the first time. Used by CI.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT" && npm pack --silent --pack-destination "$WORK" >/dev/null
cd "$WORK"
printf '{ "name": "types-check", "private": true, "type": "module" }\n' > package.json
npm install --silent --no-audit --no-fund ./rhylthyme-timeline-*.tgz
cp "$ROOT"/test/types/usage.ts "$ROOT"/test/types/usage-cjs.cts "$ROOT"/test/types/usage-element.ts "$ROOT"/test/types/usage-labmcp.ts "$ROOT"/test/types/tsconfig.json .
npx -y -p typescript@5 tsc -p .
echo "types: OK"
