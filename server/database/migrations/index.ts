import type { Database } from "db0"
import { p0FoundationMigration } from "#/database/migrations/001-p0-foundation"
import { watchlistIsolationMigration } from "#/database/migrations/002-watchlist-isolation"
import { p1aPortDirectoryMigration } from "#/database/migrations/003-p1a-port-directory"
import { p1bMockIsolationMigration } from "#/database/migrations/004-p1b-mock-isolation"
import { p2aSearchFoundationMigration } from "#/database/migrations/005-p2a-search-foundation"
import { p2cRuntimeFoundationMigration } from "#/database/migrations/006-p2c-runtime-foundation"
import { p3aAisTrackingMigration } from "#/database/migrations/007-p3a-ais-tracking"
import { p3bVoyageEtaMigration } from "#/database/migrations/008-p3b-voyage-eta"
import { p3FeedFreshnessMigration } from "#/database/migrations/009-p3-feed-freshness"
import { p3FeedFreshnessReclassificationMigration } from "#/database/migrations/010-p3-feed-freshness-reclassification"
import { providerUsageRecordsMigration } from "#/database/migrations/011-provider-usage-records"
import { translationRuntimeWorkStateMigration } from "#/database/migrations/012-translation-runtime-work-state"
import { articleContentMigration } from "#/database/migrations/013-article-content"
import { retireVesselVoyageMigration } from "#/database/migrations/014-retire-vessel-voyage"
import { opsWeatherCalendarPolicyMigration } from "#/database/migrations/015-ops-weather-calendar-policy"

export interface ShippingMigration {
  readonly version: number
  readonly name: string
  up: (db: Database) => Promise<void>
}

// Ordered migration chain. Historical migrations (001–013) are retained as the
// record of how retained databases reached schema v13; migration 014 archives
// the vessel/voyage/AIS tables with a `_retired_` prefix (ADR-006, plan §6 R1).
export const shippingMigrations: readonly ShippingMigration[] = [
  p0FoundationMigration,
  watchlistIsolationMigration,
  p1aPortDirectoryMigration,
  p1bMockIsolationMigration,
  p2aSearchFoundationMigration,
  p2cRuntimeFoundationMigration,
  p3aAisTrackingMigration,
  p3bVoyageEtaMigration,
  p3FeedFreshnessMigration,
  p3FeedFreshnessReclassificationMigration,
  providerUsageRecordsMigration,
  translationRuntimeWorkStateMigration,
  articleContentMigration,
  retireVesselVoyageMigration,
  opsWeatherCalendarPolicyMigration,
]

export const latestShippingSchemaVersion = shippingMigrations[shippingMigrations.length - 1].version
