/**
 * LLM registry test-connection (R3-1).
 * Always goes through paidRequest. Default transport is the offline mock;
 * results are labelled as test fixtures and must never be shown as a real vendor connection.
 */
import type { Database } from "db0"
import type { SecretStore } from "#/providers/contracts"
import { LlmRegistryError, LlmRegistryRepository } from "#/database/llm-registry"
import { PaidGateError, paidRequest } from "#/intel/llm/receipts"
import { MOCK_TRANSPORT_LABEL, createMockOpenAiTransport } from "#/intel/llm/openai-compatible.mock"
import { createOpenAiCompatibleClient } from "#/intel/llm/openai-compatible"
import { estimateTokenCost } from "#/intel/llm/registry"

export type TestConnectionResult =
  | {
    ok: true
    kind: "test_result"
    transport: typeof MOCK_TRANSPORT_LABEL
    providerId: string
    modelId: string
    modelName: string
    purpose: "chat" | "embedding"
    receiptId: string
    reused: boolean
    note: string
  }
  | {
    ok: false
    kind: "test_result"
    transport: typeof MOCK_TRANSPORT_LABEL
    code: string
    note: string
  }

export interface TestConnectionOptions {
  db: Database
  secretStore: SecretStore
  monthlyBudget: number | null | undefined
  providerId: string
  modelId: string
  /** Injected transport; defaults to zero-network mock. */
  transport?: ReturnType<typeof createMockOpenAiTransport>
  now?: () => Date
}

export async function runLlmTestConnection(options: TestConnectionOptions): Promise<TestConnectionResult> {
  const repo = new LlmRegistryRepository(options.db)
  const provider = await repo.getProvider(options.providerId)
  if (!provider || !provider.enabled) {
    return { ok: false, kind: "test_result", transport: MOCK_TRANSPORT_LABEL, code: "provider_not_found", note: "测试结果（mock）：服务商不可用" }
  }
  const model = await repo.getModel(options.modelId)
  if (!model || !model.enabled || model.providerId !== provider.id) {
    return { ok: false, kind: "test_result", transport: MOCK_TRANSPORT_LABEL, code: "model_not_found", note: "测试结果（mock）：模型不可用" }
  }

  const transport = options.transport ?? createMockOpenAiTransport()
  const estimateTokensIn = 8
  const estimateTokensOut = model.purpose === "chat" ? 2 : 0
  const estimatedCost = estimateTokenCost(model, estimateTokensIn, estimateTokensOut)

  try {
    const result = await paidRequest(
      {
        db: options.db,
        secretStore: options.secretStore,
        monthlyBudget: options.monthlyBudget,
        currency: model.currency,
        now: options.now,
      },
      {
        providerId: provider.secretRef,
        capability: model.purpose === "embedding" ? "llm_test_embedding" : "llm_test_chat",
        model: model.modelName,
        purpose: "llm_registry_test_connection",
        subject: `llm-test:${provider.id}:${model.id}`,
        identity: {
          providerId: provider.id,
          modelId: model.id,
          purpose: "test_connection",
          transport: MOCK_TRANSPORT_LABEL,
          // Endpoint/config identity: changing baseUrl or secretRef must not reuse old receipt.
          baseUrl: provider.baseUrl,
          apiCompat: provider.apiCompat,
          secretRef: provider.secretRef,
          providerUpdatedAt: provider.updatedAt,
        },
        requestSummary: {
          kind: "test_connection",
          providerId: provider.id,
          modelId: model.id,
          transport: MOCK_TRANSPORT_LABEL,
          baseUrl: provider.baseUrl,
          providerUpdatedAt: provider.updatedAt,
        },
        estimatedCost,
      },
      async (apiKey) => {
        const client = createOpenAiCompatibleClient({
          baseUrl: provider.baseUrl,
          apiKey,
          transport,
        })
        if (model.purpose === "embedding") {
          const response = await client.embeddings({ model: model.modelName, input: "shipping-hot-llm-registry-test" })
          return {
            response: { kind: "test_result", transport: MOCK_TRANSPORT_LABEL, embeddingDims: response.data[0]?.embedding.length ?? 0 },
            requestId: `mock-embed-${transport.state.embeddingHits}`,
            usage: { tokensIn: response.usage?.prompt_tokens ?? estimateTokensIn, tokensOut: 0 },
          }
        }
        const response = await client.chat({
          model: model.modelName,
          messages: [{ role: "user", content: "shipping-hot-llm-registry-test" }],
        })
        return {
          response: { kind: "test_result", transport: MOCK_TRANSPORT_LABEL, content: response.choices[0]?.message.content ?? "" },
          requestId: response.id,
          usage: {
            tokensIn: response.usage?.prompt_tokens ?? estimateTokensIn,
            tokensOut: response.usage?.completion_tokens ?? estimateTokensOut,
          },
        }
      },
    )
    return {
      ok: true,
      kind: "test_result",
      transport: MOCK_TRANSPORT_LABEL,
      providerId: provider.id,
      modelId: model.id,
      modelName: model.modelName,
      purpose: model.purpose,
      receiptId: result.receiptId,
      reused: result.reused,
      note: "测试结果（mock fixture）：不是真实服务商已连接",
    }
  } catch (error) {
    if (error instanceof PaidGateError) {
      return {
        ok: false,
        kind: "test_result",
        transport: MOCK_TRANSPORT_LABEL,
        code: error.code,
        note: "测试结果（mock）：预算/密钥闸门拒绝，零出站",
      }
    }
    if (error instanceof LlmRegistryError) {
      return {
        ok: false,
        kind: "test_result",
        transport: MOCK_TRANSPORT_LABEL,
        code: error.code,
        note: "测试结果（mock）：注册表校验失败",
      }
    }
    const code = error instanceof Error && error.name === "ReceiptUnknownError"
      ? "paid_result_unknown"
      : error instanceof Error && error.name === "ReceiptBusyError"
        ? "paid_receipt_busy"
        : "test_connection_failed"
    return {
      ok: false,
      kind: "test_result",
      transport: MOCK_TRANSPORT_LABEL,
      code,
      note: "测试结果（mock）：调用失败（非真实服务商状态）",
    }
  }
}
