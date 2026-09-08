'use strict'

// Run a valibot schema on the ata engine.
//
//   const check = compile(schema)
//   check.isValid(data)                 // ata answers
//   check.safeParse(data)               // valibot-shaped result, valibot value
//
// valibot ships an official JSON Schema conversion (@valibot/to-json-schema),
// and ata is a JSON Schema engine. The conversion is asked for the input side
// (`typeMode: 'input'`) with unrepresentable features ignored, which can only
// make the emitted schema looser than valibot, never stricter. That gives the
// same contract as the zod bridge: a schema classified `ata` is exact and the
// engine answers alone; a schema with residue (transforms, checks, formats,
// native types) runs in `hybrid` mode, where ata's rejections are final and
// valibot confirms the acceptances; anything that widens acceptance beyond
// the emitted schema (fallback) or that the classifier has never seen hands
// the whole schema to valibot. Unknown nodes land in `valibot` mode, so a new
// valibot feature can make the bridge slower, never wrong.

// ---------------------------------------------------------------------------
// classification

// Schema node types whose emitted schema equals valibot's acceptance, given
// their children do.
const EXACT = new Set([
  'string', 'number', 'boolean', 'null', 'literal', 'picklist', 'enum',
  'object', 'strict_object', 'loose_object', 'array', 'tuple', 'union',
  'variant', 'intersect', 'optional', 'nullable', 'nullish',
  'exact_optional', 'any', 'unknown', 'lazy',
])

// Schema node types JSON Schema cannot express: the emitted input schema is
// `{}` for them, strictly looser, so ata's rejections stay sound and valibot
// owns the acceptance.
const RESIDUE = new Set([
  'date', 'bigint', 'blob', 'file', 'map', 'set', 'symbol', 'undefined',
  'void', 'nan', 'promise', 'function', 'instance', 'custom', 'never',
])

// Pipe validations the converter emits as structural JSON Schema keywords
// with the same semantics ata checks. Formats (email, url, uuid and friends)
// are deliberately NOT here: ata's format checks are not guaranteed to match
// valibot's character for character, so the engine is compiled with format
// assertion off and every format action stays residue for valibot to confirm.
const EXACT_ACTIONS = new Set([
  'min_length', 'max_length', 'length', 'min_value', 'max_value',
  'multiple_of', 'integer', 'regex', 'min_entries', 'max_entries',
])

const CHILD_LISTS = ['options', 'items', 'pipe']
const CHILD_NODES = ['item', 'wrapped', 'key', 'value', 'rest']

function analyze (schema) {
  const seen = new Set()
  const reasons = []
  let mode = 'ata'
  let producesValue = false

  const escalate = (to, why) => {
    if (to === 'valibot') mode = 'valibot'
    else if (to === 'hybrid' && mode === 'ata') mode = 'hybrid'
    if (reasons.length < 8) reasons.push(why)
  }

  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (node.kind !== 'schema') { escalate('valibot', 'node without a schema kind'); return }
    const type = node.type

    if (node.async) escalate('valibot', 'async schema at ' + type)
    // v.fallback() swallows failures and returns a value, so valibot accepts
    // input the emitted schema turns away. A fast rejection would be a wrong
    // rejection.
    if (node.fallback !== undefined) { escalate('valibot', 'fallback at ' + type); producesValue = true }
    if (node.default !== undefined) producesValue = true

    // valibot's record runs on anything object-typed, arrays included, while
    // the emitted schema's `object` excludes them; a fast rejection of an
    // array would be a wrong rejection, so records stay valibot's.
    if (type === 'record') escalate('valibot', 'record accepts arrays')
    else if (RESIDUE.has(type)) escalate('hybrid', type)
    else if (!EXACT.has(type)) escalate('valibot', 'unrecognised node ' + type)

    if (Array.isArray(node.pipe)) {
      // pipe[0] is the base schema and the only stage the input-side
      // conversion emits beyond whitelisted validations. Everything after it
      // can only tighten what valibot accepts, so residue stays sound.
      for (let i = 1; i < node.pipe.length; i++) {
        const item = node.pipe[i]
        if (!item || typeof item !== 'object') continue
        if (item.kind === 'metadata') continue
        if (item.kind === 'validation') {
          if (!EXACT_ACTIONS.has(item.type)) escalate('hybrid', item.type + ' at ' + type)
        } else if (item.kind === 'transformation') {
          escalate('hybrid', item.type + ' at ' + type)
          producesValue = true
        } else if (item.kind === 'schema') {
          escalate('hybrid', 'piped schema at ' + type)
          producesValue = true
        } else {
          escalate('valibot', 'unrecognised pipe item ' + String(item.kind))
        }
      }
    }

    if (node.entries) for (const k of Object.keys(node.entries)) walk(node.entries[k])
    for (const k of CHILD_NODES) if (node[k] && typeof node[k] === 'object') walk(node[k])
    for (const k of CHILD_LISTS) {
      if (k === 'pipe') continue
      if (Array.isArray(node[k])) for (const child of node[k]) walk(child)
    }
    if (Array.isArray(node.pipe) && node.pipe[0] && node.pipe[0] !== node) walk(node.pipe[0])
    if (typeof node.getter === 'function') {
      try { walk(node.getter(undefined)) } catch { escalate('valibot', 'lazy getter threw') }
    }
  }

  walk(schema)
  return { mode, reasons, producesValue }
}

