// SYNTHETIC XX-K02 fixture authored 2026-10-22 to match the existing jsonList config shape
// (inert script#__NEXT_DATA__ application/json, props.pageProps.pinArticle + articles, aliasUrl, releaseDate).
// It is NOT the saved ONE raw page and NOT the generic #payload/page.pin sample; titles/paths are invented.
// The trailing executable script must never run.
export const ONE_NEWSROOM_SYNTHETIC = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      pinArticle: { title: "Synthetic ONE pinned notice", aliasUrl: "/newsroom/synthetic-pinned", releaseDate: "2026-10-05T11:31:17" },
      articles: [
        { title: "Synthetic ONE listed notice", aliasUrl: "/newsroom/synthetic-listed", releaseDate: "2026-09-30T15:06:44" },
        { title: "Synthetic ONE leap notice", aliasUrl: "/newsroom/synthetic-leap", releaseDate: "2024-02-29T09:00:00" },
      ],
    },
  },
})}</script><script>throw new Error("synthetic executable script must not run")</script></head><body></body></html>`
