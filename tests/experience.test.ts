import { describe, expect, it } from "vitest";
import { assembleExperience, ExperienceExtractionSchema, ExperienceMismatchError, percentChange } from "../lib/experience";
import type { AssetRow, ServiceJobRow } from "../lib/types";

const asset: AssetRow = {
  id: "a", asset_code: "P-204", name: "Feed Pump", type: "Industrial Pump",
  customer_name: "Acme", location: "Plant 2", status: "degraded", created_at: "2026-01-01T00:00:00Z",
};
const job: ServiceJobRow = {
  id: "j1", service_request_id: "r1", technician_id: "t1", problem_description: "Vibration",
  work_performed: "Alignment corrected", parts_used: null, before_measurement: 7.9, after_measurement: 2.4,
  measurement_name: "vibration velocity", measurement_unit: "mm/s", outcome: "resolved",
  technician_notes: null, evidence_url: null, status: "completed",
  completed_at: "2026-09-29T09:00:00Z", created_at: "2026-09-29T08:00:00Z",
};
const extraction = ExperienceExtractionSchema.parse({
  symptom: "Excessive vibration", intervention: "Alignment corrected",
  intervention_category: "alignment correction", outcome: "resolved",
  lesson: "Alignment correction resolved the vibration again.",
});

describe("experience extraction validation", () => {
  it("accepts a valid extraction and defaults observations", () => {
    expect(extraction.observations).toEqual([]);
  });
  it("rejects an invalid outcome", () => {
    expect(() => ExperienceExtractionSchema.parse({ ...extraction, outcome: "great" })).toThrow();
  });
  it("rejects a too-short lesson", () => {
    expect(() => ExperienceExtractionSchema.parse({ ...extraction, lesson: "ok" })).toThrow();
  });
});

describe("assembleExperience", () => {
  it("builds from the authoritative job record", () => {
    const e = assembleExperience({ job, asset, technician: { name: "Ravi" }, extraction });
    expect(e.assetCode).toBe("P-204");
    expect(e.afterMeasurement).toBe(2.4);
  });
  it("refuses an LLM outcome that contradicts the technician", () => {
    expect(() =>
      assembleExperience({ job, asset, technician: { name: "Ravi" }, extraction: { ...extraction, outcome: "partial" } })
    ).toThrow(ExperienceMismatchError);
  });
  it("refuses an incomplete job", () => {
    expect(() =>
      assembleExperience({ job: { ...job, status: "in_progress" }, asset, technician: { name: "R" }, extraction })
    ).toThrow(ExperienceMismatchError);
  });
});

describe("percentChange", () => {
  it("computes deterministic reduction", () => expect(percentChange(8.0, 2.7)).toBe(-66));
  it("returns null when a value is missing or before is zero", () => {
    expect(percentChange(null, 2)).toBeNull();
    expect(percentChange(0, 2)).toBeNull();
  });
});
