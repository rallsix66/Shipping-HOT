import type { ClipMode } from "../../../shared/manual-clip"
import { extractDocument } from "./extract"
import { selectedHTML } from "./selection"

// A one-shot isolated-world injection. No page listener, global hook or full-page HTML reply.
const mode = (globalThis as unknown as { shippingClipMode?: ClipMode }).shippingClipMode ?? "metadata"
;(globalThis as unknown as { shippingClipResult: unknown }).shippingClipResult = extractDocument(document, mode, mode === "selection" ? selectedHTML() : "", new Date().toISOString())
