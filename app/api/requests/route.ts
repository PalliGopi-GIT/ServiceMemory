import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRequest, listOpenRequests, getAssetByCode } from "@/lib/db";
import { recallAssetExperience, buildMemoryContext } from "@/lib/hindsight";
import { generateRecommendation } from "@/lib/llm";

/** GET /api/requests — list open/in-progress service requests. */
export async function GET() {
  try {
    const requests = await listOpenRequests();
    return NextResponse.json(requests);
  } catch (e) {
    console.error("[GET /api/requests]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

const CreateRequestBody = z.object({
  asset_code: z.string().min(1),
  reported_problem: z.string().min(3).max(1000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  current_measurement: z.number().nullable().optional(),
  measurement_name: z.string().min(1).max(100).optional(),
  measurement_unit: z.string().min(1).max(20).optional(),
});

/**
 * POST /api/requests
 * 1. Validates input.
 * 2. Looks up the asset.
 * 3. Recalls Hindsight memory for the asset + problem.
 * 4. Generates an evidence-based recommendation (if memory available).
 * 5. Creates the service request in PostgreSQL.
 * 6. Returns { request, memory, recommendation } so the UI can show the recommendation.
 *
 * The recommendation is returned alongside the request but NOT stored in PostgreSQL —
 * it is derived from Hindsight at request time and may change with new evidence.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateRequestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const {
    asset_code,
    reported_problem,
    priority,
    current_measurement,
    measurement_name,
    measurement_unit,
  } = parsed.data;

  // 1. Resolve asset
  let asset;
  try {
    asset = await getAssetByCode(asset_code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  // 2. Recall Hindsight memory for this asset (never throws)
  const recallOutcome = await recallAssetExperience(asset.asset_code, reported_problem);
  const memory = buildMemoryContext(recallOutcome.available ? recallOutcome.items : []);

  // 3. Generate recommendation if memory is available
  let recommendation: Awaited<ReturnType<typeof generateRecommendation>> | null = null;
  if (recallOutcome.available) {
    recommendation = await generateRecommendation({
      assetCode: asset.asset_code,
      assetName: asset.name,
      assetType: asset.type,
      reportedProblem: reported_problem,
      currentMeasurement: current_measurement,
      measurementName: measurement_name,
      measurementUnit: measurement_unit,
      memory,
    });
  }

  // 4. Persist the service request
  let request;
  try {
    request = await createServiceRequest({
      asset_id: asset.id,
      reported_problem,
      priority,
      current_measurement: current_measurement ?? null,
      measurement_name: measurement_name ?? "vibration velocity",
      measurement_unit: measurement_unit ?? "mm/s",
    });
  } catch (e) {
    console.error("[POST /api/requests] createServiceRequest failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create service request" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      request,
      asset,
      memory: {
        available: recallOutcome.available,
        evidenceCount: memory.evidenceCount,
        reason: recallOutcome.available ? undefined : recallOutcome.reason,
      },
      recommendation,
    },
    { status: 201 }
  );
}
