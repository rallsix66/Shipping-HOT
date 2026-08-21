import type { Database } from "db0"
import { portDirectoryBaseline } from "../../../shared/port-directory"

export const p1aPortDirectoryMigration = {
  version: 3,
  name: "p1a-port-directory-foundation",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS port_directory (
        unlocode TEXT PRIMARY KEY,
        name_en TEXT NOT NULL,
        name_zh TEXT NOT NULL,
        country_code TEXT NOT NULL,
        latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
        longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
        timezone TEXT NOT NULL,
        aliases TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('unlocode', 'official', 'manual', 'mock')),
        verified_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_port_directory_name_en ON port_directory(name_en);
      CREATE INDEX IF NOT EXISTS idx_port_directory_country ON port_directory(country_code);
      CREATE INDEX IF NOT EXISTS idx_port_directory_active_source ON port_directory(is_active, source);
    `)

    for (const port of portDirectoryBaseline) {
      await db.prepare(`
        INSERT INTO port_directory (
          unlocode, name_en, name_zh, country_code, latitude, longitude,
          timezone, aliases, source, verified_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unlocode) DO UPDATE SET
          name_en = excluded.name_en,
          name_zh = excluded.name_zh,
          country_code = excluded.country_code,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          timezone = excluded.timezone,
          aliases = excluded.aliases,
          source = excluded.source,
          verified_at = excluded.verified_at,
          is_active = excluded.is_active
      `).run(
        port.unlocode,
        port.nameEn,
        port.nameZh,
        port.countryCode,
        port.latitude,
        port.longitude,
        port.timezone,
        JSON.stringify(port.aliases),
        port.source,
        port.verifiedAt ?? null,
        port.isActive ? 1 : 0,
      )
    }

    await db.prepare(`
      INSERT INTO port_directory_status (id, port_directory_status, port_directory_version, port_directory_imported_at)
      VALUES ('default', 'ready', 'p1a-unlocode-baseline-v1', ?)
      ON CONFLICT(id) DO UPDATE SET
        port_directory_status = excluded.port_directory_status,
        port_directory_version = excluded.port_directory_version,
        port_directory_imported_at = excluded.port_directory_imported_at
    `).run(new Date().toISOString())
  },
} as const