// ---------------------------------------------------------------------------
// compile

function requireValibot () {
  // Resolved lazily from the peer so this package never pins its own copy.
  return require('valibot')
}

function toJSONSchema (schema) {
  const { toJsonSchema } = require('@valibot/to-json-schema')
  return toJsonSchema(schema, { typeMode: 'input', errorMode: 'ignore' })
}

// One semantic gap survives the conversion: valibot's `number` accepts
// Infinity and -Infinity (it only turns away NaN), while ata follows JSON,
// where no such values exist. Values holding them can only be built in
// JavaScript, never parsed from JSON, so the engine's verdict stands unless
// the schema constrains numbers somewhere AND the rejected value actually
// carries a non-finite number, in which case valibot gets the final word.
function schemaChecksNumbers (node, seen) {
  if (!node || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)
  if (node.type === 'number' || (Array.isArray(node.type) && node.type.includes('number'))) return true
  for (const k of Object.keys(node)) {
    const child = node[k]
    if (Array.isArray(child)) {
      for (const it of child) if (schemaChecksNumbers(it, seen)) return true
    } else if (schemaChecksNumbers(child, seen)) return true
  }
  return false
}

// Depth-capped so cyclic input cannot loop: past the cap the scan reports
// "might", and the delegate below decides inside a try/catch.
function hasNonFinite (value, depth) {
  if (typeof value === 'number') return value === Infinity || value === -Infinity
  if (value === null || typeof value !== 'object') return false
  if (depth > 256) return true
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (hasNonFinite(value[i], depth + 1)) return true
    return false
  }
  for (const k in value) if (hasNonFinite(value[k], depth + 1)) return true
  return false
}

function confirmNonFinite (v, schema, d) {
  try {
    return v.safeParse(schema, d).success
  } catch {
    // valibot could not decide (cyclic input past the scan cap); the engine's
    // rejection stands.
    return false
  }
}

// A rejection whose issues are built on first read, by running valibot once
// at that moment. The getter lives on the prototype: an object-literal
// accessor per rejection costs about a hundred nanoseconds, which is the
// whole budget of the fast path. The classifier proves ata only rejects what
// valibot rejects; were that ever broken, the getter hands back what ata saw
// rather than nothing, and the differential suite is the place that fails.
class LazyRejection {
  constructor (schema, engine, data) {
    this.typed = false
    this.success = false
    this.output = data
    this._schema = schema
    this._engine = engine
    this._issues = null
  }
}
Object.defineProperty(LazyRejection.prototype, 'issues', {
  enumerable: true,
  configurable: true,
  get () {
    if (this._issues === null) {
      const v = requireValibot()
      const r = v.safeParse(this._schema, this.output)
      this._issues = r.success
        ? this._engine.validate(this.output).errors.map((e) => ({
            kind: 'schema', type: 'ata', input: this.output, expected: null,
            received: 'unknown', message: e.message, path: undefined,
          }))
        : r.issues
    }
    return this._issues
  },
})

