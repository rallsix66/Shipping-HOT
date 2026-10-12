/**
 * Research candidates — **not** qualified historical acceptance data.
 * Kept for future audit; each row lacks traceable input provenance and/or official closure locator.
 */

export interface PortClosureReplayCandidate {
  id: string
  portUnlocode: string
  verificationStatus: "blocked"
  blockReason: string
  /** Human audit trail — does not qualify the row. */
  verificationAudit?: string
}

export const portClosureReplayCandidates: readonly PortClosureReplayCandidate[] = [
  { id: "2022-nalgae-shekou-gate", portUnlocode: "CNSHK", verificationStatus: "blocked", blockReason: "Operator notices (portshekou.com/ywgg/1200, /1199) give gate pickup/drop-off stop 11-01 07:00 and resume 11-03 14:00 (no stated zone; UTC+8 inferred). Only weather input is HKO six-hourly best-track distance (post-analysis; user-approved 2026-10-12 14:05 UTC+8 for offline post-hoc replay only, catalog XX-W06; no realtime provider, no port expansion). Source record docs/evidence/r1-5-4-nalgae-source-record-2026-10-12.md. 2026-10-12: entered into the real corpus (qualified-port-closure-replay.ts) as the single post-hoc trial event; this candidate row is kept for audit trail only.", verificationAudit: "2026-10-12: docs/evidence/r1-5-4-eligibility-round2-2026-10-12.md" },
  { id: "2024-yagi-shekou", portUnlocode: "CNSHK", verificationStatus: "blocked", blockReason: "No archived official port suspension bulletin URL/time; peak gust inputs not tied to observation timestamp/source.", verificationAudit: "2026-10-09: 待补码头/港区封港通告 URL 与 UTC 起止；天气输入需绑定观测时刻与来源。" },
  { id: "2023-saola-hongkong", portUnlocode: "CNHKG", verificationStatus: "blocked", blockReason: "HKO signal period ≠ terminal closure window without separate terminal ops notice; inputs not traceable." },
  { id: "2022-noru-laem-chabang", portUnlocode: "THLCH", verificationStatus: "blocked", blockReason: "Closure window and peak inputs not sourced from a single official document." },
  { id: "2024-ewiniar-kaohsiung-ref", portUnlocode: "TWKHH", verificationStatus: "blocked", blockReason: "Reference port outside eight-port scope; inputs unverified." },
  { id: "2023-doksuri-xiamen-ref", portUnlocode: "CNXMN", verificationStatus: "blocked", blockReason: "Reference port outside eight-port scope; inputs unverified." },
  { id: "2021-chanthu-ninh-binh-ref", portUnlocode: "VNHPH", verificationStatus: "blocked", blockReason: "Closure provenance not locator-verified." },
  { id: "2020-vamco-da-nang-ref", portUnlocode: "VNDAD", verificationStatus: "blocked", blockReason: "Closure provenance not locator-verified." },
  { id: "2019-lekima-shanghai-ref", portUnlocode: "CNSHA", verificationStatus: "blocked", blockReason: "Reference port outside eight-port scope." },
  { id: "2018-mangkhut-hongkong", portUnlocode: "CNHKG", verificationStatus: "blocked", blockReason: "Signal #10 period not equal to terminal closure without ops bulletin; gust peak not traceable.", verificationAudit: "2026-10-09: HKO TC 信号时段已粗查，仍缺码头营运封港窗口与可追溯阵风观测配对。" },
  { id: "2013-haiyan-manila-ref", portUnlocode: "PHMNL", verificationStatus: "blocked", blockReason: "PPA suspension times not paired with traceable wind inputs." },
  { id: "2024-krathon-kaohsiung-ref", portUnlocode: "TWKHH", verificationStatus: "blocked", blockReason: "Reference port; inputs unverified." },
]
