# R3-1 stacked-base exception

- Branch: `codex/shipping-hot-r3-1-llm-registry-20261027`
- Worktree: `D:/try one/Shipping HOT/.tmp/worktrees/r3-1-llm-registry-20261027`
- Base tip (full SHA): `edf222d657745307f59a6c9a43bcfdb890e8f4da` (R2 tip, not yet merged to product main)
- Product ancestor: `353886d1ff7270a6d6bff3c95ccc3c86259f6a28`
- Exception: this slice temporarily stacks on the unmerged R2 tip so R3-1 can reuse R2 schema/receipts surface without waiting for R2 merge. Main / R2 dirty tree / gapfill WT are not modified by this slice.
- Scope: ADR-007 offline registry + Settings UI + shared budget aggregate + model-payload-gate + mock test-connection only. Real dual-vendor connect and R3-2~5 remain pending.
