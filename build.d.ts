import type { GenericSchema } from 'valibot'

export interface CompileToModuleOptions {
  /** Module format of the emitted source. Default 'esm'. */
  format?: 'esm' | 'cjs'
}

export interface CanCompileResult {
  /** Whether the schema converts exactly and can be compiled. */
  ok: boolean
  mode: 'ata' | 'hybrid' | 'valibot'
  /** Why not, when it cannot. */
  reasons: string[]
}

export declare class NotExactError extends Error {
  name: 'NotExactError'
  mode: 'hybrid' | 'valibot'
  reasons: string[]
}

/**
 * Compile a valibot schema to standalone module source that imports nothing,
 * not valibot and not ata. The module exports `isValid(data)` and
 * `validate(data)`.
 *
 * Only schemas the classifier calls exact can be compiled; anything valibot
 * checks at runtime throws NotExactError rather than being silently dropped.
 *
 * Emitting needs code generation, so run this at build time in Node. What it
 * emits is plain code and runs anywhere, including under a strict CSP.
 */
export declare function compileToModule(schema: GenericSchema, opts?: CompileToModuleOptions): string

/** Whether a schema can be compiled ahead of time, and why not when it cannot. */
export declare function canCompile(schema: GenericSchema): CanCompileResult

/** Whether this runtime allows the code generation the emitter needs. */
export declare function codegenAvailable(): boolean
