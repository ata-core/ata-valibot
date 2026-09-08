# @ata-project/valibot

Run a valibot schema on the [ata engine](https://github.com/ata-core/ata-validator).
The schema stays valibot, the answers always match valibot's own, and the
verdicts arrive in nanoseconds.

```
npm install @ata-project/valibot
```

valibot and ata-validator are installed alongside; valibot is a peer.

```js
import * as v from 'valibot'
import { compile } from '@ata-project/valibot'

const user = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
})

const check = compile(user)
check.isValid(data)        // ata answers
check.safeParse(data)      // valibot-shaped result, valibot-produced value
check.parse(data)          // throws a real ValiError
check.isValidBytes(bytes)  // verdict from a Buffer or JSON string
```

## How it stays correct

valibot ships an official JSON Schema conversion (`@valibot/to-json-schema`).
The bridge asks it for the input side with unrepresentable features ignored,
which can only make the emitted schema looser than valibot, never stricter.
Then the schema is classified by walking valibot's own tree before anything
runs:

| Mode | When | Who answers |
|---|---|---|
| `ata` | the conversion is exact | ata alone |
| `hybrid` | provably looser (transforms, checks, formats, native types) | ata's rejections are final, valibot confirms acceptances |
| `valibot` | valibot accepts what the conversion rejects (fallback, records, async) or a node is unknown | valibot |

The classification is conservative: an unrecognised node lands in `valibot`
mode, so a new valibot feature can make the bridge slower, never wrong.
`compiled.engine` tells you which mode you got, `compiled.reasons` says why.

Two valibot semantics survive nowhere in JSON Schema and are handled
explicitly rather than papered over. valibot's `number` accepts Infinity,
which JSON has no word for: schemas that constrain numbers get a scan of the
rejected value, and a rejection that might be Infinity-caused is handed to
valibot for the final word. And `v.record` runs on arrays too, so records stay
valibot's entirely.

The package is differential-tested against valibot on 10,249 generated values
across all three modes, including NaN and Infinity corners, and the whole
suite runs a second time with code generation blocked.

## What it costs, measured

One representative API-boundary object schema (nine fields, nested arrays of
objects, picklist, nullable), interleaved medians of 7 rounds on an M-series
Mac, Node 25, valibot 1.4.2, ata-validator 1.13.2:

| | valibot `safeParse` | this package |
|---|---|---|
| accept, verdict only | 1,051 ns | **20 ns** |
| reject, verdict only | 1,117 ns | **83 ns** |
| reject, `safeParse` | 1,117 ns | **84 ns** |
| accept, `safeParse` | 1,051 ns | 1,062 ns |

The last row is by design, not a gap: an accepted value's output is valibot's
to make. Plain `v.object` strips unknown keys, defaults fill, transforms
rewrite, so `safeParse` hands every accepted value to valibot and returns
exactly what valibot returns. What this package owns is the verdict and the
rejection, and a rejected `safeParse` builds its issues only when somebody
reads them, by running valibot once at that moment.

The reject rows carry the Infinity scan described above; on schemas with no
number constraints they drop to the bare engine verdict.

With code generation blocked, the way a strict CSP or a locked-down edge
runtime blocks it: valibot stays at its usual speed, and the bridge falls back
to ata's interpreted engine at 624 ns for accepts and 187 ns for rejects,
still ahead on both.

## Raw bytes

`isValidBytes` answers from a `Buffer`, `Uint8Array` or JSON string. On an
`engine: 'ata'` schema with no number constraints and the native engine
present, the verdict comes straight off the bytes with no `JSON.parse`; other
schemas parse first so number semantics stay exact. Bytes that are not valid
JSON return `false` rather than throwing.

## Limitations, plainly

- Accepted values in `hybrid` mode and every value in `valibot` mode run
  valibot, so those paths are valibot-speed. The win is the rejection and the
  pure-schema case.
- `validate()` reports ata's errors for the schema-representable part, which
  are JSON Schema errors, not valibot issues. Use `safeParse` when you need
  valibot's issue shape.
- The classifier reads valibot's public schema tree and the peer range is
  pinned to valibot 1; the differential suite is the tripwire for internals
  moving.
- Async schemas are not supported; `safeParse` is synchronous, as in valibot.

## Standard Schema

The compiled object implements Standard Schema V1, so anything that accepts a
standard schema runs the fast path without knowing either library.

## License

MIT
