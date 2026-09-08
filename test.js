'use strict'

// The only claim that matters: same answers as valibot. Every schema below is
// compiled once and then interrogated with a mutation corpus seeded from its
// own samples, and every verdict is compared with valibot's. A single
// disagreement is a thrown error, not a logged warning.

const assert = require('assert')
const v = require('valibot')
const { compile, analyze } = require('./index.js')

let passed = 0
let checked = 0

function ok (name, cond) {
  assert.strictEqual(cond, true, name)
  passed++
}

function mutate (value, rng) {
  const r = rng()
  if (value === null || typeof value !== 'object') {
    if (r < 0.12) return null
    if (r < 0.24) return String(value)
    if (r < 0.36) return typeof value === 'number' ? value + 1 : 0
    if (r < 0.44) return undefined
    if (r < 0.52) return [value]
    if (r < 0.6) return { value }
    if (r < 0.68) return typeof value === 'string' ? value + 'x' : true
    if (r < 0.76) return typeof value === 'string' ? '' : -1
    if (r < 0.84) return NaN
    if (r < 0.92) return Infinity
    return value
  }
  if (Array.isArray(value)) {
    const c = value.slice()
    if (r < 0.25 && c.length) c[Math.floor(rng() * c.length)] = mutate(c[0], rng)
    else if (r < 0.5) c.push(mutate(c[0] === undefined ? 1 : c[0], rng))
    else if (r < 0.75 && c.length) c.pop()
    else return r < 0.9 ? c : {}
    return c
  }
  const c = { ...value }
  const keys = Object.keys(c)
  if (r < 0.3 && keys.length) { const k = keys[Math.floor(rng() * keys.length)]; c[k] = mutate(c[k], rng) }
  else if (r < 0.55 && keys.length) { delete c[keys[Math.floor(rng() * keys.length)]] }
  else if (r < 0.8) { c['extra_' + Math.floor(rng() * 3)] = mutate(keys.length ? c[keys[0]] : 1, rng) }
  else return r < 0.92 ? c : []
  return c
}

function lcg (seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function differential (name, schema, samples, expectedMode) {
  const compiled = compile(schema)
  if (expectedMode) {
    ok(name + ': classified as ' + expectedMode + ' (got ' + compiled.engine + ')', compiled.engine === expectedMode)
  }
  const rng = lcg(0xa7a)
  const values = [undefined, null, 0, '', 'x', 42, true, [], {}, [1, 'x'], { unexpected: 1 }, NaN, Infinity, -Infinity]
  for (const s of samples) {
    values.push(s)
    let val = s
    for (let i = 0; i < 400; i++) {
      val = i % 5 === 0 ? mutate(s, rng) : mutate(val, rng)
      values.push(val)
    }
  }
  for (const value of values) {
    checked++
    const want = v.safeParse(schema, value).success
    const got = compiled.isValid(value)
    if (got !== want) {
      throw new Error(name + ': isValid disagrees with valibot on ' + JSON.stringify(value) + ' (valibot ' + want + ', got ' + got + ')')
    }
    const sp = compiled.safeParse(value)
    if (sp.success !== want) {
      throw new Error(name + ': safeParse disagrees with valibot on ' + JSON.stringify(value))
    }
    if (want && sp.success) {
      const ref = v.safeParse(schema, value)
      assert.deepStrictEqual(sp.output, ref.output, name + ': parsed value differs from valibot for ' + JSON.stringify(value))
    }
    const json = JSON.stringify(value)
    if (json !== undefined) {
      const reparsed = JSON.parse(json)
      const wantBytes = v.safeParse(schema, reparsed).success
      if (compiled.isValidBytes(Buffer.from(json)) !== wantBytes) {
        throw new Error(name + ': isValidBytes disagrees with valibot on ' + json)
      }
      if (compiled.isValidBytes(json) !== wantBytes) {
        throw new Error(name + ': isValidBytes(string) disagrees on ' + json)
      }
    }
  }
  passed++
  return compiled
}

// 1. exact conversions: ata answers alone
differential('flat object', v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  role: v.picklist(['admin', 'user']),
  bio: v.optional(v.string()),
  score: v.nullable(v.number()),
}), [
  { id: 1, name: 'ada', role: 'admin', score: null },
  { id: 9, name: 'linus', role: 'user', bio: 'kernel', score: 3.5 },
], 'ata')

