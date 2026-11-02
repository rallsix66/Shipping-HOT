import { describe, expect, it } from "vitest"
import { blockedLeaveHref, blockedLeaveTarget, mergeLeaveFromHref } from "@shared/label-leave-target"

describe("blockedLeaveTarget", () => {
  it("preserves pathname, search object, and hash", () => {
    expect(blockedLeaveTarget({
      pathname: "/policies",
      search: { country: "VN" },
      hash: "r38-keep",
    })).toEqual({
      to: "/policies",
      search: { country: "VN" },
      hash: "r38-keep",
    })
    expect(blockedLeaveHref({
      pathname: "/policies",
      search: { country: "VN" },
      hash: "#r38-keep",
    })).toBe("/policies?country=VN#r38-keep")
  })

  it("falls back to home when next is missing", () => {
    expect(blockedLeaveTarget(null)).toEqual({ to: "/", search: undefined, hash: undefined })
    expect(blockedLeaveHref(undefined)).toBe("/")
  })

  it("mergeLeaveFromHref restores hash TanStack blocker strips", () => {
    const merged = mergeLeaveFromHref(
      { pathname: "/policies", search: { country: "VN" } },
      "/policies?country=VN#r38-keep",
    )
    expect(blockedLeaveHref(merged)).toBe("/policies?country=VN#r38-keep")
    expect(blockedLeaveTarget(merged).hash).toBe("r38-keep")
  })
})
