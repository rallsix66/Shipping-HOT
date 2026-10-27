/**
 * OpenAI-compatible chat/embeddings client interface for the LLM registry.
 * Production transport is injected; default path uses the mock for offline tests.
 */
export interface OpenAiCompatibleMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface OpenAiChatRequest {
  model: string
  messages: OpenAiCompatibleMessage[]
  temperature?: number
}

export interface OpenAiChatResponse {
  id: string
  model: string
  choices: Array<{ message: { role: string, content: string } }>
  usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number }
}

export interface OpenAiEmbeddingRequest {
  model: string
  input: string | string[]
}

export interface OpenAiEmbeddingResponse {
  model: string
  data: Array<{ embedding: number[], index: number }>
  usage?: { prompt_tokens?: number, total_tokens?: number }
}

export interface OpenAiCompatibleTransport {
  chat: (baseUrl: string, apiKey: string, body: OpenAiChatRequest) => Promise<OpenAiChatResponse>
  embeddings: (baseUrl: string, apiKey: string, body: OpenAiEmbeddingRequest) => Promise<OpenAiEmbeddingResponse>
}

export interface OpenAiCompatibleClientOptions {
  baseUrl: string
  apiKey: string
  transport: OpenAiCompatibleTransport
}

export function createOpenAiCompatibleClient(options: OpenAiCompatibleClientOptions) {
  return {
    async chat(body: OpenAiChatRequest): Promise<OpenAiChatResponse> {
      return options.transport.chat(options.baseUrl, options.apiKey, body)
    },
    async embeddings(body: OpenAiEmbeddingRequest): Promise<OpenAiEmbeddingResponse> {
      return options.transport.embeddings(options.baseUrl, options.apiKey, body)
    },
  }
}
