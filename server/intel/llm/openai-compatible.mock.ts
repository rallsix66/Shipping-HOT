/**
 * Zero-network OpenAI-compatible transport for R3-1 offline tests and Settings test-connection.
 * Results MUST be labelled as test/fixture — never presented as a real vendor connection.
 */
import type {
  OpenAiChatRequest,
  OpenAiChatResponse,
  OpenAiCompatibleTransport,
  OpenAiEmbeddingRequest,
  OpenAiEmbeddingResponse,
} from "#/intel/llm/openai-compatible"

export const MOCK_TRANSPORT_LABEL = "test_fixture_mock" as const

export interface MockTransportState {
  chatHits: number
  embeddingHits: number
  lastChat?: OpenAiChatRequest
  lastEmbedding?: OpenAiEmbeddingRequest
}

export function createMockOpenAiTransport(state: MockTransportState = { chatHits: 0, embeddingHits: 0 }): OpenAiCompatibleTransport & { state: MockTransportState, label: typeof MOCK_TRANSPORT_LABEL } {
  return {
    label: MOCK_TRANSPORT_LABEL,
    state,
    async chat(_baseUrl: string, _apiKey: string, body: OpenAiChatRequest): Promise<OpenAiChatResponse> {
      state.chatHits++
      state.lastChat = body
      return {
        id: `mock-chat-${state.chatHits}`,
        model: body.model,
        choices: [{ message: { role: "assistant", content: "mock-ok" } }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      }
    },
    async embeddings(_baseUrl: string, _apiKey: string, body: OpenAiEmbeddingRequest): Promise<OpenAiEmbeddingResponse> {
      state.embeddingHits++
      state.lastEmbedding = body
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      return {
        model: body.model,
        data: inputs.map((_, index) => ({ index, embedding: [0.01, 0.02, 0.03] })),
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }
    },
  }
}
