import { type PolicyRecordView, type PolicyVersionView, policyCategories, policyCountries, policyDeclaredStatuses, policyDisplayLabels, policyPlatforms, policyRelationVerb, policySourceTypes } from "@shared/policy"

export function PolicyRows({ records, selectedId, state, onSelect }: { records: PolicyRecordView[], selectedId: string, state: "loading" | "error" | "ready", onSelect: (id: string) => void }) {
  if (state === "loading") return <p role="status">正在读取政策…</p>
  if (state === "error") return <p role="alert">政策读取失败，请重试。无法确认记录数量。</p>
  if (!records.length) return <p role="status">没有符合条件的记录。无记录不代表没有政策变化。</p>
  return (
    <div className="pol-list">
      {records.map(r => (
        <button type="button" key={r.id} className={`pol-row${r.id === selectedId ? " sel" : ""}`} data-testid="policy-row" data-id={r.id} data-status={r.displayStatus} aria-pressed={r.id === selectedId} onClick={() => onSelect(r.id)}>
          <span className="d">
            {r.effectiveAt ?? "—"}
            <small>{r.effectiveAt ? "生效日" : "未定生效日"}</small>
          </span>
          <span className="who">
            {policyCountries[r.countryCode]}
            {r.platform ? ` · ${policyPlatforms[r.platform]}` : ""}
            <small>{policyCategories[r.category]}</small>
          </span>
          <span className="ttl">
            {r.isFixture && <span className="pol-fixture">示例 fixture · 非真实公告</span>}
            {r.title}
            <small>
              {r.publisher ?? "发布方未填"}
              {" "}
              ·
              {" "}
              {r.documentNumber ?? "文号未填"}
            </small>
          </span>
          <span className={`ps ${r.displayStatus}`}>
            {policyDisplayLabels[r.displayStatus]}
            {r.autoActivated ? "（⚙ 到生效日自动）" : ""}
          </span>
        </button>
      ))}
    </div>
  )
}

export function PolicyFacts({ record: r }: { record: PolicyRecordView }) {
  return (
    <dl className="pol-kv">
      <dt>国家 / 平台</dt>
      <dd>
        {policyCountries[r.countryCode]}
        {" "}
        ·
        {" "}
        {r.platform ? policyPlatforms[r.platform] : "无平台"}
        {" "}
        ·
        {" "}
        {policyCategories[r.category]}
      </dd>
      <dt>发布方</dt>
      <dd>{r.publisher ?? "未填"}</dd>
      <dt>文号</dt>
      <dd>{r.documentNumber ?? "未填"}</dd>
      <dt>发布日</dt>
      <dd>{r.publishedAt ?? "未填"}</dd>
      <dt>生效日</dt>
      <dd>{r.effectiveAt ?? "未定"}</dd>
      <dt>适用时区</dt>
      <dd>{r.applicableTimezone ?? "未确认，不自动生效"}</dd>
      <dt>适用范围</dt>
      <dd>{r.scopeText ?? "未填"}</dd>
      <dt>环节</dt>
      <dd>{r.stage ?? "未填"}</dd>
      <dt>来源</dt>
      <dd>
        {policySourceTypes[r.sourceType]}
        {" "}
        · 人工录入 ·
        {" "}
        {r.enteredBy}
      </dd>
    </dl>
  )
}

export function PolicyHistory({ record, versions }: { record: PolicyRecordView, versions: PolicyVersionView[] }) {
  return (
    <>
      {(record.supersedesPolicyId || record.supersededByPolicyId) && (
        <p data-testid="policy-relation">
          {record.supersedesPolicyId && `本条${policyRelationVerb(record.supersedesRelationKind)}：${record.supersedesPolicyId}。 `}
          {record.supersededByPolicyId && `${record.supersedeSwitched ? "已被" : `将于 ${record.supersedeSwitchAt}（${record.supersedeSwitchTimezone}）起被`} ${record.supersededByPolicyId} ${policyRelationVerb(record.supersededByRelationKind)}${record.supersedeSwitched ? "" : "（尚未生效，当前状态不变）"}`}
        </p>
      )}
      <h3>{`版本（${versions.length}，旧版本永久保留）`}</h3>
      {versions.map(v => (
        <article key={v.id} data-testid="policy-version" data-version={v.versionNumber}>
          <strong>{`v${v.versionNumber} · ${policyDeclaredStatuses[v.status]} · 生效日 ${v.effectiveAt ?? "未定"} · ${v.createdAt.slice(0, 19)}Z · ${v.enteredBy ?? ""}${v.supersededByVersionId ? " · 已被新版本取代" : " · 当前版本"}`}</strong>
          <p>{`标题：${v.title} · 变更：${v.changeSummary ?? ""}`}</p>
          {v.snapshot && <p>{`该版本依据：${v.snapshot.basisText} · 来源：${v.sourceUrl}`}</p>}
        </article>
      ))}
    </>
  )
}
