// JSON Schema check for Rhylthyme programs, with no dependencies.
//
// The program schemas from rhylthyme-spec (0.2.0-alpha and 0.3.0-alpha,
// byte-for-byte copies in ./schemas/) are Draft 7. This is a checker for
// exactly the keywords they use, with the semantics of Python's
// `jsonschema` (what the `rhylthyme` package validates with), so the JS
// and Python validators agree on which programs match the schema:
//
//   assertions   type, enum, const, required, properties,
//                additionalProperties, items, minItems, minLength,
//                maxLength, pattern, minimum, maximum, exclusiveMinimum
//   combinators  oneOf (exactly one), anyOf, not, if/then
//   references   $ref to "#/definitions/..." (Draft 7: siblings of $ref
//                are ignored)
//   ignored      format (Python jsonschema ignores it without a format
//                checker), title, description, $comment, default, $schema
//
// A few more keywords of the same kind (allOf, else, maxItems, maximum,
// exclusiveMaximum) are handled so a schema update that starts using them
// keeps working. A keyword this file does not know is reported by
// `unsupportedKeywords` and fails test/json-schema.test.js.
//
//   checkJsonSchema(value, schema)  -> [{ keyword, path, message, fix }]
//   programSchema(schemaVersion)    -> the bundled schema the version selects
//   schemaFindings(program)         -> validator findings, schema_<keyword>

"use strict";

const SCHEMAS = {
  "0.2.0-alpha": require("./schemas/program_schema_0.2.0-alpha.json"),
  "0.3.0-alpha": require("./schemas/program_schema_0.3.0-alpha.json"),
};

// Keywords that carry no assertion.
const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples", "definitions", "format"]);
const KNOWN = new Set([
  ...ANNOTATIONS, "$ref", "type", "enum", "const", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "minLength", "maxLength", "pattern", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "oneOf", "anyOf", "allOf", "not", "if", "then", "else",
]);

// The schema a program is checked against, as rhylthyme-examples'
// conftest.py picks it: 0.3.x selects 0.3.0-alpha, anything else
// (0.1.0, 0.2.0-alpha, missing) 0.2.0-alpha.
function programSchema(schemaVersion) {
  return /^0\.3(?![0-9])/.test(String(schemaVersion == null ? "" : schemaVersion))
    ? SCHEMAS["0.3.0-alpha"]
    : SCHEMAS["0.2.0-alpha"];
}

// ---------------------------------------------------------------------
// Types and equality, as Python jsonschema sees parsed JSON
// ---------------------------------------------------------------------

function _isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function _typeOk(v, t) {
  switch (t) {
    case "object": return _isObj(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    // A float with no fraction (2.0) is an integer to jsonschema; JSON.parse
    // cannot tell 2.0 from 2 anyway. Booleans are never numbers.
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number";
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: return false;
  }
}

function _typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function _equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => _equal(x, b[i]));
  }
  if (_isObj(a) && _isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && _equal(a[k], b[k]));
  }
  return false;
}

// Python's len() counts code points, not UTF-16 units.
function _strLen(s) { return Array.from(s).length; }

