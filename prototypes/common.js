/* Shipping HOT 布局对比原型 · 共享交互脚本
   - 页面切换（data-nav / data-back）
   - 明暗主题（data-theme，localStorage 记忆）
   - 多组筛选（data-filter-scope + data-items，AND 逻辑）
   - 侧栏折叠（data-collapse）
*/
(function () {
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel))
  }

  const PAGE_TITLES = window.__PROTO_TITLES__ || {}

  function setPage(id) {
    document.body.setAttribute("data-page", id)
    $$("[data-nav]").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-nav") === id)
    })
    const t = document.querySelector("[data-page-title]")
    if (t) t.textContent = PAGE_TITLES[id] || ""
    window.scrollTo({ top: 0 })
  }

  function refreshFilters() {
    $$("[data-items]").forEach((container) => {
      const id = container.getAttribute("data-items")
      const scopes = $$(`[data-filter-scope][data-items="${id}"]`)
      const conditions = []
      scopes.forEach((scope) => {
        const active = scope.querySelector("[data-filter].active")
        if (active && active.getAttribute("data-filter") !== "all") {
          conditions.push(active.getAttribute("data-filter"))
        }
      })
      $$("[data-cat]", container).forEach((item) => {
        const cats = item.getAttribute("data-cat").split(" ")
        const show = conditions.every((c) => {
          return cats.includes(c)
        })
        item.style.display = show ? "" : "none"
      })
    })
  }

  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]")
    if (nav) {
      e.preventDefault()
      setPage(nav.getAttribute("data-nav"))
      return
    }

    const back = e.target.closest("[data-back]")
    if (back) {
      e.preventDefault()
      setPage(back.getAttribute("data-back"))
      return
    }

    const th = e.target.closest("[data-theme]")
    if (th) {
      const dark = document.documentElement.classList.toggle("dark")
      try {
        localStorage.setItem("protoTheme", dark ? "dark" : "light")
      } catch {
        // ignore storage failures
      }
      return
    }

    const col = e.target.closest("[data-collapse]")
    if (col) {
      document.body.classList.toggle("collapsed")
      return
    }

    const f = e.target.closest("[data-filter]")
    if (f) {
      const scope = f.closest("[data-filter-scope]")
      if (!scope) {
        return
      }
      $$("[data-filter]", scope).forEach((b) => {
        b.classList.toggle("active", b === f)
      })
      refreshFilters()
    }
  })

  // 主题记忆
  try {
    if (localStorage.getItem("protoTheme") === "light") {
      document.documentElement.classList.remove("dark")
    }
  } catch {
    // ignore storage failures
  }

  const initial = document.body.getAttribute("data-page") || "dashboard"
  setPage(initial)
  refreshFilters()
})()
