/**
 * Production allow-select catalog IDs (phase). Independent of registry registration:
 * being in registeredIntelSources does not grant production permission.
 * Old two keep their own license contracts; new seventeen stay persistence=disallowed until separately enabled.
 * Phase exclusions (not permanent): CN-T01, XX-M01. MY-P03 is not in this set.
 *
 * This module is intentionally side-effect free so the observation child can validate
 * source ids before any application, DNS, registry or Provider module loads.
 */
export const PRODUCTION_ALLOW_SELECT_CATALOG_IDS = [
  // original production pair
  "TH-W01",
  "ID-W01",
  // phase-new seventeen (allow-select != enable; keep disallowed on shared candidates)
  "CN-T02",
  "TH-C01",
  "PH-C01",
  "CN-P01",
  "TH-C02",
  "VN-P03",
  "VN-T01",
  "ID-T01",
  "XX-K03",
  "ID-T02",
  "VN-D01",
  "XX-K02",
  "XX-K01",
  "MY-C01",
  "MY-T01",
  "PH-M01",
  "XX-M03",
] as const
