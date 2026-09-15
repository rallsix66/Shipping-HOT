import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { useEffect } from "react"
import { useMedia } from "react-use"

/**
 * 动效偏好：默认跟随系统 prefers-reduced-motion，用户可在顶栏显式覆盖。
 * 关闭后停止重绘类动效（Aurora 背景逐帧动画、跑马灯、呼吸点光环）。
 * 只存 localStorage，不写入服务端设置。
 *
 * 三态设计：`null` = 未覆盖（跟随系统），`true`/`false` = 用户显式选择。
 * 若只用「用户开关 OR 系统偏好」，系统开启 reduce-motion 时顶栏按钮会变成死按钮
 * （点来点去都是关闭），所以用户选择必须能反过来覆盖系统偏好。
 *
 * `getOnInit` 让首帧就按已保存的选择执行，否则首屏仍会创建 WebGL 上下文并画几帧。
 */
const reduceMotionAtom = atomWithStorage<boolean | null>("sh-reduce-motion", null, undefined, { getOnInit: true })

export function useReduceMotion() {
  const [override, setOverride] = useAtom(reduceMotionAtom)
  const systemReduced = useMedia("(prefers-reduced-motion: reduce)")
  const reduced = override ?? systemReduced

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduced)
  }, [reduced])

  return {
    reduced,
    systemReduced,
    toggle: () => setOverride(current => !(current ?? systemReduced)),
  }
}