function _show(v) {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function _fmtPath(path) {
  if (!path.length) return "program";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${p}` : p)).join("");
}

// ---------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------

function _resolve(root, ref) {
  if (typeof ref !== "string" || ref.charAt(0) !== "#") throw new Error(`json-schema.js: only local $ref is supported, not ${ref}`);
  let node = root;
  for (const raw of ref.slice(1).split("/").slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(key in node)) throw new Error(`json-schema.js: cannot resolve $ref ${ref}`);
    node = node[key];
  }
  return node;
}

const _regexCache = new Map();
function _regex(pattern) {
  if (!_regexCache.has(pattern)) _regexCache.set(pattern, new RegExp(pattern, "u"));
  return _regexCache.get(pattern);
}

// Shapes a failed oneOf/anyOf could have meant. The closest branch is the
// one with the fewest errors, the deepest first error breaking ties; its
// first error explains the failure (like jsonschema's best_match).
function _closest(branchErrors) {
  let best = null;
  for (const errs of branchErrors) {
    if (!errs.length) continue;
    const depth = errs[0].path.length;
    if (!best || errs.length < best.length || (errs.length === best.length && depth > best[0].path.length)) best = errs;
  }
  return best;
}

function _check(v, schema, root, path, out) {
  if (schema === true) return;
  if (schema === false) {
    out.push({ keyword: "false", path, message: `${_fmtPath(path)} is not allowed here.`, fix: `Remove ${_fmtPath(path)}.` });
    return;
  }
  if (!_isObj(schema)) return;
  const where = _fmtPath(path);

  // Draft 7: a $ref replaces the whole schema object.
  if ("$ref" in schema) {
    _check(v, _resolve(root, schema.$ref), root, path, out);
    return;
  }

  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => _typeOk(v, t))) {
      const want = types.join(" or ");
      out.push({
        keyword: "type", path,
        message: `${where} is ${_show(v)} (${_typeName(v)}), not of type ${want}.`,
        fix: types.includes("integer") && typeof v === "string" && /^\s*-?\d+\s*$/.test(v)
          ? `Write ${v.trim()} as a number, without quotes.`
          : types.includes("number") && typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)
            ? `Write ${v.trim()} as a number, without quotes.`
            : `Make ${where} a${/^[aeiou]/.test(want) ? "n" : ""} ${want}.`,
      });
    }
  }
  if ("enum" in schema && !schema.enum.some((e) => _equal(e, v))) {
    out.push({
      keyword: "enum", path,
      message: `${where} is ${_show(v)}, not one of ${schema.enum.map(_show).join(", ")}.`,
      fix: `Use one of: ${schema.enum.map(_show).join(", ")}.`,
    });
  }
  if ("const" in schema && !_equal(schema.const, v)) {
    out.push({ keyword: "const", path, message: `${where} is ${_show(v)}, not ${_show(schema.const)}.`, fix: `Set ${where} to ${_show(schema.const)}.` });
  }

  if (_isObj(v)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) {
          out.push({ keyword: "required", path, message: `${where} is missing the required property "${k}".`, fix: `Add "${k}" to ${where}.` });
        }
      }
    }
    const props = _isObj(schema.properties) ? schema.properties : {};
    for (const k of Object.keys(props)) {
      if (Object.prototype.hasOwnProperty.call(v, k)) _check(v[k], props[k], root, path.concat(k), out);
    }
    if ("additionalProperties" in schema) {
      const extra = Object.keys(v).filter((k) => !Object.prototype.hasOwnProperty.call(props, k));
      if (schema.additionalProperties === false) {
        if (extra.length) {
          const allowed = Object.keys(props);
          out.push({
            keyword: "additionalProperties", path,
            message: `${where} has ${extra.length === 1 ? "a property" : "properties"} the schema does not allow: ${extra.map((k) => `"${k}"`).join(", ")}.`,
            fix: `Remove ${extra.map((k) => `"${k}"`).join(", ")} or fix the spelling; allowed here: ${allowed.join(", ")}.`,
          });
        }
      } else {
        for (const k of extra) _check(v[k], schema.additionalProperties, root, path.concat(k), out);
      }
    }
  }

  if (Array.isArray(v)) {
    if ("items" in schema) {
      if (Array.isArray(schema.items)) {
        schema.items.forEach((s, i) => { if (i < v.length) _check(v[i], s, root, path.concat(i), out); });
      } else {
        v.forEach((x, i) => _check(x, schema.items, root, path.concat(i), out));
      }
    }
    if (typeof schema.minItems === "number" && v.length < schema.minItems) {
      out.push({ keyword: "minItems", path, message: `${where} has ${v.length} item(s); at least ${schema.minItems} required.`, fix: `Add items to ${where}, or remove it if it is optional.` });
    }
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) {
      out.push({ keyword: "maxItems", path, message: `${where} has ${v.length} items; at most ${schema.maxItems} allowed.`, fix: `Shorten ${where}.` });
    }
  }

  if (typeof v === "string") {
    if (typeof schema.minLength === "number" && _strLen(v) < schema.minLength) {
      out.push({ keyword: "minLength", path, message: `${where} is shorter than ${schema.minLength} character(s).`, fix: v ? `Lengthen ${where}.` : `Give ${where} a value or remove it.` });
    }
    if (typeof schema.maxLength === "number" && _strLen(v) > schema.maxLength) {
      out.push({ keyword: "maxLength", path, message: `${where} is longer than ${schema.maxLength} characters.`, fix: `Shorten ${where} to ${schema.maxLength} characters or fewer.` });
    }
    if (typeof schema.pattern === "string" && !_regex(schema.pattern).test(v)) {
      out.push({ keyword: "pattern", path, message: `${where} is ${_show(v)}, which does not match ${schema.pattern}.`, fix: `Make ${where} match the pattern ${schema.pattern}.` });
    }
  }

  if (typeof v === "number") {
    if (typeof schema.minimum === "number" && v < schema.minimum) {
      out.push({ keyword: "minimum", path, message: `${where} is ${v}, less than the minimum ${schema.minimum}.`, fix: `Use a value of at least ${schema.minimum}.` });
    }
    if (typeof schema.maximum === "number" && v > schema.maximum) {
      out.push({ keyword: "maximum", path, message: `${where} is ${v}, more than the maximum ${schema.maximum}.`, fix: `Use a value of at most ${schema.maximum}.` });
    }
    if (typeof schema.exclusiveMinimum === "number" && v <= schema.exclusiveMinimum) {
      out.push({ keyword: "exclusiveMinimum", path, message: `${where} is ${v}; it must be greater than ${schema.exclusiveMinimum}.`, fix: `Use a value greater than ${schema.exclusiveMinimum}.` });
    }
    if (typeof schema.exclusiveMaximum === "number" && v >= schema.exclusiveMaximum) {
      out.push({ keyword: "exclusiveMaximum", path, message: `${where} is ${v}; it must be less than ${schema.exclusiveMaximum}.`, fix: `Use a value less than ${schema.exclusiveMaximum}.` });
    }
  }

  const sub = (s) => { const e = []; _check(v, s, root, path, e); return e; };

  if (Array.isArray(schema.allOf)) schema.allOf.forEach((s) => _check(v, s, root, path, out));
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = [];
    let ok = false;
    for (const s of schema.anyOf) {
      const e = sub(s);
      if (!e.length) { ok = true; break; }
      branchErrors.push(e);
    }
    if (!ok) out.push(_combinatorError("anyOf", where, path, schema.anyOf.length, branchErrors));
  }
  if (Array.isArray(schema.oneOf)) {
    const branchErrors = schema.oneOf.map(sub);
    const matched = branchErrors.filter((e) => !e.length).length;
    if (matched === 0) {
      out.push(_combinatorError("oneOf", where, path, schema.oneOf.length, branchErrors));
    } else if (matched > 1) {
      out.push({
        keyword: "oneOf", path,
        message: `${where} matches ${matched} of the ${schema.oneOf.length} allowed shapes; it must match exactly one.`,
        fix: `Remove the keys that make ${where} ambiguous (for example a duration with both seconds and timeString).`,
      });
    }
  }
  if ("not" in schema && !sub(schema.not).length) {
    const req = _isObj(schema.not) && Array.isArray(schema.not.required) ? schema.not.required : null;
    out.push({
      keyword: "not", path,
      message: req ? `${where} must not have ${req.map((k) => `"${k}"`).join(" and ")} together.` : `${where} matches a shape the schema forbids.`,
      fix: req ? `Keep only one of ${req.map((k) => `"${k}"`).join(", ")}.` : `Change ${where} so it no longer matches the forbidden shape.`,
    });
  }
  if ("if" in schema) {
    if (!sub(schema.if).length) { if ("then" in schema) _check(v, schema.then, root, path, out); }
    else if ("else" in schema) _check(v, schema.else, root, path, out);
  }
}

function _combinatorError(keyword, where, path, n, branchErrors) {
  // Every shape only lacks a key (the program-level "resourceConstraints,
  // environment or environmentType" choice): name the alternatives.
  const missing = branchErrors.map((errs) => (errs.length === 1 && errs[0].keyword === "required" && errs[0].path.length === path.length
    ? /"([^"]+)"/.exec(errs[0].message)[1] : null));
  if (branchErrors.length > 1 && missing.every(Boolean)) {
    const keys = [...new Set(missing)].map((k) => `"${k}"`);
    const list = keys.length > 1 ? `${keys.slice(0, -1).join(", ")} or ${keys[keys.length - 1]}` : keys[0];
    return { keyword, path, message: `${where} needs one of ${list}.`, fix: `Add ${list} to ${where}.` };
  }
  const best = _closest(branchErrors);
  const first = best && best[0];
  return {
    keyword, path,
    message: `${where} does not match any of the ${n} allowed shapes` +
      (first ? `; closest: ${first.message}` : "."),
    fix: first && first.fix ? first.fix : `Change ${where} to one of the shapes the schema allows.`,
  };
}

// Validate `value` against `schema` (a Draft 7 schema using the keywords
// above). Returns every failure: [{ keyword, path, message, fix }], where
// path is an array of keys and indexes. Empty means valid.
function checkJsonSchema(value, schema) {
  const out = [];
  _check(value, schema, schema, [], out);
  return out;
}

// Keywords in `schema` this checker does not implement (empty for the
// bundled schemas; test/json-schema.test.js keeps it that way).
function unsupportedKeywords(schema) {
  const found = new Set();
  const walk = (s) => {
    if (!_isObj(s)) return;
    for (const [k, v] of Object.entries(s)) {
      if (!KNOWN.has(k)) found.add(k);
      if (k === "properties" || k === "definitions") Object.values(v).forEach(walk);
      else if (["items", "additionalProperties", "not", "if", "then", "else"].includes(k)) (Array.isArray(v) ? v : [v]).forEach(walk);
      else if (["oneOf", "anyOf", "allOf"].includes(k)) v.forEach(walk);
    }
  };
  walk(schema);
  return [...found].sort();
}

// ---------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------

// The Python validator converts duration strings to seconds before it
// checks the schema (validate_program.normalize_time_fields with
// parse_time_string_to_seconds); this is the same conversion, quirks
// included ("-2m" -> 120, "abc" -> 0), so both check the same document.
const TIME_FIELDS = new Set(["seconds", "minSeconds", "maxSeconds", "defaultSeconds", "optimalSeconds", "offsetSeconds", "bufferSeconds"]);

function _pySeconds(s) {
  if (!s) return 0;
  const t = s.trim();
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  let total = 0, num = "";
  for (const ch of t) {
    if (ch >= "0" && ch <= "9") num += ch;
    else if (ch === "h" || ch === "m" || ch === "s") {
      if (num) total += parseInt(num, 10) * (ch === "h" ? 3600 : ch === "m" ? 60 : 1);
      num = "";
    }
  }
  return total;
}

// Also reads the value the way JSON would serialize it: a property set to
// undefined is absent (the expander leaves some), like the Python dict.
function normalizeTimeFields(data) {
  if (Array.isArray(data)) return data.map((v) => (v === undefined ? null : normalizeTimeFields(v)));
  if (!_isObj(data)) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || typeof v === "function") continue;
    if (k === "alerts") out[k] = v; // signed offsets stay as written
    else if (TIME_FIELDS.has(k)) out[k] = typeof v === "string" ? _pySeconds(v) : v;
    else out[k] = normalizeTimeFields(v);
  }
  return out;
}

// Validator findings for `program` against the schema its schemaVersion
// selects: [{ code: "schema_<keyword>", message, where, fix }]. Time
// strings are converted to seconds first, as the Python validator does.
function schemaFindings(program) {
  const schema = programSchema(_isObj(program) ? program.schemaVersion : undefined);
  return checkJsonSchema(normalizeTimeFields(program), schema).map((e) => ({
    code: `schema_${e.keyword}`,
    message: e.message,
    where: _fmtPath(e.path),
    fix: e.fix,
  }));
}

module.exports = {
  checkJsonSchema,
  programSchema,
  schemaFindings,
  unsupportedKeywords,
  normalizeTimeFields,
  SCHEMA_VERSIONS: Object.keys(SCHEMAS),
};
