import type { TranslationProvider, TranslationRequest, TranslationResult } from "#/providers/contracts"

export interface FakeTranslationProviderOptions {
  providerId?: string
  model?: string
  translateText?: (request: TranslationRequest) => string
}

/** Deterministic, local-only provider for Foundation tests. */
export class FakeTranslationProvider implements TranslationProvider {
  readonly providerId: string
  readonly model: string
  readonly calls: TranslationRequest[] = []
  private readonly translateText: (request: TranslationRequest) => string

  constructor(options: FakeTranslationProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-translation"
    this.model = options.model ?? "fake-v1"
    this.translateText = options.translateText ?? (request => `[${request.targetLanguage}] ${request.sourceText}`)
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(structuredClone(request))
    return { translatedText: this.translateText(request) }
  }
}
