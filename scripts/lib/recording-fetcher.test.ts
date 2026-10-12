import { describe, expect, it } from "vitest"
import { type FetchLike, type RecordedRequest, createRecordingFetcher } from "./recording-fetcher"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "#/providers/weather-alerts"

const tmd = officialWeatherAlertSources.find(source => source.id === "tmd")!
const BODY = "https://www.tmd.go.th/uploads/CAP/en/CAPTMD1_2.xml"

describe("recording fetcher used by the TMD isolated live probe", () => {
  it("passes RequestInit through, adds a timeout signal and preserves url/redirected", async () => {
    const seen: Parameters<FetchLike>[1][] = []
    const fake: FetchLike = async (url, init) => {
      seen.push(init)
      return { ok: true, status: 200, url: `${url}#final`, redirected: true, text: async () => "body" }
    }
    const log: RecordedRequest[] = []
    const fetcher = createRecordingFetcher(fake, log, 1000, () => new Date("2026-10-10T00:00:00Z"))
    const response = await fetcher(BODY, { redirect: "error" })
    expect(seen[0].redirect).toBe("error")
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
    expect(response).toMatchObject({ ok: true, status: 200, url: `${BODY}#final`, redirected: true })
    expect(await response.text()).toBe("body")
    expect(log).toEqual([{ url: BODY, requestedRedirect: "error", status: 200, finalUrl: `${BODY}#final`, redirected: true, bytes: 4, at: "2026-10-10T00:00:00.000Z" }])
  })

  it("records the fetch default when the caller sets no redirect policy", async () => {
    const log: RecordedRequest[] = []
    const fetcher = createRecordingFetcher(async url => ({ ok: true, status: 200, url, redirected: false, text: async () => "" }), log)
    await fetcher(tmd.url)
    expect(log[0]).toMatchObject({ requestedRedirect: "follow (fetch default)", redirected: false, finalUrl: tmd.url })
  })

  it("logs and rethrows fetch errors (e.g. fetch rejecting a redirect under redirect=error)", async () => {
    const log: RecordedRequest[] = []
    const fetcher = createRecordingFetcher(async () => {
      throw new TypeError("fetch failed: redirect mode is set to error")
    }, log)
    await expect(fetcher(BODY, { redirect: "error" })).rejects.toThrow(/redirect/)
    expect(log[0]).toMatchObject({ url: BODY, requestedRedirect: "error", error: expect.stringMatching(/redirect/) })
  })

  it("through the real provider: bodies are requested with redirect=error and a followed redirect is rejected", async () => {
    const log: RecordedRequest[] = []
    const index = `<rss version="2.0"><channel><item><title>x</title><link>${BODY}</link></item></channel></rss>`
    const fake: FetchLike = async (url, init) => url === tmd.url
      ? { ok: true, status: 200, url, redirected: false, text: async () => index }
      : { ok: true, status: 200, url: init.redirect === "error" ? "https://evil.example/CAP.xml" : url, redirected: true, text: async () => "<alert/>" }
    const provider = createOfficialWeatherAlertProvider({ sources: [tmd], fetcher: createRecordingFetcher(fake, log), throwOnSourceFailureWithoutLastKnown: true, now: () => new Date("2026-10-10T00:00:00Z") })
    await expect(provider.getFeedItems([], [])).rejects.toThrow(/redirect/)
    expect(log.map(entry => [entry.url, entry.requestedRedirect])).toEqual([[tmd.url, "follow (fetch default)"], [BODY, "error"]])
  })
})
