#!/usr/bin/env node
"use strict";

/**
 * Canonical program hash — JavaScript twin of
 * rhylthyme_cli_runner/history/hash.py (`program_version`).
 *
 * Canonical form: object keys sorted by Unicode code point, no whitespace,
 * UTF-8 with non-ASCII left unescaped, integral numbers without a fractional
 * part. The result is "sha256:<hex>".
 *
 * Usage:  node hash-program.js program.json [more.json ...]
 * Prints one "<hash>  <file>" line per file (sha256sum style).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function compareCodePoints(a, b) {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done && nb.done) return 0;
    if (na.done) return -1;
    if (nb.done) return 1;
    const ca = na.value.codePointAt(0);
    const cb = nb.value.codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    // JSON.stringify already writes integral numbers without a fraction and
    // leaves non-ASCII unescaped, matching Python's ensure_ascii=False.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value).sort(compareCodePoints);
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]))
      .join(",") +
    "}"
  );
}

function programVersion(program) {
  const hash = crypto
    .createHash("sha256")
    .update(canonicalJson(program), "utf8")
    .digest("hex");
  return "sha256:" + hash;
}

module.exports = { canonicalJson, programVersion };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("usage: hash-program.js program.json [more.json ...]");
    process.exit(2);
  }
  for (const file of files) {
    const program = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(programVersion(program) + "  " + path.basename(file));
  }
}
