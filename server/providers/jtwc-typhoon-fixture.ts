/** JTWC fallback — fixture-only in R1.5-1; runtime remains disabled until separately approved. */

export function parseJtwcFixtureRss(xml: string): Array<{ id: string, title: string }> {
  if (!xml.includes("<item")) return []
  const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map(match => match[1]?.trim()).filter(Boolean)
  return titles.map((title, index) => ({ id: `jtwc-fixture-${index + 1}`, title: title! }))
}
