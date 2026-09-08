// Interleaved comparison on one API-boundary schema: valibot and the same
// schema through ata. Medians of 7 rounds; run it a few times and quote the
// run you can reproduce, not the best one.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const v = require('valibot')
const { compile } = require('./index.js')

const imageSchema = v.object({
  id: v.number(),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  type: v.picklist(['jpg', 'png']),
  size: v.number(),
  url: v.pipe(v.string(), v.minLength(1)),
})
const schema = v.object({
  id: v.number(),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  brand: v.pipe(v.string(), v.minLength(1), v.maxLength(30)),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  price: v.pipe(v.number(), v.minValue(1), v.maxValue(10000)),
  discount: v.nullable(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
  quantity: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
  tags: v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(30))),
  images: v.array(imageSchema),
})

const valid = {
  id: 252,
  title: 'Apple',
  brand: 'Sunny Backyard',
  description: 'Red apple from Lake Constance',
  price: 89,
  discount: null,
  quantity: 5,
  tags: ['fruit', 'red', 'round'],
  images: [
    { id: 1, title: 'a', type: 'jpg', size: 100, url: 'https://example.com/1' },
    { id: 2, title: 'b', type: 'png', size: 200, url: 'https://example.com/2' },
  ],
}
const invalid = { ...valid, title: '', quantity: 1000 }

const ata = compile(schema)
console.log('mode:', ata.engine)
console.log('sanity:', ata.isValid(valid), ata.isValid(invalid), v.safeParse(schema, valid).success, v.safeParse(schema, invalid).success)

const cases = [
  ['valibot safeParse   valid  ', () => v.safeParse(schema, valid).success],
  ['ata     isValid     valid  ', () => ata.isValid(valid)],
  ['ata     safeParse   valid  ', () => ata.safeParse(valid).success],
  ['valibot safeParse   invalid', () => v.safeParse(schema, invalid).success],
  ['ata     isValid     invalid', () => ata.isValid(invalid)],
  ['ata     safeParse   invalid', () => ata.safeParse(invalid).success],
]

const N = 200000
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
for (const [, fn] of cases) for (let i = 0; i < 20000; i++) fn()
const meds = {}
for (const [name] of cases) meds[name] = []
for (let r = 0; r < 7; r++) {
  for (const [name, fn] of cases) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < N; i++) fn()
    meds[name].push(Number(process.hrtime.bigint() - t) / N)
  }
}
for (const [name] of cases) {
  console.log(`${name}  ${median(meds[name]).toFixed(1).padStart(8)} ns`)
}
