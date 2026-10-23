/** Default-off policy constants for DeepSeek Tools Search/Fetch (slice-1 offline). */
export const DEEPSEEK_SEARCH_FETCH_PROVIDER_ID = "deepseek" as const
export const DEEPSEEK_SEARCH_CAPABILITY = "deepseek_search" as const
export const DEEPSEEK_FETCH_CAPABILITY = "deepseek_fetch" as const
export const DEEPSEEK_SEARCH_FETCH_CURRENCY = "CNY" as const
/** 5 CNY / 1000 billable calls → 0.005 CNY per billable success. */
export const DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY = 0.005 as const
/**
 * Cache / identity policy version — bump when request normalization or trim rules change.
 * v1.2: fixed transport error codes; targetReview bound to input.url; pre-send cancel non-billing;
 * typed-error whitelist remap (no instanceof passthrough of message/cause).
 */
export const DEEPSEEK_SEARCH_FETCH_POLICY_VERSION = "ds-sf-v1.2-2026-10-23" as const
/** Product default: Search need_content=false. */
export const DEEPSEEK_SEARCH_DEFAULT_NEED_CONTENT = false as const
export const DEEPSEEK_SEARCH_DEFAULT_COUNT = 10 as const
/**
 * Default AbortSignal deadline for the outbound HTTP call (ms).
 * Does not bound secretStore.get / DB claim (paidRequest still reads key then reserves).
 * Does not change global receipt semantics.
 */
export const DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS = 25_000 as const
/** Hard cap when reading Search/Fetch HTTP bodies (bytes, UTF-8). */
export const DEEPSEEK_SEARCH_FETCH_MAX_RESPONSE_BYTES = 524_288 as const
