import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceJob, getServiceRequest } from "@/lib/db";
import { NotFoundError } from "@/lib/db";

const CreateJobBody = z.object({
  service_request_id: z.string().uuid(),
  technician_id: z.string().uuid(),
  problem_description: z.string().min(3).max(1000),
  measurement_name: z.string().min(1).max(100).optional(),
  measurement_unit: z.string().min(1).max(20).optional(),
});

/**
 * POST /api/jobs — create a service job (technician picks up a request).
 * The request must exist. The job is created as "in_progress".
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateJobBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { service_request_id, technician_id, problem_description, measurement_name, measurement_unit } = parsed.data;

  // Verify the request exists
  try {
    await getServiceRequest(service_request_id);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to verify service request" }, { status: 500 });
  }

  try {
    const job = await createServiceJob({
      service_request_id,
      technician_id,
      problem_description,
      measurement_name,
      measurement_unit,
    });
    return NextResponse.json(job, { status: 201 });
  } catch (e) {
    console.error("[POST /api/jobs]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create job" },
      { status: 500 }
    );
  }
}
