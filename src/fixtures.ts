import type { ImportFile, RawRecord } from "./domain.ts";
const row = (
  id: string,
  batch: string,
  parameter: string,
  value: number | string | null,
  unit: string,
  equipment = "P-01",
): RawRecord => ({
  sourceRecordId: id,
  batchCode: batch,
  sampleId: "S01",
  stage: "Forming",
  parameter,
  value,
  unit,
  measuredAt: "2026-11-10T09:15:00.000Z",
  equipment,
});
export const SAMPLE: ImportFile = {
  schemaVersion: 1,
  source: "synthetic-press-run.json",
  records: [
    row("MES-001", "AX-1101", "temperature", 180, "°C"),
    row("MES-002", "AX-1101", "thickness", 2.05, "mm"),
    row("MES-003", "AX-1101", "pressure", 10.2, "bar"),
    row("MES-004", "AX-1102", "temperature", 182, "degC", "P-02"),
    row("MES-005", "AX-1102", "thickness", null, "mm", "P-02"),
    row("MES-006", "AX-1102", "pressure", 10, "bar", "P-02"),
    row("MES-006", "AX-1102", "pressure", 10, "bar", "P-02"),
    row("MES-007", "AX-1102", "temperature", 189, "°C", "P-02"),
    row("MES-008", "AX-1103", "temperature", 198, "°C"),
    row("MES-009", "AX-1103", "thickness", "2,0", "mm"),
    {
      ...row("MES-010", "AX-9999", "pressure", 10, "bar"),
      measuredAt: "not-a-time",
    },
  ],
};
export const GAP_FILL: ImportFile = {
  schemaVersion: 1,
  source: "synthetic-pressure-followup.json",
  records: [row("MES-011", "AX-1103", "pressure", 10.5, "bar")],
};
export const CORRECTION_EXAMPLE = {
  field: "unit" as const,
  value: "°C",
  reason:
    "Synthetic source-owner clarification: MES-004 uses degrees Celsius; degC was an export label transcription error.",
};
