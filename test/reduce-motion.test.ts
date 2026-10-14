import { beforeEach, describe, expect, it, vi } from "vitest"
import { createStore } from "jotai"

const state = vi.hoisted(() => ({ system: false, effects: [] as Array<() => void>, store: undefined as ReturnType<typeof createStore> | undefined }))
vi.mock("react-use", () => ({ useMedia: () => state.system }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => void) => state.effects.push(effect) }))
vi.mock("jotai", async (original) => {
  const actual = await original<typeof import("jotai")>()
  return { ...actual, useAtom: (atom: Parameters<ReturnType<typeof createStore>["get"]>[0]) => [state.store!.get(atom), (update: unknown) => state.store!.set(atom as never, update as never)] }
})

describe("existing motion preference restored by demo shell", () => {
  beforeEach(() => {
    state.system = false
    state.effects = []
    state.store = createStore()
  })
  it("reads a saved choice immediately and persists a new choice under the original key", async () => {
    const values = new Map([["sh-reduce-motion", "true"]])
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
    const { createReduceMotionAtom } = await import("../src/hooks/useReduceMotion")
    const preference = createReduceMotionAtom()
    expect(state.store!.get(preference)).toBe(true)
    state.store!.set(preference, false)
    expect(values.get("sh-reduce-motion")).toBe("false")
    vi.unstubAllGlobals()
  })
  it("maintains the html class and allows the switch to override the system preference", async () => {
    const { useReduceMotion } = await import("../src/hooks/useReduceMotion")
    const toggleClass = vi.fn()
    vi.stubGlobal("document", { documentElement: { classList: { toggle: toggleClass } } })
    state.system = true
    const first = useReduceMotion()
    expect(first.reduced).toBe(true)
    state.effects.splice(0).forEach(effect => effect())
    expect(toggleClass).toHaveBeenLastCalledWith("reduce-motion", true)
    first.toggle()
    const second = useReduceMotion()
    expect(second.reduced).toBe(false)
    state.effects.splice(0).forEach(effect => effect())
    expect(toggleClass).toHaveBeenLastCalledWith("reduce-motion", false)
    second.toggle()
    expect(useReduceMotion().reduced).toBe(true)
    vi.unstubAllGlobals()
  })
})
