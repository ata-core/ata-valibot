import type { BaseIssue, GenericSchema, InferInput, InferOutput, ValiError } from 'valibot'

/** How a schema was classified, and why. */
export interface Analysis {
  /**
   * 'ata': the JSON Schema conversion is exact and ata answers alone.
   * 'hybrid': the conversion is provably looser (transforms, checks, formats,
   * native types), so ata's rejections are final and valibot confirms the
   * acceptances.
   * 'valibot': a feature makes valibot accept what the converted schema
   * rejects (fallback, records over arrays, async) or a node is unknown;
   * valibot answers.
   */
  mode: 'ata' | 'hybrid' | 'valibot'
  /** The nodes that forced the mode, first eight. */
  reasons: string[]
  /** Whether parsing can return a value that differs from the input. */
  producesValue: boolean
}

export type SafeParseResult<S extends GenericSchema> =
  | { typed: true; success: true; output: InferOutput<S>; issues?: undefined }
  | { typed: boolean; success: false; output: unknown; issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]] }

export interface CompiledValibot<S extends GenericSchema> {
  /** The verdict, at ata speed where the classification allows it. */
  isValid(data: unknown): boolean
  /**
   * Verdict on raw bytes or a JSON string. An engine:'ata' schema with no
   * number constraints is decided without JSON.parse when the native engine
   * is present; other schemas and pure-JS installs parse first. Bytes that
   * are not JSON return false.
   */
  isValidBytes(input: Uint8Array | string): boolean
  /** valibot-shaped result. Accepted values run valibot, so `output` is
   * exactly what valibot returns (unknown keys stripped, defaults filled,
   * transforms applied). Rejections are decided by ata; the issues are built
   * on first read. */
  safeParse(data: unknown): SafeParseResult<S>
  /** Like safeParse but throwing the ValiError. */
  parse(data: unknown): InferOutput<S>
  /** ata's error report for the schema-representable part; valibot's issues
   * where only valibot knows why. */
  validate(data: unknown): { valid: true; data: unknown } | { valid: false; errors: unknown[] }
  /** The emitted JSON Schema, or null in valibot mode. */
  schema: object | null
  /** The original valibot schema. */
  valibotSchema: S
  /** Which mode the classification chose. */
  engine: 'ata' | 'hybrid' | 'valibot'
  /** Why, first eight reasons. */
  reasons: string[]
  /** Standard Schema V1. */
  '~standard': {
    version: 1
    vendor: 'ata-valibot'
    validate(value: unknown):
      | { value: InferOutput<S> }
      | { issues: Array<{ message: string; path?: Array<PropertyKey> }> }
  }
}

export interface CompileOptions {
  /** Options forwarded to the ata Validator (formats stay unasserted). */
  validator?: object
}

export declare function compile<S extends GenericSchema>(schema: S, opts?: CompileOptions): CompiledValibot<S>
export declare function analyze(schema: unknown): Analysis
export declare function toJSONSchema(schema: GenericSchema): object
export type { InferInput, InferOutput, ValiError }
