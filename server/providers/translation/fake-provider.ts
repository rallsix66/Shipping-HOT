import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationUsage } from "#/providers/contracts"

export interface FakeTranslationProviderOptions {
  providerId?: string
  model?: string
  translateText?: (request: TranslationRequest) => string
  /** Optional usage returned with each call (for paid-path billing tests). */
  usage?: TranslationUsage | ((request: TranslationRequest) => TranslationUsage | undefined)
}

/** Deterministic, local-only provider for Foundation tests. */
export class FakeTranslationProvider implements TranslationProvider {
  readonly providerId: string
  readonly model: string
  readonly calls: TranslationRequest[] = []
  private readonly translateText: (request: TranslationRequest) => string
  private readonly usage?: TranslationUsage | ((request: TranslationRequest) => TranslationUsage | undefined)

  constructor(options: FakeTranslationProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-translation"
    this.model = options.model ?? "fake-v1"
    this.translateText = options.translateText ?? (request => `[${request.targetLanguage}] ${request.sourceText}`)
    this.usage = options.usage
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(structuredClone(request))
    const usage = typeof this.usage === "function" ? this.usage(request) : this.usage
    return usage
      ? { translatedText: this.translateText(request), usage }
      : { translatedText: this.translateText(request) }
  }
}
