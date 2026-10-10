export declare const ADR009_CONCLUSION_ZH: string
export declare const REFERENCE_SOURCE_ID: string
export declare const REFERENCE_NAME_ZH: string
export interface Adr009Check {
  id: string
  pass: boolean
  detail: string
}
export declare function evaluateAdr009Mapping(input: {
  refKey: string
  syncNowMs: number
  apiNowMs: number
  refSqliteRows?: unknown[]
  apiRef?: Record<string, any>
  apiRefRows?: Record<string, any>[]
  apiPortRows?: Record<string, any>[]
  apiPortMeta?: Record<string, any>
  browserChecks?: { id: string, pass: boolean, detail?: string }[]
}): { checks: Adr009Check[], pass: boolean, originMarineAvailable: boolean, sqlite: unknown, api: unknown }
