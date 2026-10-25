# Pinned source reuse

Source: https://github.com/obsidianmd/obsidian-clipper/tree/6d56d618b00bd970aa738d6a7a61edee27783e81 (MIT; LICENSE retained here and copied into the local package).

| Original | Local adaptation | Change |
| --- | --- | --- |
| `src/content.ts:205–214` selected range cloning | `extensions/shipping-hot-clipper/src/selection.ts` | Selection-only helper; no highlighter, loader or page-wide listener |
| `src/utils/dom-utils.ts:30–43` serializeChildren | `extensions/shipping-hot-clipper/src/dom-utils.ts` | Function copied, formatting only |
| `src/utils/clip-utils.ts:6–20` parseForClip | `extensions/shipping-hot-clipper/src/clip-utils.ts` | Remove Obsidian-reader recovery; core Defuddle sync-only, resource-free snapshot, async off and fetch denied |
| `src/utils/content-extractor.ts:67–125` sendExtractRequest/extractPageContent | `extensions/shipping-hot-clipper/src/content-extractor.ts` | Chrome one-shot injection replaces background transport; explicit errors/one retry retained; bind source document and actual URL, no navigation retry |

New code: draft protocol/nonce broker, rights validation/audit, server date evidence, app importer and resource-free snapshot. These are not claimed as upstream source reuse. No upstream logo, icon, marketing assets, interpreter, async extraction, reader, template engine or Obsidian save protocol is copied. `setElementHTML` is not a sanitizer and is not used. `shared.ts` date truncation is not used. Upstream highlight tests cover a feature omitted here; the adapted functions have project-owned synthetic tests.

The only new package dependency is exact `defuddle@0.19.2`, matching the pinned upstream lockfile. Its MIT license is copied from the installed package into generated output. Browser extraction remains separate from the existing backend Readability pipeline.
