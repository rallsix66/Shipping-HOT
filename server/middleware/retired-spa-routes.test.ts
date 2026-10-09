import { createEvent } from "h3"
import { describe, expect, it } from "vitest"
import retiredSpaRoutes from "./retired-spa-routes"

function makeEvent(method: string, url: string) {
  const req = { method, url, headers: {} } as never
  const res = {
    setHeader: () => {},
    end: () => {},
    writableEnded: false,
    headersSent: false,
  } as never
  return createEvent(req, res)
}

function call(method: string, url: string) {
  const event = makeEvent(method, url)
  return Promise.resolve().then(() => retiredSpaRoutes(event as never))
}

describe("retired SPA routes middleware", () => {
  it.each([
    "/vessels",
    "/vessels/example-id",
    "/voyages",
    "/voyages/example-id",
  ])("returns 404 for GET %s", async (path) => {
    await expect(call("GET", path)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("allows active routes through", async () => {
    await expect(call("GET", "/ports")).resolves.toBeUndefined()
    await expect(call("GET", "/")).resolves.toBeUndefined()
  })
})
