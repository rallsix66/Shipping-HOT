// VN-D01 synthetic card/page/sample moved verbatim from server/intel/vn-disaster-index.test.ts (shared test reuse).
export const card = (href: string, title: string, visible: string) => `<li><div class="item"><div class="row"><div class="col-md-10 title_item"><p><a href="${href}" title="${title}">${visible}</a></p></div></div></div></li>`
export const page = (content: string) => `<div class="boxtopnews"><ul class="news-headlines">${content}</ul></div>`
export const synthetic = page(card("/Pages/one.aspx", "Synthetic full news title with its actual punctuation.", "Synthetic shortened... (14/10/2026)") + card("/Pages/two.aspx", "Synthetic second news", "Synthetic second news (29/2/2024)"))
