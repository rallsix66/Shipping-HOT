import type { Database } from "db0"
import type { PortDirectoryRecord } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"
import { PortDirectoryRepository } from "#/database/port-directory"

export interface PortSearchProvider {
  searchPorts: (query: string, limit?: number) => Promise<PortDirectoryRecord[]>
}

export class PortSearchService implements PortSearchProvider {
  constructor(private readonly repository: PortDirectoryRepository) {}

  searchPorts(query = "", limit = 50): Promise<PortDirectoryRecord[]> {
    return this.repository.searchPorts(query, limit)
  }
}

export function createPortSearchService(db: Database, dataMode: ShippingDataMode): PortSearchService {
  return new PortSearchService(new PortDirectoryRepository(db, dataMode))
}
