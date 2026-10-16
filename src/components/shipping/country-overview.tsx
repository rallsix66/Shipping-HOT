import { ShippingShell } from "./app"

// Country/port scope from the approved eight-port plan, not demo event data.
const countries = [
  { code: "CN", name: "中国（起运）", ports: "CNYTN · CNSHK · CNNSA" },
  { code: "MY", name: "马来西亚", ports: "MYPKG" },
  { code: "PH", name: "菲律宾", ports: "PHMNL" },
  { code: "VN", name: "越南", ports: "VNSGN" },
  { code: "TH", name: "泰国", ports: "THLCH" },
  { code: "ID", name: "印尼", ports: "IDJKT" },
] as const

export function CountryOverviewContent() {
  return (
    <div className="country-overview" data-testid="country-overview">
      <div className="view-head">
        <div>
          <h1>国家风险总览</h1>
          <p className="sub">按“严重度 × 确认程度 × 时效”排序的目标框架；风险汇总与排序尚未开放。</p>
        </div>
        <a className="overview-btn" href="/calendar">看日历</a>
      </div>
      <div className="legend" aria-label="判断来源与确认状态图例">
        <span className="label">判断来源</span>
        <span className="rc-pv official">🏛 官方</span>
        <span className="rc-pv report">📰 报道</span>
        <span className="rc-pv system">⚙ 系统</span>
        <span className="rc-pv ai">🤖 AI</span>
        <span className="label">确认状态</span>
        <span className="st confirmed">已确认</span>
        <span className="st multi">多方报道</span>
        <span className="st pending">待确认</span>
        <span className="st conflict">说法不一</span>
        <span className="st potential">潜在影响</span>
        <p className="note">图例：已确认需官方正式通知或当事方发布自己的安排；潜在影响为天气规则命中，不能当作停工或停派通知。以下国家卡片尚未评估，不表示已确认或无风险。</p>
      </div>
      <div className="countries">
        {countries.map(c => (
          <section className="ccard" key={c.code} data-testid="country-card" aria-label={`${c.name}风险状态`}>
            <div className="top">
              <span className="name">{c.name}</span>
              <span className="port">{c.ports}</span>
            </div>
            <dl className="kv">
              <dt>最高严重度</dt>
              <dd>未评估</dd>
              <dt>风险事件</dt>
              <dd>未汇总 · 合并与确认能力未开放</dd>
              <dt>天气</dt>
              <dd>
                <a href="/ports">查看港口预报与潜在影响</a>
                <span className="muted">国家汇总未开放</span>
              </dd>
              <dt>末端派送</dt>
              <dd>未评估</dd>
            </dl>
            {c.code === "CN"
              ? <p className="muted">起运港影响尚未汇总，不推断停工或延误。</p>
              : (
                  <div className="delay">
                    <div className="label">现在出货 · 延误参考</div>
                    <span>未开放 · 不提供延误天数</span>
                    <p className="muted">需事件确认、数值和适用时间窗口后才能估算。</p>
                  </div>
                )}
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="overview-row">
          <h2>最需要关注</h2>
          <a className="overview-btn" href="/events">查看现有事件列表</a>
        </div>
        <p className="muted">跨来源风险事件合并、确认与排序尚未开放。此处未列出事件，不代表没有风险。</p>
      </section>
    </div>
  )
}

export function CountryOverviewPage() {
  return <ShippingShell title="国家风险总览" showLegend={false}><CountryOverviewContent /></ShippingShell>
}
