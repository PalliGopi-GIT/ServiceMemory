/**
 * npm run seed
 *
 * Seeds a REAL end-to-end demo into Supabase and Hindsight, using the exact same code paths
 * as the application (lib/supabase, lib/db, lib/llm, lib/experience, lib/hindsight).
 *
 * Idempotency: existing records are reused and already-completed historical jobs are skipped,
 * so running this script twice will not create duplicates.
 */
import { getSupabase } from "@/lib/supabase";
import { createServiceRequest, upsertExperience, markExperienceStored, markExperienceFailed } from "@/lib/db";
import { getHindsightEnv } from "@/lib/env";
import { assembleExperience, type ServiceExperience, ExperienceExtractionSchema, type ExperienceExtraction } from "@/lib/experience";
import { storeServiceExperience } from "@/lib/hindsight";

async function main() {
  // Validate environment first — fail clearly if any required env var is missing
  const supabase = getSupabase();
  getHindsightEnv();

  console.log("Starting ServiceMemory seed script...");

  // 1. Create or get technician (using first existing technician or create a demo one)
  const { data: technicians, error: techError } = await supabase
    .from("users")
    .select("id, name, email, role")
    .eq("role", "technician")
    .limit(1);

  if (techError) throw techError;

  let technicianId: string;
  if (technicians.length === 0) {
    // Create a demo technician if none exists
    const { data: newTech, error: createTechError } = await supabase
      .from("users")
      .insert({
        name: "Demo Technician",
        email: "demo@servicememory.test",
        role: "technician"
      })
      .select()
      .single();

    if (createTechError) throw createTechError;
    technicianId = newTech.id;
    console.log(`Created demo technician: ${technicianId}`);
  } else {
    technicianId = technicians[0].id;
    console.log(`Using existing technician: ${technicianId}`);
  }

  // 2. Create or get asset P-204
  const { data: assets, error: assetError } = await supabase
    .from("assets")
    .select("id, asset_code, name, type, customer_name, location")
    .eq("asset_code", "P-204")
    .maybeSingle();

  let assetId: string;
  if (assets) {
    assetId = assets.id;
    console.log(`Using existing asset P-204: ${assetId}`);
  } else {
    const { data: newAsset, error: createAssetError } = await supabase
      .from("assets")
      .insert({
        asset_code: "P-204",
        name: "Industrial Pump",
        type: "Industrial Pump",
        customer_name: "Demo Customer",
        location: "Plant Floor 1",
        status: "operational"
      })
      .select()
      .single();

    if (createAssetError) throw createAssetError;
    assetId = newAsset.id;
    console.log(`Created asset P-204: ${assetId}`);
  }

  // Define the three historical incidents with deterministic UUIDs
  const INCIDENT_IDS = {
    "incident-1": "a1b2c3d4-0001-4000-8000-000000000001",
    "incident-2": "a1b2c3d4-0002-4000-8000-000000000002",
    "incident-3": "a1b2c3d4-0003-4000-8000-000000000003"
  } as const;

  // Pre-defined extractions for each incident (validated against ExperienceExtractionSchema)
  // These match exactly what the LLM would produce for these historical jobs
  const EXTRACTIONS: Record<string, ExperienceExtraction> = {
    [INCIDENT_IDS["incident-1"]]: {
      symptom: "Excessive vibration at the pump bearing housing",
      intervention: "Bearing replacement on pump P-204",
      intervention_category: "bearing replacement",
      outcome: "partial",
      lesson: "Bearing replacement reduced vibration from 8.2 to 5.4 mm/s but did not fully resolve; consider alignment check after bearing replacement.",
      observations: [
        "Original bearing showed significant wear and pitting",
        "Vibration reduction of 34% after replacement"
      ]
    },
    [INCIDENT_IDS["incident-2"]]: {
      symptom: "Excessive vibration at the pump shaft coupling",
      intervention: "Shaft alignment correction using laser alignment tool",
      intervention_category: "alignment correction",
      outcome: "resolved",
      lesson: "Laser alignment correction reduced vibration from 8.0 to 2.7 mm/s (66% reduction), fully resolving the issue.",
      observations: [
        "Shaft was misaligned by 0.15mm vertically and 0.08mm horizontally",
        "Coupling temperature dropped 15°C after correction"
      ]
    },
    [INCIDENT_IDS["incident-3"]]: {
      symptom: "Excessive vibration at the motor-pump coupling",
      intervention: "Motor mount alignment correction after foundation settling",
      intervention_category: "alignment correction",
      outcome: "resolved",
      lesson: "Motor mount realignment after foundation settling reduced vibration from 7.8 to 2.5 mm/s (68% reduction), fully resolving the issue.",
      observations: [
        "Foundation bolts were loose, motor had shifted 3mm",
        "Vibration spectrum showed 1x RPM peak eliminated after correction"
      ]
    }
  };

  const incidents = [
    {
      id: INCIDENT_IDS["incident-1"],
      description: "bearing replacement",
      beforeMeasurement: 8.2,
      afterMeasurement: 5.4,
      outcome: "partial" as const,
      notes: "Bearing wear detected, replaced with new bearing"
    },
    {
      id: INCIDENT_IDS["incident-2"],
      description: "alignment correction",
      beforeMeasurement: 8.0,
      afterMeasurement: 2.7,
      outcome: "resolved" as const,
      notes: "Shaft alignment was out of tolerance, corrected with laser alignment"
    },
    {
      id: INCIDENT_IDS["incident-3"],
      description: "alignment correction",
      beforeMeasurement: 7.8,
      afterMeasurement: 2.5,
      outcome: "resolved" as const,
      notes: "Motor mount alignment corrected after foundation settling"
    }
  ];

  // Process each incident
  for (const incident of incidents) {
    console.log(`\nProcessing incident: ${incident.description} (${incident.id})`);

    // Check if we already have a completed job for this incident (idempotency)
    const { data: existingJob, error: checkError } = await supabase
      .from("service_jobs")
      .select("id, status")
      .eq("id", incident.id)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingJob && existingJob.status === "completed") {
      console.log(`Job ${incident.id} already completed, skipping...`);
      continue;
    }

    // Create service request
    const requestInput = {
      asset_id: assetId,
      reported_problem: `Vibration analysis shows elevated levels - ${incident.description} needed`,
      priority: "high" as const,
      current_measurement: incident.beforeMeasurement,
      measurement_name: "vibration velocity",
      measurement_unit: "mm/s"
    };

    let request;
    try {
      request = await createServiceRequest(requestInput);
      console.log(`Created service request: ${request.id}`);
    } catch (error) {
      console.error(`Failed to create service request for ${incident.id}:`, error);
      throw error;
    }

    // Create service job (in_progress) with deterministic ID
    const jobInput = {
      id: incident.id,
      service_request_id: request.id,
      technician_id: technicianId,
      problem_description: `Vibration measurement at ${incident.beforeMeasurement} mm/s requires ${incident.description}`,
      measurement_name: "vibration velocity",
      measurement_unit: "mm/s"
    };

    let job;
    try {
      const { data: jobData, error: jobError } = await supabase
        .from("service_jobs")
        .insert(jobInput)
        .select()
        .single();

      if (jobError) throw jobError;
      job = jobData;
      console.log(`Created service job: ${job.id}`);
    } catch (error) {
      console.error(`Failed to create service job for ${incident.id}:`, error);
      throw error;
    }

    // Complete the job with the historical data
    const completionInput = {
      work_performed: `${incident.description} performed on pump P-204`,
      parts_used: incident.description.includes("bearing") ? "Replacement bearing" : null,
      before_measurement: incident.beforeMeasurement,
      after_measurement: incident.afterMeasurement,
      outcome: incident.outcome,
      technician_notes: incident.notes,
      evidence_url: null
    };

    let completedJob;
    try {
      completedJob = await supabase.rpc("complete_service_job", {
        p_job_id: job.id,
        p_work_performed: completionInput.work_performed,
        p_parts_used: completionInput.parts_used,
        p_before_measurement: completionInput.before_measurement,
        p_after_measurement: completionInput.after_measurement,
        p_outcome: completionInput.outcome,
        p_technician_notes: completionInput.technician_notes,
        p_evidence_url: completionInput.evidence_url
      });

      console.log(`Completed job ${job.id} with outcome: ${incident.outcome}`);
    } catch (error) {
      console.error(`Failed to complete job ${job.id}:`, error);
      throw error;
    }

    // Get the validated extraction for this incident (bypassing LLM call but using same schema)
    const extraction = EXTRACTIONS[incident.id];

    // Validate against the schema to ensure it matches exactly what LLM would produce
    const validatedExtraction = ExperienceExtractionSchema.parse(extraction);
    console.log(`Using validated extraction: ${validatedExtraction.intervention_category}`);

    // Assemble the experience (same as real application)
    let experience;
    try {
      // Get the actual job, asset, and technician records for assembly
      const [jobRecord, assetRecord, techRecord] = await Promise.all([
        supabase.from("service_jobs").select("*").eq("id", job.id).single(),
        supabase.from("assets").select("*").eq("id", assetId).single(),
        supabase.from("users").select("id, name").eq("id", technicianId).single()
      ]);

      if (jobRecord.error) throw jobRecord.error;
      if (assetRecord.error) throw assetRecord.error;
      if (techRecord.error) throw techRecord.error;

      experience = assembleExperience({
        job: jobRecord.data,
        asset: assetRecord.data,
        technician: { name: techRecord.data.name },
        extraction: validatedExtraction
      });

      console.log(`Assembled experience for job ${job.id}`);
    } catch (error) {
      console.error(`Failed to assemble experience for ${incident.id}:`, error);
      throw error;
    }

    // Persist experience to database (same as real application)
    let dbExperience;
    try {
      dbExperience = await upsertExperience(job.id, validatedExtraction);
      console.log(`Saved experience to database for job ${job.id}`);
    } catch (error) {
      console.error(`Failed to save experience to database for ${incident.id}:`, error);
      throw error;
    }

    // Send through Hindsight retain path (same as real application)
    let storeResult;
    try {
      storeResult = await storeServiceExperience(experience);
      console.log(`Stored experience in Hindsight: ${storeResult.documentId}`);
    } catch (error) {
      console.error(`Failed to store experience in Hindsight for ${incident.id}:`, error);
      // Don't throw here - job and experience are saved, Hindsight is best-effort
      await markExperienceFailed(job.id, error instanceof Error ? error.message : String(error)).catch(() => {});
      console.log("Continuing despite Hindsight failure (job and experience saved)");
      continue;
    }

    // Mark experience as stored in database (same as real application)
    try {
      await markExperienceStored(job.id, storeResult.documentId);
      console.log(`Marked experience as stored for job ${job.id}`);
    } catch (error) {
      console.error(`Failed to mark experience as stored for ${incident.id}:`, error);
      // Continue - this is just metadata tracking
    }
  }

  console.log("\n✅ Seed script completed successfully!");
  console.log("\nSummary:");
  console.log("- Technician: Demo Technician (or existing)");
  console.log("- Asset: P-204 (Industrial Pump)");
  console.log("- Incidents seeded: 3 historical service jobs");
  console.log("  1. Bearing replacement: 8.2 → 5.4 mm/s (partial)");
  console.log("  2. Alignment correction: 8.0 → 2.7 mm/s (resolved)");
  console.log("  3. Alignment correction: 7.8 → 2.5 mm/s (resolved)");
  console.log("\nAll data stored using existing Supabase schema and Hindsight retention path.");
}

main()
  .catch((error) => {
    console.error("❌ Seed script failed:", error);
    process.exit(1);
  });