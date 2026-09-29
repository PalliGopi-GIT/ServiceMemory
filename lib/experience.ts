import { z } from "zod";
import type { AssetRow, Outcome, ServiceJobRow, UserRow } from "./types";

/**
 * What the LLM extracts from a technician's notes + structured job data (Phase 8).
 * Validated with zod BEFORE anything is stored in Hindsight.
 * The technician-confirmed facts (work, measurements, outcome) are NOT re-decided by the LLM:
 * `outcome` here is only accepted if it matches the technician's outcome (checked in assembleExperience).
 */
export const ExperienceExtractionSchema = z.object({
  symptom: z.string().min(3).max(300),
  intervention: z.string().min(3).max(300),
  /** Short label used for tagging, e.g. "alignment correction". */
  intervention_category: z.string().min(2).max(60),
  outcome: z.enum(["resolved", "partial", "unresolved"]),
  lesson: z.string().min(10).max(600),
  observations: z.array(z.string().min(1).max(300)).max(8).default([]),
});
export type ExperienceExtraction = z.infer<typeof ExperienceExtractionSchema>;

/** Everything Hindsight needs to remember about one completed job. */
export interface ServiceExperience {
  jobId: string;
  assetCode: string;
  assetName: string;
  assetType: string;
  customerName: string;
  location: string;
  technicianName: string;
  reportedProblem: string;
  workPerformed: string;
  partsUsed: string | null;
  beforeMeasurement: number | null;
  afterMeasurement: number | null;
  measurementName: string;
  measurementUnit: string;
  outcome: Outcome;
  technicianNotes: string | null;
  completedAt: string; // ISO 8601
  extraction: ExperienceExtraction;
}

export class ExperienceMismatchError extends Error {}

/** Combine the authoritative DB record with the validated LLM extraction. */
export function assembleExperience(args: {
  job: ServiceJobRow;
  asset: AssetRow;
  technician: Pick<UserRow, "name">;
  extraction: ExperienceExtraction;
}): ServiceExperience {
  const { job, asset, technician, extraction } = args;
  if (job.status !== "completed" || !job.work_performed || !job.outcome || !job.completed_at) {
    throw new ExperienceMismatchError("Job is not completed; refusing to build an experience.");
  }
  if (extraction.outcome !== job.outcome) {
    // The technician is the source of truth for the outcome; never let the LLM override it.
    throw new ExperienceMismatchError(
      `Extracted outcome "${extraction.outcome}" contradicts technician outcome "${job.outcome}".`
    );
  }
  return {
    jobId: job.id,
    assetCode: asset.asset_code,
    assetName: asset.name,
    assetType: asset.type,
    customerName: asset.customer_name,
    location: asset.location,
    technicianName: technician.name,
    reportedProblem: job.problem_description,
    workPerformed: job.work_performed,
    partsUsed: job.parts_used,
    beforeMeasurement: job.before_measurement,
    afterMeasurement: job.after_measurement,
    measurementName: job.measurement_name,
    measurementUnit: job.measurement_unit,
    outcome: job.outcome,
    technicianNotes: job.technician_notes,
    completedAt: job.completed_at,
    extraction,
  };
}

/** Deterministic % change computed from technician-entered numbers (never LLM-computed). */
export function percentChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null;
  return Math.round(((after - before) / before) * 100);
}
