/**
 * AuroraBackground — 参考 shadergradient / 21st.dev 风格的流光渐变背景。
 * 纯 CSS 实现（conic/radial 光斑 + 网格 + 噪点 + 暗角），零新增依赖；
 * prefers-reduced-motion 时由 CSS 自动停用漂移动画。
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="aurora">
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      <div className="aurora-grid" />
      <div className="aurora-noise" />
      <div className="aurora-vignette" />
    </div>
  )
}
