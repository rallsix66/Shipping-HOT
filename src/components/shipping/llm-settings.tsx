import { useCallback, useEffect, useMemo, useState } from "react"
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

type ConfirmTarget =
  | { kind: "provider", id: string, name: string }
  | { kind: "model", id: string, name: string }

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

function bindingStatus(
  binding: BindingItem,
  models: ModelItem[],
  providers: ProviderItem[],
): { label: string, invalid: boolean } {
  const model = models.find(item => item.id === binding.modelId)
  if (!model) return { label: "失效（模型不存在）", invalid: true }
  if (!model.enabled) return { label: "失效（模型已禁用）", invalid: true }
  const provider = providers.find(item => item.id === model.providerId)
  if (!provider) return { label: "失效（服务商不存在）", invalid: true }
  if (!provider.enabled) return { label: "失效（服务商已禁用）", invalid: true }
  // Mirror resolveStepBinding purpose/step constraints (no silent "有效").
  if (binding.step === "embeddings" && model.purpose !== "embedding") {
    return { label: "失效（用途不匹配）", invalid: true }
  }
  if (binding.step !== "embeddings" && model.purpose !== "chat") {
    return { label: "失效（用途不匹配）", invalid: true }
  }
  return { label: "有效", invalid: false }
}

/**
 * Settings block for ADR-007 LLM registry.
 * Test-connection uses offline mock transport only; UI labels results as 测试结果.
 * Manage UI: edit / disable / delete (with explicit confirm); secret rotate (blank = keep).
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
  const [editingProviderId, setEditingProviderId] = useState<string>()
  const [editProviderName, setEditProviderName] = useState("")
  const [editProviderBaseUrl, setEditProviderBaseUrl] = useState("")
  const [editProviderApiKey, setEditProviderApiKey] = useState("")
  const [editingModelId, setEditingModelId] = useState<string>()
  const [editModelName, setEditModelName] = useState("")
  const [editModelPurpose, setEditModelPurpose] = useState<"chat" | "embedding">("chat")
  const [editPriceIn, setEditPriceIn] = useState("0")
  const [editPriceOut, setEditPriceOut] = useState("0")
  const [editCurrency, setEditCurrency] = useState("USD")
  const [confirmDelete, setConfirmDelete] = useState<ConfirmTarget | null>(null)
  const [sharedBudgetInput, setSharedBudgetInput] = useState("")
  const [sharedCurrencyInput, setSharedCurrencyInput] = useState("USD")
  const [sharedBudgetStatus, setSharedBudgetStatus] = useState<{
    configured: boolean
    monthlyBudget: number | null
    currency: string | null
    estimatedUsage: number
    pendingUnknownReserve: number
    estimatedTotal: number
    state: string
    rejectionReason?: string
    notAHardInvoiceCap?: boolean
  }>()
  const [sharedBudgetMessage, setSharedBudgetMessage] = useState<string>()

  const applySharedBudgetForm = (status: {
    configured: boolean
    monthlyBudget: number | null
    currency: string | null
  }) => {
    // Only first load / explicit save success / explicit clear may sync dirty inputs.
    if (status.configured && status.monthlyBudget != null && status.currency) {
      setSharedBudgetInput(String(status.monthlyBudget))
      setSharedCurrencyInput(status.currency)
    } else {
      setSharedBudgetInput("")
      setSharedCurrencyInput("USD")
    }
  }

  const reload = useCallback(async (opts?: { syncBudgetForm?: boolean }) => {
    setLoadError(undefined)
    try {
      const [p, m, b, budgetStatus] = await Promise.all([
        myFetch<{ items: ProviderItem[] }>("/shipping/llm/providers"),
        myFetch<{ items: ModelItem[] }>("/shipping/llm/models"),
        myFetch<{ items: BindingItem[] }>("/shipping/llm/bindings"),
        myFetch<{
          configured: boolean
          monthlyBudget: number | null
          currency: string | null
          estimatedUsage: number
          pendingUnknownReserve: number
          estimatedTotal: number
          state: string
          rejectionReason?: string
          notAHardInvoiceCap?: boolean
        }>("/shipping/llm/shared-budget"),
      ])
      setSharedBudgetStatus(budgetStatus)
      if (opts?.syncBudgetForm) {
        applySharedBudgetForm(budgetStatus)
      }
      setProviders(p.items)
      setModels(m.items)
      setBindings(b.items)
      // Drop deleted/stale provider selections; never keep a ghost id that can still submit.
      const nextProviderIdForModel = p.items.some(item => item.id === providerIdForModel)
        ? providerIdForModel
        : (p.items[0]?.id ?? "")
      const nextTestProviderId = p.items.some(item => item.id === testProviderId)
        ? testProviderId
        : (p.items[0]?.id ?? "")
      setProviderIdForModel(nextProviderIdForModel)
      setTestProviderId(nextTestProviderId)
      // Keep bindModelId as-is even if invalid — never silent swap.
      if (!bindModelId && m.items[0]) setBindModelId(m.items[0].id)
      const modelsForProvider = m.items.filter(model => model.providerId === nextTestProviderId)
      const stillValid = modelsForProvider.some(model => model.id === testModelId)
      if (!stillValid) setTestModelId(modelsForProvider[0]?.id ?? "")
    } catch (error) {
      setLoadError(apiErrorCode(error))
    }
  }, [bindModelId, providerIdForModel, testModelId, testProviderId])

  useEffect(() => {
    void reload({ syncBudgetForm: true })
  }, [reload])

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
  const providerIdForModelValid = Boolean(providerIdForModel && providers.some(item => item.id === providerIdForModel))
  const testProviderValid = Boolean(testProviderId && providers.some(item => item.id === testProviderId))
  const testModelValid = Boolean(testProviderValid && testModelId && testModelsForProvider.some(model => model.id === testModelId))
  const bindModelExists = models.some(model => model.id === bindModelId)

  const bindingViews = useMemo(
    () => bindings.map(binding => ({ binding, status: bindingStatus(binding, models, providers) })),
    [bindings, models, providers],
  )

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

  const startEditProvider = (provider: ProviderItem) => {
    setEditingProviderId(provider.id)
    setEditProviderName(provider.name)
    setEditProviderBaseUrl(provider.baseUrl)
    setEditProviderApiKey("")
    setActionMessage(undefined)
  }

  const saveEditProvider = async () => {
    if (!editingProviderId) return
    setBusy(true)
    setActionMessage(undefined)
    const retainedName = editProviderName
    const retainedBase = editProviderBaseUrl
    const retainedKey = editProviderApiKey
    try {
      // Blank apiKey omitted — blank does not overwrite existing secret.
      await myFetch(`/shipping/llm/providers/${editingProviderId}`, {
        method: "PATCH",
        body: {
          name: editProviderName,
          baseUrl: editProviderBaseUrl,
          ...(editProviderApiKey.trim() ? { apiKey: editProviderApiKey.trim() } : {}),
        },
      })
      setEditingProviderId(undefined)
      setEditProviderApiKey("")
      setActionMessage(
        retainedKey.trim()
          ? "服务商已更新（密钥已更换；页面仅脱敏展示）"
          : "服务商已更新（未提交密钥字段，现有密钥保留）",
      )
      await reload()
    } catch (error) {
      // Keep form values on failure; show real error code (never claim success).
      setEditProviderName(retainedName)
      setEditProviderBaseUrl(retainedBase)
      setEditProviderApiKey(retainedKey)
      setActionMessage(`服务商更新失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleProviderEnabled = async (provider: ProviderItem) => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      await myFetch(`/shipping/llm/providers/${provider.id}`, {
        method: "PATCH",
        body: { enabled: !provider.enabled },
      })
      setActionMessage(provider.enabled ? `服务商 ${provider.name} 已禁用` : `服务商 ${provider.name} 已启用`)
      await reload()
    } catch (error) {
      setActionMessage(`启用/禁用失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const addModel = async () => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      if (!providers.some(item => item.id === providerIdForModel)) {
        setActionMessage("模型保存失败：provider_missing（请重新选择有效服务商）")
        return
      }
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

  const startEditModel = (model: ModelItem) => {
    setEditingModelId(model.id)
    setEditModelName(model.modelName)
    setEditModelPurpose(model.purpose)
    setEditPriceIn(String(model.unitPriceIn))
    setEditPriceOut(String(model.unitPriceOut))
    setEditCurrency(model.currency)
    setActionMessage(undefined)
  }

  const saveEditModel = async () => {
    if (!editingModelId) return
    setBusy(true)
    setActionMessage(undefined)
    const retained = {
      name: editModelName,
      purpose: editModelPurpose,
      priceIn: editPriceIn,
      priceOut: editPriceOut,
      currency: editCurrency,
    }
    try {
      // Precise API readback: trust persisted numbers from PATCH response, not local Number() alone.
      const updated = await myFetch<ModelItem>(`/shipping/llm/models/${editingModelId}`, {
        method: "PATCH",
        body: {
          modelName: editModelName,
          purpose: editModelPurpose,
          unitPriceIn: Number(editPriceIn),
          unitPriceOut: Number(editPriceOut),
          currency: editCurrency,
        },
      })
      setEditModelName(updated.modelName)
      setEditModelPurpose(updated.purpose)
      setEditPriceIn(String(updated.unitPriceIn))
      setEditPriceOut(String(updated.unitPriceOut))
      setEditCurrency(updated.currency)
      setEditingModelId(undefined)
      setActionMessage(`模型已更新（回读价格 in=${updated.unitPriceIn} out=${updated.unitPriceOut} ${updated.currency}）`)
      await reload()
    } catch (error) {
      setEditModelName(retained.name)
      setEditModelPurpose(retained.purpose)
      setEditPriceIn(retained.priceIn)
      setEditPriceOut(retained.priceOut)
      setEditCurrency(retained.currency)
      setActionMessage(`模型更新失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleModelEnabled = async (model: ModelItem) => {
    setBusy(true)
    setActionMessage(undefined)
    try {
      await myFetch(`/shipping/llm/models/${model.id}`, {
        method: "PATCH",
        body: { enabled: !model.enabled },
      })
      setActionMessage(model.enabled ? `模型 ${model.modelName} 已禁用` : `模型 ${model.modelName} 已启用`)
      await reload()
    } catch (error) {
      setActionMessage(`模型启用/禁用失败：${apiErrorCode(error)}`)
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

  const executeConfirmedDelete = async () => {
    if (!confirmDelete) return
    setBusy(true)
    setActionMessage(undefined)
    const target = confirmDelete
    try {
      if (target.kind === "provider") {
        await myFetch(`/shipping/llm/providers/${target.id}`, { method: "DELETE" })
        // Explicit retain semantics: registry row gone; SecretStore key NOT claimed deleted.
        setActionMessage(
          `服务商 ${target.name} 登记已删除；SecretStore 中的密钥按保留语义仍存在，本操作未清理真实密钥存储`,
        )
      } else {
        await myFetch(`/shipping/llm/models/${target.id}`, { method: "DELETE" })
        setActionMessage(`模型 ${target.name} 已删除`)
      }
      setConfirmDelete(null)
      if (editingProviderId === target.id) setEditingProviderId(undefined)
      if (editingModelId === target.id) setEditingModelId(undefined)
      if (target.kind === "provider") {
        if (providerIdForModel === target.id) setProviderIdForModel("")
        if (testProviderId === target.id) setTestProviderId("")
      }
      await reload()
    } catch (error) {
      const code = apiErrorCode(error)
      setActionMessage(
        target.kind === "provider"
          ? `删除服务商受阻：${code}（资源仍被步骤绑定占用时不可删）`
          : `删除模型受阻：${code}（资源仍被步骤绑定占用时不可删）`,
      )
    } finally {
      setBusy(false)
    }
  }

  const refreshSharedBudgetStatus = async () => {
    try {
      const status = await myFetch<{
        configured: boolean
        monthlyBudget: number | null
        currency: string | null
        estimatedUsage: number
        pendingUnknownReserve: number
        estimatedTotal: number
        state: string
        rejectionReason?: string
        notAHardInvoiceCap?: boolean
      }>("/shipping/llm/shared-budget")
      // Status-only: never overwrite unsaved budget drafts.
      setSharedBudgetStatus(status)
    } catch {
      // Refresh failed: show unavailable / pending refresh — do not keep a stale ready panel.
      setSharedBudgetStatus({
        configured: false,
        monthlyBudget: null,
        currency: null,
        estimatedUsage: 0,
        pendingUnknownReserve: 0,
        estimatedTotal: 0,
        state: "unavailable",
        rejectionReason: "status_refresh_failed",
        notAHardInvoiceCap: true,
      })
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
      // Refresh pool usage/ready after mock call so the panel does not keep pre-call figures.
      await refreshSharedBudgetStatus()
    } catch (error) {
      setTestMessage(`测试结果（非真实连接）：${apiErrorCode(error)}`)
      await refreshSharedBudgetStatus()
    } finally {
      setBusy(false)
    }
  }

  const saveSharedBudget = async () => {
    setBusy(true)
    setSharedBudgetMessage(undefined)
    setActionMessage(undefined)
    try {
      const monthlyBudget = Number(sharedBudgetInput)
      const currency = sharedCurrencyInput.trim().toUpperCase()
      await myFetch("/shipping/settings", {
        method: "POST",
        body: { sharedLlmBudget: { monthlyBudget, currency } },
      })
      const status = await myFetch<{
        configured: boolean
        monthlyBudget: number | null
        currency: string | null
        estimatedUsage: number
        pendingUnknownReserve: number
        estimatedTotal: number
        state: string
        rejectionReason?: string
        notAHardInvoiceCap?: boolean
      }>("/shipping/llm/shared-budget")
      setSharedBudgetStatus(status)
      applySharedBudgetForm(status)
      setSharedBudgetMessage(`共享 LLM 总池已保存（回读 ${status.monthlyBudget ?? "—"} ${status.currency ?? ""} · 状态 ${status.state}）`)
    } catch (error) {
      setSharedBudgetMessage(`共享 LLM 总池保存失败：${apiErrorCode(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass-panel translation-panel max-w-2xl p-6" aria-label="模型服务商设置" data-testid="llm-settings-panel">
      <p className="text-xs op-65">
        按 ADR-007 管理 OpenAI 兼容服务商、模型与步骤绑定。密钥只存 SecretStore 引用，页面仅显示脱敏状态。
        「测试连接」默认走离线 mock，结果必须标为测试结果，不能当作真实服务商已连接。未配置/超预算时零调用。
        翻译默认 DeepSeek 硬绑定仍保留，本片不打断现网翻译。
        本片管理 UI：服务商/模型的编辑、禁用、删除（删除需明确确认）；模型价格/币种/用途；绑定失效明示且不静默换模型；
        密钥脱敏与假密钥更换（空白不覆盖）；删除服务商不声称已删除 SecretStore 密钥。
      </p>
      {loadError && (
        <p className="mt-3 text-sm text-rose-600" data-testid="llm-load-error">
          加载失败：
          {loadError}
        </p>
      )}
      {actionMessage && (
        <p className="mt-3 text-sm" data-testid="llm-action-message">
          {actionMessage}
        </p>
      )}

      <div className="mt-5 rounded border border-dashed border-slate-300 p-4" data-testid="shared-llm-budget-panel">
        <h3 className="text-sm font-medium">共享 LLM 总池（Settings）</h3>
        <p className="mt-1 text-xs op-65">
          覆盖 registry chat/embedding、translation sync/test 等同一估算总池。默认未配置/零额/非法币种 fail-closed；
          不会从 translation.monthlyBudget 自动复制授权。translation 原预算仍是更严的子限制。
          Search/Fetch 独立门禁不变。本控件只做估算用量 + pending/unknown 占用，不是真实账单硬封顶。
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            月额度
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              data-testid="shared-llm-budget-input"
              inputMode="decimal"
              value={sharedBudgetInput}
              onChange={e => setSharedBudgetInput(e.target.value)}
              placeholder="未配置则 fail-closed"
            />
          </label>
          <label className="text-xs">
            币种（ISO 4217）
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm uppercase"
              data-testid="shared-llm-budget-currency"
              value={sharedCurrencyInput}
              onChange={e => setSharedCurrencyInput(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-gradient"
            data-testid="shared-llm-budget-save"
            disabled={busy}
            onClick={() => void saveSharedBudget()}
          >
            保存总池
          </button>
        </div>
        {sharedBudgetMessage && (
          <p className="mt-2 text-sm" data-testid="shared-llm-budget-message">{sharedBudgetMessage}</p>
        )}
        {sharedBudgetStatus && (
          <dl className="mt-3 grid gap-1 text-xs" data-testid="shared-llm-budget-status">
            <div className="flex justify-between gap-3">
              <dt className="op-60">配置状态</dt>
              <dd data-testid="shared-llm-budget-status-state">
                {sharedBudgetStatus.state === "unavailable"
                  ? "状态不可用（待刷新）"
                  : (sharedBudgetStatus.configured ? "已配置" : "未配置")}
                {" "}
                ·
                {" "}
                {sharedBudgetStatus.state}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="op-60">配置额度</dt>
              <dd>
                {sharedBudgetStatus.monthlyBudget ?? "—"}
                {" "}
                {sharedBudgetStatus.currency ?? ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="op-60">已估算用量</dt>
              <dd>{sharedBudgetStatus.estimatedUsage}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="op-60">pending/unknown 占用</dt>
              <dd>{sharedBudgetStatus.pendingUnknownReserve}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="op-60">估算合计</dt>
              <dd>{sharedBudgetStatus.estimatedTotal}</dd>
            </div>
            {sharedBudgetStatus.rejectionReason && (
              <div className="flex justify-between gap-3 text-rose-600">
                <dt className="op-60">拒绝原因</dt>
                <dd data-testid="shared-llm-budget-rejection">{sharedBudgetStatus.rejectionReason}</dd>
              </div>
            )}
            <div className="mt-1 op-50">控制依据：估算用量 + pending/unknown 预留；非真实账单绝对硬封顶。</div>
          </dl>
        )}
      </div>

      {confirmDelete && (
        <div className="mt-4 rounded border border-rose-300 bg-rose-50 p-3" data-testid="llm-delete-confirm">
          <p className="text-sm">
            确认删除
            {confirmDelete.kind === "provider" ? "服务商" : "模型"}
            {" "}
            <strong>{confirmDelete.name}</strong>
            （
            {confirmDelete.id}
            ）？
          </p>
          {confirmDelete.kind === "provider" && (
            <p className="mt-1 text-xs op-70">
              仅删除登记行与其下未绑定模型；不会清理 SecretStore 中的密钥（保留语义）。本轮只删除隔离测试假数据。
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-gradient error"
              data-testid="llm-delete-confirm-yes"
              disabled={busy}
              onClick={() => void executeConfirmedDelete()}
            >
              确认删除
            </button>
            <button
              type="button"
              className="btn-gradient"
              data-testid="llm-delete-confirm-no"
              disabled={busy}
              onClick={() => setConfirmDelete(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <strong>已登记服务商</strong>
        {providers.length === 0 ? <p className="text-xs op-60">暂无服务商</p> : null}
        {providers.map(provider => (
          <div key={provider.id} className="space-y-2" data-testid={`llm-provider-row-${provider.id}`}>
            <div className="setting-row">
              <span>
                <strong>{provider.name}</strong>
                <small>
                  {provider.id}
                  {" · "}
                  {provider.baseUrl}
                  {" · "}
                  {provider.enabled ? "启用" : "已禁用"}
                </small>
              </span>
              <span className="setting-readonly">
                {provider.secret.configured ? (provider.secret.maskedLast4 ?? "已配置") : "未配置密钥"}
                <small>{provider.secret.source}</small>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-gradient"
                data-testid={`llm-provider-edit-${provider.id}`}
                disabled={busy}
                onClick={() => startEditProvider(provider)}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn-gradient"
                data-testid={`llm-provider-toggle-${provider.id}`}
                disabled={busy}
                onClick={() => void toggleProviderEnabled(provider)}
              >
                {provider.enabled ? "禁用" : "启用"}
              </button>
              <button
                type="button"
                className="btn-gradient error"
                data-testid={`llm-provider-delete-${provider.id}`}
                disabled={busy}
                onClick={() => setConfirmDelete({ kind: "provider", id: provider.id, name: provider.name })}
              >
                删除
              </button>
            </div>
            {editingProviderId === provider.id && (
              <div className="space-y-2 rounded border p-3" data-testid={`llm-provider-edit-form-${provider.id}`}>
                <label className="setting-row">
                  <span><strong>名称</strong></span>
                  <input
                    className="setting-input"
                    data-testid="llm-provider-edit-name"
                    value={editProviderName}
                    onChange={e => setEditProviderName(e.target.value)}
                  />
                </label>
                <label className="setting-row">
                  <span><strong>接口地址</strong></span>
                  <input
                    className="setting-input"
                    data-testid="llm-provider-edit-baseurl"
                    value={editProviderBaseUrl}
                    onChange={e => setEditProviderBaseUrl(e.target.value)}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>更换 API Key（假密钥）</strong>
                    <small>留空不覆盖现有密钥；仅写入 llm-registry: 命名空间</small>
                  </span>
                  <input
                    className="setting-input"
                    type="password"
                    data-testid="llm-provider-edit-apikey"
                    value={editProviderApiKey}
                    onChange={e => setEditProviderApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-gradient"
                    data-testid="llm-provider-edit-save"
                    disabled={busy || !editProviderName.trim()}
                    onClick={() => void saveEditProvider()}
                  >
                    保存编辑
                  </button>
                  <button
                    type="button"
                    className="btn-gradient"
                    data-testid="llm-provider-edit-cancel"
                    disabled={busy}
                    onClick={() => {
                      setEditingProviderId(undefined)
                      setEditProviderApiKey("")
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <strong>添加服务商</strong>
        <label className="setting-row">
          <span><strong>名称</strong></span>
          <input className="setting-input" data-testid="llm-provider-create-name" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="setting-row">
          <span>
            <strong>接口地址</strong>
            <small>仅 https；OpenAI 兼容</small>
          </span>
          <input className="setting-input" data-testid="llm-provider-create-baseurl" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
        </label>
        <label className="setting-row">
          <span>
            <strong>API Key</strong>
            <small>可选；仅写入 SecretStore</small>
          </span>
          <input className="setting-input" type="password" data-testid="llm-provider-create-apikey" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="btn-gradient" data-testid="llm-provider-create-submit" disabled={busy || !name.trim()} onClick={() => void addProvider()}>
          添加服务商
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <strong>已登记模型</strong>
        {models.map(model => (
          <div key={model.id} className="space-y-2" data-testid={`llm-model-row-${model.id}`}>
            <div className="setting-row">
              <span>
                <strong>{model.modelName}</strong>
                <small>
                  {model.id}
                  {" · "}
                  {model.purpose}
                  {" · "}
                  {model.providerId}
                  {" · "}
                  {model.enabled ? "启用" : "已禁用"}
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-gradient"
                data-testid={`llm-model-edit-${model.id}`}
                disabled={busy}
                onClick={() => startEditModel(model)}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn-gradient"
                data-testid={`llm-model-toggle-${model.id}`}
                disabled={busy}
                onClick={() => void toggleModelEnabled(model)}
              >
                {model.enabled ? "禁用" : "启用"}
              </button>
              <button
                type="button"
                className="btn-gradient error"
                data-testid={`llm-model-delete-${model.id}`}
                disabled={busy}
                onClick={() => setConfirmDelete({ kind: "model", id: model.id, name: model.modelName })}
              >
                删除
              </button>
            </div>
            {editingModelId === model.id && (
              <div className="space-y-2 rounded border p-3" data-testid={`llm-model-edit-form-${model.id}`}>
                <label className="setting-row">
                  <span><strong>模型名</strong></span>
                  <input className="setting-input" data-testid="llm-model-edit-name" value={editModelName} onChange={e => setEditModelName(e.target.value)} />
                </label>
                <label className="setting-row">
                  <span><strong>用途</strong></span>
                  <select className="setting-input" data-testid="llm-model-edit-purpose" value={editModelPurpose} onChange={e => setEditModelPurpose(e.target.value as "chat" | "embedding")}>
                    <option value="chat">chat</option>
                    <option value="embedding">embedding</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span><strong>单价（每百万 tokens）</strong></span>
                  <span className="flex gap-2">
                    <input className="setting-input" data-testid="llm-model-edit-price-in" value={editPriceIn} onChange={e => setEditPriceIn(e.target.value)} placeholder="in" />
                    <input className="setting-input" data-testid="llm-model-edit-price-out" value={editPriceOut} onChange={e => setEditPriceOut(e.target.value)} placeholder="out" />
                    <input className="setting-input" data-testid="llm-model-edit-currency" value={editCurrency} onChange={e => setEditCurrency(e.target.value.toUpperCase())} />
                  </span>
                </label>
                <div className="flex gap-2">
                  <button type="button" className="btn-gradient" data-testid="llm-model-edit-save" disabled={busy || !editModelName.trim()} onClick={() => void saveEditModel()}>
                    保存编辑
                  </button>
                  <button type="button" className="btn-gradient" data-testid="llm-model-edit-cancel" disabled={busy} onClick={() => setEditingModelId(undefined)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <strong>添加模型</strong>
        <label className="setting-row">
          <span><strong>服务商</strong></span>
          <select className="setting-input" data-testid="llm-model-create-provider" value={providerIdForModelValid ? providerIdForModel : ""} onChange={e => setProviderIdForModel(e.target.value)}>
            {!providerIdForModelValid
              ? <option value="">（请选择有效服务商）</option>
              : null}
            {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>模型名</strong></span>
          <input className="setting-input" data-testid="llm-model-create-name" value={modelName} onChange={e => setModelName(e.target.value)} />
        </label>
        <label className="setting-row">
          <span><strong>用途</strong></span>
          <select className="setting-input" data-testid="llm-model-create-purpose" value={purpose} onChange={e => setPurpose(e.target.value as "chat" | "embedding")}>
            <option value="chat">chat</option>
            <option value="embedding">embedding</option>
          </select>
        </label>
        <label className="setting-row">
          <span><strong>单价（每百万 tokens）</strong></span>
          <span className="flex gap-2">
            <input className="setting-input" data-testid="llm-model-create-price-in" value={priceIn} onChange={e => setPriceIn(e.target.value)} placeholder="in" />
            <input className="setting-input" data-testid="llm-model-create-price-out" value={priceOut} onChange={e => setPriceOut(e.target.value)} placeholder="out" />
            <input className="setting-input" data-testid="llm-model-create-currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} />
          </span>
        </label>
        <button type="button" className="btn-gradient" data-testid="llm-model-create-submit" disabled={busy || !providerIdForModelValid || !modelName.trim()} onClick={() => void addModel()}>
          添加模型
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <strong>步骤绑定</strong>
        <p className="text-xs op-60">失效绑定会明确显示，不会静默更换模型。删除仍被绑定的资源会被拒绝（provider_in_use / model_in_use）。</p>
        {bindingViews.map(({ binding, status }) => (
          <div key={binding.step} className="setting-row" data-testid={`llm-binding-row-${binding.step}`}>
            <span>
              <strong>{binding.step}</strong>
              <small>{binding.updatedAt}</small>
            </span>
            <span className="setting-readonly" data-testid={`llm-binding-status-${binding.step}`}>
              {binding.modelId}
              {" · "}
              <span className={status.invalid ? "text-rose-600" : undefined}>{status.label}</span>
            </span>
          </div>
        ))}
        <label className="setting-row">
          <span><strong>步骤</strong></span>
          <select className="setting-input" data-testid="llm-binding-step" value={bindStep} onChange={e => setBindStep(e.target.value)}>
            {STEPS.map(step => <option key={step} value={step}>{step}</option>)}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>模型</strong></span>
          <select className="setting-input" data-testid="llm-binding-model" value={bindModelId} onChange={e => setBindModelId(e.target.value)}>
            {!bindModelExists && bindModelId
              ? (
                  <option value={bindModelId}>
                    {bindModelId}
                    {" （当前选择已失效，请改绑）"}
                  </option>
                )
              : null}
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.modelName}
                {" "}
                (
                {model.purpose}
                {model.enabled ? "" : " · 已禁用"}
                )
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-gradient" data-testid="llm-binding-save" disabled={busy || !bindModelId} onClick={() => void saveBinding()}>
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
            value={testProviderValid ? testProviderId : ""}
            onChange={(e) => {
              const next = e.target.value
              setTestProviderId(next)
              const nextModels = models.filter(model => model.providerId === next)
              setTestModelId(nextModels[0]?.id ?? "")
            }}
          >
            {!testProviderValid
              ? <option value="">（请选择有效服务商）</option>
              : null}
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
        {testMessage && <p className="text-sm" data-testid="llm-test-message">{testMessage}</p>}
      </div>
    </section>
  )
}
