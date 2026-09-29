import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeServiceJob,
  getServiceJob,
  getServiceRequest,
  getAssetByCode,
  getUserById,
  upsertExperience,
  markExperienceStored,
  markExperienceFailed,
  NotFoundError,
  DuplicateCompletionError,
} from "@/lib/db";
import { assembleExperience } from "@/lib/experience";
import { storeServiceExperience, HindsightUnavailableError } from "@/lib/hindsight";
import { extractExperience } from "@/lib/llm";

const CompleteJobBody = z.object({
  work_performed: z.string().min(3).max(2000),
  parts_used: z.string().max(500).nullable().optional(),
  before_measurement: z.number().nullable().optional(),
  after_measurement: z.number().nullable().optional(),
  outcome: z.enum(["resolved", "partial", "unresolved"]),
  technician_notes: z.string().max(2000).nullable().optional(),
  evidence_url: z.string().url().nullable().optional(),
});

/**
 * POST /api/jobs/[id]/complete
 * Full completion pipeline:
 *  1. Validate + complete the job in PostgreSQL (atomic via SQL function).
 *  2. Extract a structured experience with the LLM.
 *  3. Persist the experience in PostgreSQL (experiences table).
 *  4. Retain the experience in Hindsight (async, best-effort — job stays saved even on failure).
 *
 * Response includes the completed job, experience extraction result, and Hindsight status.
 * A Hindsight failure is reported but does NOT cause a 500 — the job is already saved.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CompleteJobBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const completion = parsed.data;

  // 1. Complete the job in PostgreSQL
  let job;
  try {
    job = await completeServiceJob(jobId, {
      work_performed: completion.work_performed,
      parts_used: completion.parts_used ?? null,
      before_measurement: completion.before_measurement ?? null,
      after_measurement: completion.after_measurement ?? null,
      outcome: completion.outcome,
      technician_notes: completion.technician_notes ?? null,
      evidence_url: completion.evidence_url ?? null,
    });
  } catch (e) {
    if (e instanceof DuplicateCompletionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("[POST /api/jobs/[id]/complete] completeServiceJob failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to complete job" },
      { status: 500 }
    );
  }

  // 2. Load asset + technician for experience assembly
  let asset, technician, serviceRequest;
  try {
    serviceRequest = await getServiceRequest(job.service_request_id);
    asset = await getAssetByCode(serviceRequest.asset.asset_code);
    technician = await getUserById(job.technician_id);
  } catch (e) {
    console.error("[POST /api/jobs/[id]/complete] context load failed", e);
    // Job is saved; return a partial success
    return NextResponse.json({
      job,
      experience: null,
      hindsight: { status: "skipped", reason: "Failed to load context for experience extraction" },
    });
  }

  // 3. LLM extraction
  const extractResult = await extractExperience({
    assetCode: asset.asset_code,
    assetType: asset.type,
    reportedProblem: job.problem_description,
    workPerformed: job.work_performed!,
    partsUsed: job.parts_used,
    beforeMeasurement: job.before_measurement,
    afterMeasurement: job.after_measurement,
    measurementName: job.measurement_name,
    measurementUnit: job.measurement_unit,
    outcome: job.outcome!,
    technicianNotes: job.technician_notes,
  });

  if (!extractResult.ok) {
    console.warn("[POST /api/jobs/[id]/complete] extraction failed:", extractResult.reason);
    return NextResponse.json({
      job,
      experience: null,
      hindsight: { status: "skipped", reason: `Experience extraction failed: ${extractResult.reason}` },
    });
  }

  // 4. Assemble + persist experience in PostgreSQL
  let experience;
  try {
    experience = assembleExperience({
      job,
      asset,
      technician,
      extraction: extractResult.extraction,
    });
    await upsertExperience(job.id, extractResult.extraction);
  } catch (e) {
    console.error("[POST /api/jobs/[id]/complete] upsertExperience failed", e);
    return NextResponse.json({
      job,
      experience: null,
      hindsight: {
        status: "skipped",
        reason: `Failed to save experience: ${e instanceof Error ? e.message : String(e)}`,
      },
    });
  }

  // 5. Retain in Hindsight (best-effort; job + experience already saved in PostgreSQL)
  try {
    const storeResult = await storeServiceExperience(experience);
    await markExperienceStored(job.id, storeResult.documentId);
    return NextResponse.json({
      job,
      experience: extractResult.extraction,
      hindsight: {
        status: "stored",
        documentId: storeResult.documentId,
        bankId: storeResult.bankId,
        tags: storeResult.tags,
      },
    });
  } catch (e) {
    const msg = e instanceof HindsightUnavailableError ? e.message : String(e);
    console.warn("[POST /api/jobs/[id]/complete] Hindsight retain failed:", msg);
    await markExperienceFailed(job.id, msg).catch(() => {});
    return NextResponse.json({
      job,
      experience: extractResult.extraction,
      hindsight: { status: "failed", reason: msg },
    });
  }
}
