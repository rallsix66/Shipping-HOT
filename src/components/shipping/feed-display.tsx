import type { FeedItemDisplay } from "@shared/shipping"

const translatedDisplayStates = new Set(["translated", "historical"])

/** Feed-only translated display. Original Feed facts remain in the same DTO. */
export function FeedItemDisplayText({ item }: { item: FeedItemDisplay }) {
  const titleTranslated = translatedDisplayStates.has(item.translation.title)
  const summaryTranslated = translatedDisplayStates.has(item.translation.summary)
  const hasTranslation = titleTranslated || summaryTranslated
  const isPending = item.translation.title === "pending" || item.translation.summary === "pending"
  const isUnavailable = item.translation.title === "unavailable" || item.translation.summary === "unavailable"
  return (
    <div className="feed-display-text">
      <div className="tl-title-row">
        <h4>{item.displayTitle || item.title}</h4>
        <a className="src-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
          打开来源
          <span className="i-ph-arrow-up-right" />
        </a>
      </div>
      <p className="tl-sum">{item.displaySummary || item.summary}</p>
      {(hasTranslation || isPending || isUnavailable) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {hasTranslation && <span className="chip">中文译文</span>}
          {isPending && <span className="chip">翻译中</span>}
          {isUnavailable && !isPending && <span className="chip">暂未翻译</span>}
          {hasTranslation && (
            <details className="feed-original">
              <summary>查看原文</summary>
              <div className="mt-2 space-y-1 rounded-md border border-white/10 p-2 text-sm">
                <p>
                  <strong>标题：</strong>
                  {item.title}
                </p>
                <p>
                  <strong>摘要：</strong>
                  {item.summary}
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
