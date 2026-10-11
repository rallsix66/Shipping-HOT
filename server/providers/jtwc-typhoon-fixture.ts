/** JTWC fallback — fixture-only in R1.5-1; runtime remains disabled until separately approved. */

export function parseJtwcFixtureRss(xml: string): Array<{ id: string, title: string }> {
  const items = [...xml.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)]
  return items.map((match, index) => ({ id: `jtwc-fixture-${index + 1}`, title: match[1]!.trim() }))
}
