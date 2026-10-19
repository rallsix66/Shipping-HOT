import { parseHTML } from "linkedom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { extractDocument, inertSnapshot } from "../extensions/shipping-hot-clipper/src/extract"

let page: ReturnType<typeof parseHTML>
let attempts = 0
const now = "2026-10-19T07:00:00.000Z"
// Authored prose and numeric identities: no source-site HTML or article text.
const paragraphs = [68, 102, 68, 60, 42].map((length, index) => `${(`第${index + 1}段原创结构测试。${"港口读者正在复核一份虚构说明，正文必须按顺序完整保留。".repeat(6)}`).slice(0, length - 1)}。`)
const prose = paragraphs.join("<br><br>")
const expected = paragraphs.join("\n\n")
const noise = "原创界面资料链接与作者其他消息。".repeat(24)
const post = (id: number, body = prose) => `<div id="post_${id}"><table id="pid${id}" class="plhin"><tbody><tr><td class="plc"><div class="thread_body"><div class="pct"><div class="pcb"><div class="t_fsz"><table><tbody><tr><td id="postmessage_${id}" class="t_f">${body}</td></tr></tbody></table></div></div></div></div></td></tr></tbody></table></div>`
function load(posts = post(101), url = "https://example.org/thread-77-1-1.html") {
  page = parseHTML(`<html><head><title>原创论坛主题</title></head><body id="nv_forum" class="pg_viewthread"><h1 class="ts">原创论坛主题</h1><div>${noise}</div><div id="postlist" class="pl bm pt0 mb0">${posts}</div></body></html>`)
  Object.defineProperty(page.document, "URL", { value: url })
  Object.defineProperty(page.document, "implementation", { value: { createHTMLDocument: (title = "") => {
    const doc = parseHTML("<html><head></head><body></body></html>").document
    doc.title = title
    return doc
  } } })
  for (const key of ["DOMParser", "Node", "Element", "HTMLElement", "HTMLImageElement", "NodeFilter"]) vi.stubGlobal(key, page.window[key as keyof typeof page.window])
  vi.stubGlobal("window", page.window)
  vi.stubGlobal("document", page.document)
}
beforeEach(() => {
  attempts = 0
  vi.stubGlobal("fetch", () => {
    attempts++
    throw new Error("external forbidden")
  })
  load()
})
afterEach(() => {
  expect(attempts).toBe(0)
  vi.unstubAllGlobals()
})
it("retains five original forum paragraphs despite long surrounding interface text", () => {
  const before = page.document.documentElement.outerHTML
  expect(inertSnapshot(page.document).querySelector("#postmessage_101")?.textContent).toBe(paragraphs.join(""))
  const draft = extractDocument(page.document, "article", "", now)
  expect(draft.body).toBe(expected)
  expect(draft.extractorVersion).toBe("defuddle-0.19.2-dom-v4")
  expect(page.document.documentElement.outerHTML).toBe(before)
})
it("selects the first main post on page one without including longer replies", () => {
  const reply = "原创回复：这不是主帖正文。".repeat(100)
  load(post(101) + post(202, `<p>${reply}</p>`) + post(303, "<p>另一个无关回复。</p>"))
  expect(extractDocument(page.document, "article", "", now).body).toBe(expected)
})
it("supports the explicit first-page viewthread query form without a domain rule", () => {
  load(post(101), "https://another.example/forum.php?mod=viewthread&tid=77&page=1")
  expect(extractDocument(page.document, "article", "", now).body).toBe(expected)
})
const defaultUrls = ["https://example.org/thread-77-1-1.html", "https://example.org/thread-77-1-1.html?page=1", "https://example.org/forum.php?mod=viewthread&tid=77", "https://example.org/forum.php?tid=77&page=1&mod=viewthread", "https://example.org/forum.php?%6dod=viewthread&tid=77&%70age=1"]
it.each(defaultUrls)("keeps the default unfiltered first page available: %s", (url) => {
  load(post(101) + post(202, "<p>原创后续回复。</p>"), url)
  expect(extractDocument(page.document, "article", "", now).body).toBe(expected)
})
const viewQueries = ["ordertype=1", "ordertype=0", "ordertype=", "pid=202", "viewpid=202", "stand=1", "from=album", "OrderType=1", "PID=202", "VIEWPID=202", "ordertype=1&ordertype=0", "pid=202&pid=101", "viewpid=202&viewpid=101", "%6frdertype=1", "unknown_view=1", "page=1", "Page=1", "%70age=1", "page%5B%5D=1", "tid=77", "TID=77", "mod=viewthread", "MOD=viewthread", "=value"]
it.each([defaultUrls[1], defaultUrls[3]].flatMap(base => viewQueries.map(query => `${base}&${query}`)))("rejects a reordered or filtered view with fully valid post identities: %s", (url) => {
  load(post(202, "<p>排在前面的回复，不能冒充主帖。</p>") + post(101), url)
  expect(() => extractDocument(page.document, "article", "", now)).toThrow("无法确认论坛主帖，请选择正文后重试。")
  expect(extractDocument(page.document, "selection", "<p>用户明确选择。</p>", now).body).toBe("用户明确选择。")
  expect(extractDocument(page.document, "metadata", "", now).body).toBe("")
})
it.each(["authorid=202", "AUTHORID=202", "authorid=101&authorid=202", "%61uthorid=202", "authorid%5B%5D=202"])("preserves the global sensitive-URL rejection for %s in every mode", (query) => {
  load(post(202, "<p>原创回复。</p>") + post(101), `https://example.org/forum.php?mod=viewthread&tid=77&page=1&${query}`)
  for (const mode of ["article", "selection", "metadata"] as const) expect(() => extractDocument(page.document, mode, "<p>原创选区。</p>", now)).toThrow("sensitive_clip_url")
})
it.each(["https://example.org/thread-77-2-1.html", "https://example.org/forum.php?mod=viewthread&tid=77&page=2", "https://example.org/thread-77-1-1.html?page=2", "https://example.org/forum.php?mod=viewthread&tid=77&page=1&page=2", "https://example.org/unknown-thread-view"])("requires selection when a main post cannot be established from %s", (url) => {
  load(post(202), url)
  expect(() => extractDocument(page.document, "article", "", now)).toThrow("无法确认论坛主帖，请选择正文后重试。")
  expect(extractDocument(page.document, "selection", "<p>用户指定的内容。</p>", now).body).toBe("用户指定的内容。")
  expect(extractDocument(page.document, "metadata", "", now).body).toBe("")
})
it.each(["hidden", "role=\"complementary\"", "role=\"navigation\"", "role=\"contentinfo\"", "style=\"display:none\""])("never falls through to a reply when the original main post is excluded by %s", (attr) => {
  load(post(101).replace("<div id=\"post_101\"", `<div ${attr} id="post_101"`) + post(202, "<p>不得替代主帖的回复。</p>"))
  expect(() => extractDocument(page.document, "article", "", now)).toThrow("无法确认论坛主帖，请选择正文后重试。")
})
it("keeps excluded descendants and active resources outside the focused main body", () => {
  load(post(101, `${prose}<div role="navigation">原创推荐入口。</div><div hidden>隐藏材料。</div><img src="https://example.org/pixel"><script>throw new Error('unsafe')</script><form>private field</form>`))
  expect(inertSnapshot(page.document).querySelector("img,script,form,[src],[href]")).toBeNull()
  expect(extractDocument(page.document, "article", "", now).body).toBe(expected)
})
it.each(["aria-hidden=\"true\"", "style=\"visibility:hidden\""])("retains main prose with %s, consistent with existing visual boundaries", (attr) => {
  load(post(101, `<div ${attr}><div style="visibility:visible">${prose}</div></div>`))
  expect(extractDocument(page.document, "article", "", now).body).toBe(expected)
})
it("preserves main-post paragraph, PRE and table boundaries", () => {
  load(post(101, "<p>前段正文。</p><pre>港口甲  10:00\n港口乙  18:00</pre><table><tbody><tr><td>关闭</td><td>10:00</td></tr><tr><td>恢复</td><td>18:00</td></tr></tbody></table><p>尾段正文。</p>"))
  expect(extractDocument(page.document, "article", "", now).body).toBe("前段正文。\n\n港口甲  10:00\n港口乙  18:00\n\n关闭\t10:00\n恢复\t18:00\n\n尾段正文。")
})
it.each([
  post(101).replace("id=\"pid101\"", "id=\"pid999\""),
  post(101).replace("id=\"postmessage_101\"", "id=\"postmessage_999\""),
  post(101) + post(101),
  "<table><tr><td><a>只有帖子索引或推荐链接，没有主帖正文。</a></td></tr></table>",
])("does not rescue ambiguous or index-like thread structures", (posts) => {
  load(posts)
  expect(() => extractDocument(page.document, "article", "", now)).toThrow("无法确认论坛主帖，请选择正文后重试。")
})
it.each(["pg_forumdisplay", "article-view"])("does not promote a postlist on a %s page into the article", (bodyClass) => {
  load(post(101, "<p>推荐列表中的消息，不能替代文章。</p>"), "https://example.org/forum-77-1.html")
  page.document.body.className = bodyClass
  page.document.body.insertAdjacentHTML("afterbegin", "<article><h1>原创正文</h1><p>正文与帖子索引保持独立。</p></article>")
  const draft = extractDocument(page.document, "article", "", now)
  expect(draft.body).toContain("正文与帖子索引保持独立。")
  expect(draft.body).not.toContain("推荐列表中的消息，不能替代文章。")
})