function compile (schema, opts) {
  const options = opts || {}
  const v = requireValibot()
  const analysis = analyze(schema)
  const jsonSchema = analysis.mode === 'valibot' ? null : toJSONSchema(schema)
  const engine = jsonSchema
    ? new (require('ata-validator').Validator)(jsonSchema, { assertFormat: false, ...options.validator })
    : null
  const rawFast = engine ? (d) => engine.isValidObject(d) : null
  // A rejection is final unless the value carries Infinity, which valibot
  // accepts where JSON has no word for it. The escape only exists for
  // schemas that constrain numbers at all, and it only ever runs on the
  // rejected path, so JSON-borne data never pays for it.
  const numeric = engine ? schemaChecksNumbers(jsonSchema, new Set()) : false
  const fast = !rawFast ? null : !numeric ? rawFast
    : (d) => rawFast(d) || (hasNonFinite(d, 0) && confirmNonFinite(v, schema, d))

  let isValid
  if (analysis.mode === 'ata') {
    isValid = fast
  } else if (analysis.mode === 'hybrid') {
    // ata turning a value down is final; ata letting it through hands it to
    // valibot for the checks and native types the JSON Schema cannot carry.
    isValid = (d) => fast(d) && v.safeParse(schema, d).success
  } else {
    isValid = (d) => v.safeParse(schema, d).success
  }

  // The parsed value is valibot's to make: plain v.object strips unknown
  // keys, defaults fill, transforms rewrite, so an accepted value always runs
  // valibot and comes back exactly as valibot would return it. What ata owns
  // is the rejection: it is decided at ata speed, and the issues are built
  // only if somebody reads them, by running valibot once at that moment.
  const safeParse = (d) => {
    if (fast && !fast(d)) return new LazyRejection(schema, engine, d)
    return v.safeParse(schema, d)
  }

  // Raw bytes: an engine:'ata' schema is decided without JSON.parse, straight
  // off the buffer by the native walker when it is present. The other modes
  // need the materialized value for valibot, and so does a pure-JS install,
  // so they parse and take the object path. Bytes that are not JSON are a
  // rejection, not an exception.
  let isValidBytes
  if (analysis.mode === 'ata' && engine && !numeric && typeof engine.isValid === 'function') {
    isValidBytes = (input) => engine.isValid(input)
  } else {
    const td = new TextDecoder()
    isValidBytes = (input) => {
      let value
      try {
        value = JSON.parse(typeof input === 'string' ? input : td.decode(input))
      } catch {
        return false
      }
      return isValid(value)
    }
  }

  // ata's error report for the schema-representable part; valibot's issues
  // where only valibot knows why.
  const validate = (d) => {
    if (engine) {
      const r = engine.validate(d)
      if (!r.valid) return { valid: false, errors: r.errors }
    }
    if (analysis.mode !== 'ata') {
      const vr = v.safeParse(schema, d)
      if (!vr.success) return { valid: false, errors: vr.issues }
    }
    return { valid: true, data: d }
  }

  const compiled = {
    isValid,
    isValidBytes,
    safeParse,
    parse: (d) => {
      const r = safeParse(d)
      if (r.success) return r.output
      throw new v.ValiError(r.issues)
    },
    validate,
    schema: jsonSchema,
    valibotSchema: schema,
    engine: analysis.mode,
    reasons: analysis.reasons,
  }

  compiled['~standard'] = {
    version: 1,
    vendor: 'ata-valibot',
    validate (value) {
      const r = safeParse(value)
      if (r.success) return { value: r.output }
      return { issues: r.issues.map((i) => ({ message: i.message, path: i.path && i.path.map((p) => p.key) })) }
    },
  }

  return compiled
}

module.exports = { compile, analyze, toJSONSchema }
