export type PortDirectorySource = "unlocode" | "official" | "manual" | "mock"

export interface PortDirectoryCoordinate {
  latitude: number
  longitude: number
}

export interface PortDirectoryRecord extends PortDirectoryCoordinate {
  unlocode: string
  nameEn: string
  nameZh: string
  countryCode: string
  timezone: string
  aliases: string[]
  source: PortDirectorySource
  verifiedAt?: string
  isActive: boolean
}

export interface PortDirectoryCoordinateLookup {
  getPortCoordinate: (unlocode: string) => Promise<PortDirectoryCoordinate | undefined>
}

interface PortDirectorySeedRecord extends PortDirectoryRecord {
  shippingPortId: string
}

/**
 * The first P1A baseline. Runtime reads come from SQLite after migration;
 * this shared list is only the migration/test input and pure-function fallback.
 */
export const portDirectoryBaseline: readonly PortDirectorySeedRecord[] = [
  {
    shippingPortId: "port-shekou",
    unlocode: "CNSHK",
    nameEn: "Shekou",
    nameZh: "蛇口",
    countryCode: "CN",
    latitude: 22.48,
    longitude: 113.91,
    timezone: "Asia/Shanghai",
    aliases: ["Shekou", "蛇口", "蛇口港", "CNSHK"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-yantian",
    unlocode: "CNYTN",
    nameEn: "Yantian",
    nameZh: "盐田",
    countryCode: "CN",
    latitude: 22.58,
    longitude: 114.27,
    timezone: "Asia/Shanghai",
    aliases: ["Yantian", "盐田", "盐田港", "CNYTN"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-nansha",
    unlocode: "CNNSA",
    nameEn: "Nansha",
    nameZh: "南沙",
    countryCode: "CN",
    latitude: 22.64,
    longitude: 113.66,
    timezone: "Asia/Shanghai",
    aliases: ["Nansha", "南沙", "南沙港", "CNNSA"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-laem-chabang",
    unlocode: "THLCH",
    nameEn: "Laem Chabang",
    nameZh: "林查班",
    countryCode: "TH",
    latitude: 13.08,
    longitude: 100.88,
    timezone: "Asia/Bangkok",
    aliases: ["Laem Chabang", "林查班", "林查班港", "THLCH"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-klang",
    unlocode: "MYPKG",
    nameEn: "Port Klang",
    nameZh: "巴生港",
    countryCode: "MY",
    latitude: 3,
    longitude: 101.4,
    timezone: "Asia/Kuala_Lumpur",
    aliases: ["Port Klang", "巴生港", "巴生", "MYPKG"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-manila",
    unlocode: "PHMNL",
    nameEn: "Manila",
    nameZh: "马尼拉",
    countryCode: "PH",
    latitude: 14.6,
    longitude: 120.95,
    timezone: "Asia/Manila",
    aliases: ["Manila", "马尼拉", "马尼拉港", "PHMNL"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-jakarta",
    unlocode: "IDJKT",
    nameEn: "Jakarta",
    nameZh: "雅加达",
    countryCode: "ID",
    latitude: -6.1,
    longitude: 106.88,
    timezone: "Asia/Jakarta",
    aliases: ["Jakarta", "雅加达", "丹戎不碌", "Tanjung Priok", "IDJKT"],
    source: "unlocode",
    isActive: true,
  },
  {
    shippingPortId: "port-ho-chi-minh",
    unlocode: "VNSGN",
    nameEn: "Ho Chi Minh City",
    nameZh: "胡志明市",
    countryCode: "VN",
    latitude: 10.77,
    longitude: 106.75,
    timezone: "Asia/Ho_Chi_Minh",
    aliases: ["Ho Chi Minh", "Ho Chi Minh City", "胡志明市", "西贡港", "VNSGN"],
    source: "unlocode",
    isActive: true,
  },
] as const

export function createBaselinePortDirectoryLookup(): PortDirectoryCoordinateLookup {
  const coordinates = new Map(portDirectoryBaseline.map(port => [port.unlocode, { latitude: port.latitude, longitude: port.longitude }]))
  return {
    async getPortCoordinate(unlocode) {
      return coordinates.get(unlocode.trim().toUpperCase())
    },
  }
}
