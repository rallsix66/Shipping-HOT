import type { QualifiedPortClosureReplayEvent } from "@shared/weather-impact"

/**
 * R1.5-4 qualified replay corpus — **empty until each row is independently verified**
 * (official closure window + traceable weather inputs with unit/location/time).
 * Do not label candidate rows as qualified without audit.
 */
export const qualifiedPortClosureReplayEvents: readonly QualifiedPortClosureReplayEvent[] = []

export const R1_5_4_REQUIRED_QUALIFIED_SAMPLES = 10
