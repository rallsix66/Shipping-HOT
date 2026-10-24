/** Hand-built synthetic markup using retained URL/date facts; not archived original HTML. */
export function syntheticNorthportPair(url: string, rows: { title: string, date: string, href?: string }[]): string {
  return `<div class="div-article-main2"><div class="release-grid2">${rows.map(row => `<article class="card2"><a href="${row.href ?? url}">${row.date} ${row.title}</a></article>`).join("")}</div></div>`
}
