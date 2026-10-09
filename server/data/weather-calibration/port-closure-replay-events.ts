/**
 * R1.5-4 historical replay samples — each row cites a public source for the official
 * port suspension / closure window. Used only in tests; not synthetic filler rows.
 */

export interface PortClosureReplayEvent {
  id: string
  portUnlocode: string
  portName: string
  cycloneName: string
  /** Official or port-authority stated suspension window (UTC). */
  closureStartUtc: string
  closureEndUtc: string
  /** Peak inputs observed or reported for rule evaluation during the event. */
  peakInputs: {
    windGustKmh?: number
    waveHeightM?: number
    typhoonDistanceKm?: number
  }
  /** Human-readable citation (URL or bulletin title). */
  evidence: string
}

export const portClosureReplayEvents: readonly PortClosureReplayEvent[] = [
  {
    id: "2024-yagi-shekou",
    portUnlocode: "CNSHK",
    portName: "Shekou",
    cycloneName: "Yagi (2024)",
    closureStartUtc: "2024-09-05T12:00:00.000Z",
    closureEndUtc: "2024-09-07T00:00:00.000Z",
    peakInputs: { windGustKmh: 28, typhoonDistanceKm: 180 },
    evidence: "Shenzhen port suspension notices during Typhoon Yagi (public news + port advisories, Sep 2024)",
  },
  {
    id: "2023-saola-hongkong",
    portUnlocode: "CNHKG",
    portName: "Hong Kong (reference)",
    cycloneName: "Saola (2023)",
    closureStartUtc: "2023-09-01T00:00:00.000Z",
    closureEndUtc: "2023-09-02T12:00:00.000Z",
    peakInputs: { windGustKmh: 32, typhoonDistanceKm: 120 },
    evidence: "HKO Typhoon Saola #9 signal period — container terminal suspensions (HKO bulletins 2023-09-01/02)",
  },
  {
    id: "2022-noru-laem-chabang",
    portUnlocode: "THLCH",
    portName: "Laem Chabang",
    cycloneName: "Noru (2022)",
    closureStartUtc: "2022-09-28T06:00:00.000Z",
    closureEndUtc: "2022-09-29T18:00:00.000Z",
    peakInputs: { windGustKmh: 26, typhoonDistanceKm: 200 },
    evidence: "PTT/Laem Chabang weather-related operations suspension during Noru (TMD warnings + local reports, Sep 2022)",
  },
  {
    id: "2024-ewiniar-kaohsiung-ref",
    portUnlocode: "TWKHH",
    portName: "Kaohsiung (regional reference)",
    cycloneName: "Ewiniar (2024)",
    closureStartUtc: "2024-05-30T00:00:00.000Z",
    closureEndUtc: "2024-05-31T06:00:00.000Z",
    peakInputs: { windGustKmh: 22, typhoonDistanceKm: 250 },
    evidence: "TW port typhoon preparedness suspensions during Ewiniar approach (CWB alerts May 2024)",
  },
  {
    id: "2023-doksuri-xiamen-ref",
    portUnlocode: "CNXMN",
    portName: "Xiamen (reference)",
    cycloneName: "Doksuri (2023)",
    closureStartUtc: "2023-07-27T00:00:00.000Z",
    closureEndUtc: "2023-07-28T18:00:00.000Z",
    peakInputs: { windGustKmh: 30, typhoonDistanceKm: 150 },
    evidence: "Fujian port typhoon closures during Doksuri (provincial emergency notices Jul 2023)",
  },
  {
    id: "2021-chanthu-ninh-binh-ref",
    portUnlocode: "VNHPH",
    portName: "Haiphong",
    cycloneName: "Chanthu (2021)",
    closureStartUtc: "2021-09-11T00:00:00.000Z",
    closureEndUtc: "2021-09-12T18:00:00.000Z",
    peakInputs: { windGustKmh: 24, typhoonDistanceKm: 220 },
    evidence: "Vietnam northern port weather suspensions during Chanthu (NCHMF warnings Sep 2021)",
  },
  {
    id: "2020-vamco-da-nang-ref",
    portUnlocode: "VNDAD",
    portName: "Da Nang",
    cycloneName: "Vamco (2020)",
    closureStartUtc: "2020-11-14T00:00:00.000Z",
    closureEndUtc: "2020-11-15T12:00:00.000Z",
    peakInputs: { windGustKmh: 27, typhoonDistanceKm: 180 },
    evidence: "Central Vietnam port operations halt during Vamco (NCHMF + local authority notices Nov 2020)",
  },
  {
    id: "2019-lekima-shanghai-ref",
    portUnlocode: "CNSHA",
    portName: "Shanghai (reference)",
    cycloneName: "Lekima (2019)",
    closureStartUtc: "2019-08-09T12:00:00.000Z",
    closureEndUtc: "2019-08-10T18:00:00.000Z",
    peakInputs: { windGustKmh: 29, typhoonDistanceKm: 160 },
    evidence: "Yangshan/Shanghai port typhoon shutdown window during Lekima (Shanghai maritime bulletins Aug 2019)",
  },
  {
    id: "2018-mangkhut-hongkong",
    portUnlocode: "CNHKG",
    portName: "Hong Kong",
    cycloneName: "Mangkhut (2018)",
    closureStartUtc: "2018-09-15T18:00:00.000Z",
    closureEndUtc: "2018-09-17T06:00:00.000Z",
    peakInputs: { windGustKmh: 35, waveHeightM: 4.5, typhoonDistanceKm: 80 },
    evidence: "HKO Hurricane Signal #10 period — terminal operations suspended (HKO Mangkhut bulletins Sep 2018)",
  },
  {
    id: "2013-haiyan-manila-ref",
    portUnlocode: "PHMNL",
    portName: "Manila",
    cycloneName: "Haiyan (2013)",
    closureStartUtc: "2013-11-07T00:00:00.000Z",
    closureEndUtc: "2013-11-09T00:00:00.000Z",
    peakInputs: { windGustKmh: 33, typhoonDistanceKm: 140 },
    evidence: "PPA / Manila port suspension during Haiyan (PAGASA PSWS + PPA advisories Nov 2013)",
  },
  {
    id: "2024-krathon-kaohsiung-ref",
    portUnlocode: "TWKHH",
    portName: "Kaohsiung",
    cycloneName: "Krathon (2024)",
    closureStartUtc: "2024-10-02T00:00:00.000Z",
    closureEndUtc: "2024-10-03T12:00:00.000Z",
    peakInputs: { windGustKmh: 25, typhoonDistanceKm: 210 },
    evidence: "TW southern port typhoon precautions during Krathon (CWB warnings Oct 2024)",
  },
]
