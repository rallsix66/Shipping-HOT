import { useCallback, useEffect, useState } from "react"
import { myFetch } from "~/utils"

interface SecretMeta {
  configured: boolean
  source: string
  maskedLast4?: string
}

interface ProviderItem {
  id: string
  name: string
  baseUrl: string
  apiCompat: "openai"
  secretRef: string
  enabled: boolean
  secret: SecretMeta
}

interface ModelItem {
  id: string
  providerId: string
  modelName: string
  purpose: "chat" | "embedding"
  unitPriceIn: number
  unitPriceOut: number
  currency: string
  enabled: boolean
}

interface BindingItem {
  step: string
  modelId: string
  updatedAt: string
  updatedBy: string
}

const STEPS = [
  "prefilter",
  "extract",
  "group",
  "group_second_opinion",
  "summary",
  "daily_report",
  "embeddings",
  "translation",
] as const

function apiErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (error instanceof Error && error.message) return error.message
  return "request_failed"
}

/**
 * Settings block for ADR-007 LLM registry.
 * Test-connection uses offline mock transport only; UI labels results as 测试结果.
 */
export function LlmSettingsPanel() {
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [models, setModels] = useState<ModelItem[]>([])
  const [bindings, setBindings] = useState<BindingItem[]>([])
  const [loadError, setLoadError] = useState<string>()
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://api.example.com/v1")
  const [apiKey, setApiKey] = useState("")
  const [providerIdForModel, setProviderIdForModel] = useState("")
  const [modelName, setModelName] = useState("")
  const [purpose, setPurpose] = useState<"chat" | "embedding">("chat")
  const [priceIn, setPriceIn] = useState("0")
  const [priceOut, setPriceOut] = useState("0")
  const [currency, setCurrency] = useState("USD")
  const [bindStep, setBindStep] = useState<string>("extract")
  const [bindModelId, setBindModelId] = useState("")
  const [testProviderId, setTestProviderId] = useState("")
  const [testModelId, setTestModelId] = useState("")
  const [actionMessage, setActionMessage] = useState<string>()
  const [testMessage, setTestMessage] = useState<string>()
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoadError(undefined)
    try {
      const [p, m, b] = await Promise.all([
        myFetch<{ items: ProviderItem[] }>("/shipping/llm/providers"),
        myFetch<{ items: ModelItem[] }>("/shipping/llm/models"),
        myFetch<{ items: BindingItem[] }>("/shipping/llm/bindings"),
      ])
      setProviders(p.items)
      setModels(m.items)
      setBindings(b.items)
      if (!providerIdForModel && p.items[0]) setProviderIdForModel(p.items[0].id)
      if (!testProviderId && p.items[0]) setTestProviderId(p.items[0].id)
      if (!bindModelId && m.items[0]) setBindModelId(m.items[0].id)
      // Sync testModelId to a model that belongs to the selected provider (do not keep a stale id).
      const providerForTest = testProviderId || p.items[0]?.id || ""
      const modelsForProvider = m.items.filter(model => model.providerId === providerForTest)
      const stillValid = modelsForProvider.some(model => model.id === testModelId)
      if (!stillValid) setTestModelId(modelsForProvider[0]?.id ?? "")
    } catch (error) {
      setLoadError(apiErrorCode(error))
    }
  }, [bindModelId, providerIdForModel, testModelId, testProviderId])

  useEffect(() => {
    void reload()
  }, [reload])

  // When the test-connection provider changes (or models refresh), keep testModelId in that provider's set.
  useEffect(() => {
    if (!testProviderId) {
      setTestModelId("")
      return
    }
    const modelsForProvider = models.filter(model => model.providerId === testProviderId)
    if (!modelsForProvider.some(model => model.id === testModelId)) {
      setTestModelId(modelsForProvider[0]?.id ?? "")
    }
  }, [testProviderId, models, testModelId])

  const testModelsForProvider = models.filter(model => model.providerId === testProviderId)
  const testModelValid = Boolean(testProviderId && testModelId && testModelsForProvider.some(model => model.id === testModelId))

  const addProvider = async () => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      await myFetch("/shipping/llm/providers", {
        method: "POST",
        body: {
          name,
          baseUrl,
          apiCompat: "openai",
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      })
      setName("")
      setApiKey("")
      setActionMessage("服务商已保存（密钥仅脱敏展示）")
      await reload()
    } catch (error) {
      setActionMessage(`保存失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const addModel = async () => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      await myFetch("/shipping/llm/models", {
        method: "POST",
        body: {
          providerId: providerIdForModel,
          modelName,
          purpose,
          unitPriceIn: Number(priceIn),
          unitPriceOut: Number(priceOut),
          currency,
        },
      })
      setModelName("")
      setActionMessage("模型已保存")
      await reload()
    } catch (error) {
      setActionMessage(`模型保存失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const saveBinding = async () => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      await myFetch("/shipping/llm/bindings", {
        method: "PUT",
        body: { step: bindStep, modelId: bindModelId, updatedBy: "settings-ui" },
      })
      setActionMessage(`步骤 ${bindStep} 已绑定到 ${bindModelId}`)
      await reload()
    } catch (error) {
      setActionMessage(`绑定失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setBusy(true)
    setTestMessage(undefined)
    try {
      const result = await myFetch<{
        ok: boolean
        kind: string
        transport: string
        note?: string
        code?: string
        modelId?: string
      }>("/shipping/llm/test-connection", {
        method: "POST",
        body: { providerId: testProviderId, modelId: testModelId },
      })
      if (result.kind !== "test_result" || result.transport !== "test_fixture_mock") {
        setTestMessage("测试结果异常：未标记为 mock 测试结果")
      } else if (result.ok) {
        setTestMessage(`${result.note ?? "测试结果（mock）"} · model=${result.modelId}`)
      } else {
        setTestMessage(`${result.note ?? "测试结果（mock）拒绝"} · ${result.code}`)
      }
    } catch (error) {
      setTestMessage(`测试结果（非真实连接）：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass-panel translation-panel max-w-2xl p-6" aria-label="模型服务商设置">
      <p className="text-xs op-65">
        按 ADR-007 管理 OpenAI 兼容服务商、模型与步骤绑定。密钥只存 SecretStore 引用，页面仅显示脱敏状态。
        「测试连接」默认走离线 mock，结果必须标为测试结果，不能当作真实服务商已连接。未配置/零预算时零调用。
        翻译默认 DeepSeek 硬绑定仍保留，本片不打断现网翻译。
        本片 UI 约定能力：创建服务商/模型、步骤绑定、mock 测连；编辑/删除服务商与模型、密钥轮换管理走 API，本页未提供完整管理界面。
      </p>
      {loadError && (
        <p className="mt-3 text-sm text-rose-600">
          加载失败：
          {loadError}
        </p>
      )}
      {actionMessage && <p className="mt-3 text-sm">{actionMessage}</p>}

      <div className="mt-5 space-y-3">
        <strong>已登记服务商</strong>
        {providers.length === 0 ? <p className="text-xs op-60">尚无服务商</p> : null}
        {providers.map(provider => (
          <div key={provider.id} className="setting-row">
            <span>
              <strong>{provider.name}</strong>
              <small>
                {provider.id}
                {" · "}
                {provider.baseUrl}
              </small>
            </span>
            <span className="setting-readonly">
              {provider.secret.configured ? (provider.secret.maskedLast4 ?? "已配置") : "未配置密钥"}
              <small>{provider.secret.source}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <strong>添加服务商</strong>
        <label className="setting-row">
          <span><strong>名称</strong></span>
          <input className="setting-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="setting-row">
          <span>
            <strong>接口地址</strong>
            <small>仅 https，OpenAI 兼容</small>
          </span>
          <input className="setting-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
        </label>
        <label className="setting-row">
          <span>
            <strong>API Key</strong>
            <small>可选；仅写入 SecretStore</small>
          </span>
          <input className="setting-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="btn-gradient" disabled={busy || !name.trim()} onClick={() => void addProvider()}>
          添加服务商
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <strong>已登记模型</strong>
        {models.map(model => (
          <div key={model.id} className="setting-row">
            <span>
              <strong>{model.modelName}</strong>
              <small>
                {model.id}
                {" · "}
                {model.purpose}
                {" · "}
                {model.providerId}
              </small>
            </span>
            <span className="setting-readonly">
              {model.unitPriceIn}
              /
              {model.unitPriceOut}
              {" "}
              {model.currency}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <strong>添加模型</strong>
        <label className="setting-row">
          <span><strong>服务商</strong></span>
          <select className="setting-input" value={providerIdForModel} onChange={e => setProviderIdForModel(e.target.value)}>
            {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>模型名</strong></span>
          <input className="setting-input" value={modelName} onChange={e => setModelName(e.target.value)} />
        </label>
        <label className="setting-row">
          <span><strong>用途</strong></span>
          <select className="setting-input" value={purpose} onChange={e => setPurpose(e.target.value as "chat" | "embedding")}>
            <option value="chat">chat</option>
            <option value="embedding">embedding</option>
          </select>
        </label>
        <label className="setting-row">
          <span><strong>单价（每百万 tokens）</strong></span>
          <span className="flex gap-2">
            <input className="setting-input" value={priceIn} onChange={e => setPriceIn(e.target.value)} placeholder="in" />
            <input className="setting-input" value={priceOut} onChange={e => setPriceOut(e.target.value)} placeholder="out" />
            <input className="setting-input" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} />
          </span>
        </label>
        <button type="button" className="btn-gradient" disabled={busy || !providerIdForModel || !modelName.trim()} onClick={() => void addModel()}>
          添加模型
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <strong>步骤绑定</strong>
        {bindings.map(binding => (
          <div key={binding.step} className="setting-row">
            <span>
              <strong>{binding.step}</strong>
              <small>{binding.updatedAt}</small>
            </span>
            <span className="setting-readonly">{binding.modelId}</span>
          </div>
        ))}
        <label className="setting-row">
          <span><strong>步骤</strong></span>
          <select className="setting-input" value={bindStep} onChange={e => setBindStep(e.target.value)}>
            {STEPS.map(step => <option key={step} value={step}>{step}</option>)}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>模型</strong></span>
          <select className="setting-input" value={bindModelId} onChange={e => setBindModelId(e.target.value)}>
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.modelName}
                {" "}
                (
                {model.purpose}
                )
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-gradient" disabled={busy || !bindModelId} onClick={() => void saveBinding()}>
          保存绑定
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <strong>测试连接（mock）</strong>
        <p className="text-xs op-60">计入共享月预算与 paid_receipt；默认 mock transport。结果是测试结果，不是真实服务商已连接。</p>
        <label className="setting-row">
          <span><strong>服务商</strong></span>
          <select
            className="setting-input"
            data-testid="llm-test-provider"
            value={testProviderId}
            onChange={(e) => {
              const next = e.target.value
              setTestProviderId(next)
              const nextModels = models.filter(model => model.providerId === next)
              setTestModelId(nextModels[0]?.id ?? "")
            }}
          >
            {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>模型</strong></span>
          <select
            className="setting-input"
            data-testid="llm-test-model"
            value={testModelValid ? testModelId : ""}
            onChange={e => setTestModelId(e.target.value)}
          >
            {testModelsForProvider.map(model => (
              <option key={model.id} value={model.id}>{model.modelName}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-gradient"
          data-testid="llm-test-submit"
          disabled={busy || !testModelValid}
          onClick={() => void testConnection()}
        >
          测试连接（mock）
        </button>
        {testMessage && <p className="text-sm">{testMessage}</p>}
      </div>
    </section>
  )
}
