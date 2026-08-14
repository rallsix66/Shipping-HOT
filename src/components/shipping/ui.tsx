import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { type ReactNode, useEffect, useRef } from "react"

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

/** 鼠标跟随聚光卡片（reactbits Spotlight Card），CSS 变量 --spot-x/--spot-y 驱动径向高光。 */
export function SpotlightCard({ children, className = "" }: { children: ReactNode, className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className={`spotlight-card ${className}`}
      onMouseMove={(event) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        el.style.setProperty("--spot-x", `${event.clientX - rect.left}px`)
        el.style.setProperty("--spot-y", `${event.clientY - rect.top}px`)
      }}
    >
      <span aria-hidden className="spotlight-glow" />
      {children}
    </div>
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

/** 区块标题：eyebrow 渐变短横线 + 标题 + 描述 + 右侧扩展区。 */
export function SectionHeading({ eyebrow, title, description, right }: { eyebrow?: string, title: string, description?: string, right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
            <span className="h-px w-8 bg-gradient-to-r from-teal-400 to-transparent" />
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm op-75 md:text-base">{description}</p>}
      </div>
      {right}
    </div>
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
