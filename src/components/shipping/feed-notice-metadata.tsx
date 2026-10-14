import type { FeedItem } from "@shared/shipping"
import { formatDate, statusBadgePresentation } from "./format"

/** Existing persisted facts only: receipt time is never promoted to publication time. */
export function FeedNoticeMetadata({ item }: { item: FeedItem }) {
  const source = statusBadgePresentation({ stale: item.stale, sourceStatus: item.sourceStatus })
  const received = item.weather?.timeBasis === "received_at"
  const publicationUnknown = item.publicationTimeKnown === false || !item.publishedAt || received
  return (
    <div className="tl-chips" data-testid="port-notice-metadata">
      <span className={`status-badge status-${source.className}`}>{source.label}</span>
      {item.stale && <span className="chip">缓存已过期</span>}
      <span className="tl-time">{publicationUnknown ? "发布时间未知" : `发布时间 ${formatDate(item.publishedAt)}`}</span>
      {received && item.publishedAt && <span className="chip">{`首次接收 ${formatDate(item.publishedAt)}（非发布时间）`}</span>}
      {item.weather?.alertState && <span className="chip">{`预警状态：${item.weather.alertState === "active" ? "生效" : item.weather.alertState === "expired" ? "已过期" : "未知"}`}</span>}
      {item.weather?.validityStatus === "unknown" && <span className="chip">有效性待确认</span>}
      {item.weather?.lifecycleStatus === "unknown" && <span className="chip">生命周期未知</span>}
      {item.weather?.alertExpiresAt && <span className="chip">{`截至 ${formatDate(item.weather.alertExpiresAt)}`}</span>}
    </div>
  )
}
