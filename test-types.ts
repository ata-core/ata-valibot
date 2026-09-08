// Types must carry from the valibot schema through the compiled surface.
import * as v from 'valibot';
import { compile, analyze } from './index.js';

const user = v.object({
  id: v.pipe(v.number(), v.integer()),
  name: v.string(),
  role: v.optional(v.picklist(['admin', 'user']), 'user'),
});

const check = compile(user);

const b: boolean = check.isValid({});
const bb: boolean = check.isValidBytes('{}');
const r = check.safeParse({});
if (r.success) {
  const role: 'admin' | 'user' = r.output.role;
  const id: number = r.output.id;
  void role; void id;
} else {
  const msg: string = r.issues[0].message;
  void msg;
}

const p = check.parse({});
const name: string = p.name;
void name; void b; void bb;

const a = analyze(user);
const mode: 'ata' | 'hybrid' | 'valibot' = a.mode;
void mode;
