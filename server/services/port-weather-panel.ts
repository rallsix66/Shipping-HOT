import type { FeedItem, PortWeatherPanelResponse } from "@shared/shipping"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import type { ShippingRepository } from "#/database/shipping"

export async function getPortWeatherPanel(
  repository: ShippingRepository,
  portId: string,
  feedItems: FeedItem[],
  forecastSourceLabel: string,
  alertsSourceLabel: string,
): Promise<PortWeatherPanelResponse> {
  const forecasts = await repository.listWeatherForecastsForPort(portId)
  const impacts = await repository.listWeatherImpactsForPort(portId)
  const officialAlerts = feedItems
    .filter(item => isOfficialWeatherAlertFeedItem(item) && item.relatedPortIds.includes(portId))
    .slice(0, 6)
    .map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      publishedAt: item.publishedAt,
      sourceId: item.sourceId,
      provenance: item.provenance,
    }))
  return {
    portId,
    forecasts,
    impacts,
    officialAlerts,
    sources: {
      forecast: forecasts.length ? forecastSourceLabel : "暂无持久化预报",
      impacts: "system",
      alerts: officialAlerts.length ? alertsSourceLabel : "未启用或未命中官方预警",
    },
  }
}
