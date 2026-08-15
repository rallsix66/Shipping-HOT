import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { type ReactNode, useEffect } from "react"
import type { DataProvenance } from "@shared/shipping"
import { formatProvenance } from "./format"

/** 滚动进入视口时的渐显 + 上移动画（reactbits / motionsites 风格 reveal）。 */
export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode, delay?: number, y?: number, className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** 渐变文字（品牌标题、关键词）。 */
export function GradientText({ children }: { children: ReactNode }) {
  return <span className="gradient-text">{children}</span>
}

/** 数字滚动动画（useSpring 缓动计数）。 */
export function AnimatedNumber({ value, className }: { value: number, className?: string }) {
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { duration: 1400, bounce: 0 })
  const display = useTransform(spring, v => Math.round(v).toLocaleString("zh-CN"))
  useEffect(() => {
    motionValue.set(value)
  }, [motionValue, value])
  return <motion.span className={className}>{display}</motion.span>
}

/** 状态圆点：fresh/watch/failed/info/dim，可选呼吸光环。 */
export function StatusDot({ tone, pulse = false }: { tone: "fresh" | "watch" | "failed" | "info" | "dim", pulse?: boolean }) {
  return <span className={`status-dot ${tone}${pulse ? " pulse" : ""}`} />
}

/** 玻璃小徽章，展示 provider 名称。 */
export function ProviderChip({ label, value, tone }: { label: string, value: string, tone?: "fresh" | "watch" | "failed" | "info" | "dim" }) {
  return (
    <span className="chip">
      {tone && <StatusDot tone={tone} />}
      <span className="op-70">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  )
}

export function ProvenanceBadge({ provenance }: { provenance?: DataProvenance }) {
  const isMock = provenance?.sourceType === "mock"
  return (
    <span className={`provenance-badge ${isMock ? "mock" : ""}`} title={formatProvenance(provenance)}>
      <StatusDot tone={isMock ? "dim" : provenance?.sourceType === "third_party" ? "info" : provenance ? "fresh" : "dim"} />
      {isMock ? "模拟数据" : formatProvenance(provenance)}
    </span>
  )
}

/** 胶囊分段选择器：layoutId 渐变滑片 + 弹簧过渡。 */
export function Segmented<T extends string>({ id, options, value, onChange }: { id: string, options: { value: T, label: string }[], value: T, onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {options.map(option => (
        <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
          {value === option.value && (
            <motion.span layoutId={`segmented-pill-${id}`} className="segmented-pill" transition={{ type: "spring", bounce: 0.22, duration: 0.5 }} />
          )}
          <span className="segmented-label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

/** 无缝跑马灯：内容渲染两份，translateX(-50%) 循环，悬停暂停。 */
export function Marquee({ children }: { children: ReactNode }) {
  return (
    <div className="marquee">
      <div className="marquee-track">
        <div className="marquee-half">{children}</div>
        <div aria-hidden className="marquee-half">{children}</div>
      </div>
    </div>
  )
}

/** 空状态占位。 */
export function EmptyState({ icon = "i-ph-waves", text }: { icon?: string, text: string }) {
  return (
    <div className="empty-state">
      <span className={`${icon} text-2xl`} />
      <p className="text-sm">{text}</p>
    </div>
  )
}