differential('nested product', v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  price: v.pipe(v.number(), v.minValue(0)),
  tags: v.array(v.pipe(v.string(), v.minLength(1))),
  images: v.array(v.object({ url: v.pipe(v.string(), v.minLength(1)), size: v.pipe(v.number(), v.integer()) })),
}), [
  { title: 'Apple', price: 3, tags: ['fruit'], images: [{ url: 'https://x/1', size: 100 }] },
], 'ata')

differential('strict object', v.strictObject({ a: v.string(), b: v.number() }), [
  { a: 'x', b: 1 },
], 'ata')

differential('record', v.record(v.string(), v.pipe(v.number(), v.minValue(0))), [
  { a: 1, b: 2 }, [],
], 'valibot')

differential('variant', v.variant('kind', [
  v.object({ kind: v.literal('circle'), r: v.pipe(v.number(), v.minValue(0)) }),
  v.object({ kind: v.literal('rect'), w: v.number(), h: v.number() }),
]), [
  { kind: 'circle', r: 2 },
  { kind: 'rect', w: 1, h: 2 },
], 'ata')

differential('union root', v.union([v.literal('a'), v.pipe(v.number(), v.integer())]), ['a', 3], 'ata')

differential('regex', v.object({ slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) }), [
  { slug: 'a-1' },
], 'ata')

{
  const node = v.object({
    value: v.number(),
    children: v.optional(v.array(v.lazy(() => node))),
  })
  differential('recursive tree', node, [
    { value: 1 },
    { value: 1, children: [{ value: 2, children: [] }] },
  ], 'ata')
}

// 2. residue: ata rejects, valibot confirms
differential('email format', v.object({ email: v.pipe(v.string(), v.email()) }), [
  { email: 'a@b.co' },
], 'hybrid')

differential('transform', v.object({ n: v.pipe(v.string(), v.transform(Number), v.minValue(5)) }), [
  { n: '9' },
], 'hybrid')

differential('piped schema', v.object({ n: v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(5)) }), [
  { n: '9' },
], 'hybrid')

differential('custom check', v.object({ n: v.pipe(v.number(), v.check((x) => x !== 13)) }), [
  { n: 7 }, { n: 13 },
], 'hybrid')

differential('date field', v.object({ when: v.date(), label: v.string() }), [
  { when: new Date(), label: 'x' },
], 'hybrid')

// 3. only valibot can answer
differential('fallback', v.object({ n: v.fallback(v.number(), 0) }), [
  { n: 1 }, { n: 'not a number' },
], 'valibot')

// 4. primitive roots
differential('string root', v.pipe(v.string(), v.minLength(2), v.maxLength(5)), ['ab', 'abcde'], 'ata')
differential('number root', v.number(), [1.5, -3], 'ata')

// 5. bytes that are not JSON are rejected, never thrown
{
  const c = compile(v.object({ n: v.number() }))
  ok('bytes: truncated JSON rejects', c.isValidBytes(Buffer.from('{"n": 1')) === false)
  ok('bytes: empty buffer rejects', c.isValidBytes(Buffer.from('')) === false)
  ok('bytes: garbage rejects', c.isValidBytes('not json at all') === false)
}

// 6. the standard schema face agrees
{
  const c = compile(v.object({ n: v.pipe(v.number(), v.minValue(1)) }))
  const good = c['~standard'].validate({ n: 2 })
  ok('standard: accepts', 'value' in good)
  const bad = c['~standard'].validate({ n: 0 })
  ok('standard: rejects with issues', Array.isArray(bad.issues) && bad.issues.length > 0)
}

// 7. classification is conservative for the unknown
{
  const fake = { kind: 'schema', type: 'shiny_new_feature', async: false }
  const a = analyze(fake)
  ok('unknown node lands in valibot mode', a.mode === 'valibot')
  const noKind = analyze({})
  ok('kindless node lands in valibot mode', noKind.mode === 'valibot')
}

// 8. lazy rejection builds real valibot issues on read
{
  const c = compile(v.object({ n: v.pipe(v.number(), v.minValue(1)) }))
  const r = c.safeParse({ n: 0 })
  ok('rejection is lazy', r.success === false && r._issues === null)
  ok('issues are valibot issues', Array.isArray(r.issues) && r.issues[0].kind === 'validation')
  ok('parse throws ValiError', (() => { try { c.parse({ n: 0 }); return false } catch (e) { return e instanceof v.ValiError } })())
}

console.log('ata-valibot: ' + passed + ' checks, ' + checked + ' differential values, all agreeing with valibot')
