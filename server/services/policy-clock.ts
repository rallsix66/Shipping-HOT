import process from "node:process"

/**
 * Clock for policy effective-date evaluation. TEST_NOW (ISO timestamp) is honoured ONLY when SHIPPING_TEST_CLOCK=1,
 * so a stray TEST_NOW cannot shift a normal run. Responses report which clock was used.
 */
export function policyClock(): { now: Date, clock: "test" | "system" } {
  if (process.env.SHIPPING_TEST_CLOCK === "1" && process.env.TEST_NOW) {
    const d = new Date(process.env.TEST_NOW)
    if (!Number.isNaN(d.getTime())) return { now: d, clock: "test" }
  }
  return { now: new Date(), clock: "system" }
}
