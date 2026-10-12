import type { Database } from "db0"

export const opsWeatherCalendarPolicyMigration = {
  version: 15,
  name: "ops-weather-calendar-policy",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS weather_forecast (
        id TEXT PRIMARY KEY,
        port_id TEXT NOT NULL,
        unlocode TEXT NULL,
        forecast_at TEXT NOT NULL,
        horizon TEXT NOT NULL,
        wave_height_m REAL NULL,
        swell_wave_height_m REAL NULL,
        wind_speed_kmh REAL NULL,
        wind_gust_kmh REAL NULL,
        precipitation_mm REAL NULL,
        visibility_m REAL NULL,
        source_id TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        payload_json TEXT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_weather_forecast_port ON weather_forecast(port_id, forecast_at)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS weather_impact (
        id TEXT PRIMARY KEY,
        port_id TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        impact_object TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        input_values_json TEXT NOT NULL,
        provenance TEXT NOT NULL,
        summary_zh TEXT NOT NULL,
        computed_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_weather_impact_port ON weather_impact(port_id, valid_from)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS tropical_cyclone (
        id TEXT PRIMARY KEY,
        basin TEXT NOT NULL,
        name TEXT NULL,
        jma_id TEXT NULL,
        track_json TEXT NOT NULL,
        forecast_json TEXT NULL,
        source_id TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        dissipated_at TEXT NULL
      )
    `)

    await db.exec(`
      CREATE TABLE IF NOT EXISTS ops_calendar_event (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NULL,
        category TEXT NOT NULL,
        basis_kind TEXT NOT NULL,
        basis_ref TEXT NULL,
        confirmation_status TEXT NOT NULL,
        rule_id TEXT NULL,
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_ops_calendar_country ON ops_calendar_event(country_code, starts_at)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS policy_record (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        country_code TEXT NOT NULL,
        platform TEXT NULL,
        title TEXT NOT NULL,
        document_number TEXT NULL,
        publisher TEXT NULL,
        published_at TEXT NULL,
        effective_at TEXT NULL,
        expires_at TEXT NULL,
        status TEXT NOT NULL,
        scope_text TEXT NULL,
        source_url TEXT NOT NULL,
        entry_method TEXT NOT NULL,
        entered_by TEXT NOT NULL,
        current_version_id TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_policy_record_lookup ON policy_record(country_code, category, status)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS policy_version (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body_excerpt TEXT NULL,
        effective_at TEXT NULL,
        status TEXT NOT NULL,
        change_summary TEXT NULL,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        superseded_by_version_id TEXT NULL,
        UNIQUE (policy_id, version_number)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_policy_version_policy ON policy_version(policy_id, version_number)")
  },
} as const
