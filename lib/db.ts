import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import type {
  AssetRow,
  ExperienceRow,
  Outcome,
  Priority,
  ServiceJobRow,
  ServiceJobWithTechnician,
  ServiceRequestRow,
  ServiceRequestWithAsset,
  UserRow,
} from "./types";

/**
 * PostgreSQL / Supabase data layer: the transactional source of truth ("what happened").
 * Every function accepts an optional client so tests can inject a stub.
 */
type Db = SupabaseClient;

export class DbError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "DbError";
  }
}
export class NotFoundError extends DbError {}
export class DuplicateCompletionError extends DbError {}

function fail(op: string, error: { message: string; code?: string }): never {
  throw new DbError(`${op} failed: ${error.message}`, error.code);
}

// ------------------------------------------------------------------ assets
export async function getAssetByCode(code: string, db: Db = getSupabase()): Promise<AssetRow> {
  const { data, error } = await db.from("assets").select("*").eq("asset_code", code).maybeSingle();
  if (error) fail("getAssetByCode", error);
  if (!data) throw new NotFoundError(`Asset ${code} not found`);
  return data as AssetRow;
}

export async function listAssets(db: Db = getSupabase()): Promise<AssetRow[]> {
  const { data, error } = await db.from("assets").select("*").order("asset_code");
  if (error) fail("listAssets", error);
  return (data ?? []) as AssetRow[];
}

// -------------------------------------------------------------- requests
export async function createServiceRequest(
  input: {
    asset_id: string;
    reported_problem: string;
    priority: Priority;
    current_measurement?: number | null;
    measurement_name?: string;
    measurement_unit?: string;
  },
  db: Db = getSupabase()
): Promise<ServiceRequestRow> {
  const { data, error } = await db.from("service_requests").insert(input).select("*").single();
  if (error) fail("createServiceRequest", error);
  return data as ServiceRequestRow;
}

export async function getServiceRequest(
  id: string,
  db: Db = getSupabase()
): Promise<ServiceRequestWithAsset> {
  const { data, error } = await db
    .from("service_requests")
    .select("*, asset:assets(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getServiceRequest", error);
  if (!data) throw new NotFoundError(`Service request ${id} not found`);
  return data as unknown as ServiceRequestWithAsset;
}

export async function listOpenRequests(db: Db = getSupabase()): Promise<ServiceRequestWithAsset[]> {
  const { data, error } = await db
    .from("service_requests")
    .select("*, asset:assets(*)")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false });
  if (error) fail("listOpenRequests", error);
  return (data ?? []) as unknown as ServiceRequestWithAsset[];
}

// ------------------------------------------------------------------ jobs
export async function createServiceJob(
  input: {
    service_request_id: string;
    technician_id: string;
    problem_description: string;
    measurement_name?: string;
    measurement_unit?: string;
  },
  db: Db = getSupabase()
): Promise<ServiceJobRow> {
  const { data, error } = await db.from("service_jobs").insert(input).select("*").single();
  if (error) fail("createServiceJob", error);
  await db.from("service_requests").update({ status: "in_progress" }).eq("id", input.service_request_id).eq("status", "open");
  return data as ServiceJobRow;
}

export async function getServiceJob(id: string, db: Db = getSupabase()): Promise<ServiceJobRow> {
  const { data, error } = await db.from("service_jobs").select("*").eq("id", id).maybeSingle();
  if (error) fail("getServiceJob", error);
  if (!data) throw new NotFoundError(`Service job ${id} not found`);
  return data as ServiceJobRow;
}

export interface CompletionInput {
  work_performed: string;
  parts_used: string | null;
  before_measurement: number | null;
  after_measurement: number | null;
  outcome: Outcome;
  technician_notes: string | null;
  evidence_url: string | null;
}

/**
 * Atomically completes a job + its request via the `complete_service_job` SQL function.
 * A second call for the same job throws DuplicateCompletionError.
 */
export async function completeServiceJob(
  jobId: string,
  input: CompletionInput,
  db: Db = getSupabase()
): Promise<ServiceJobRow> {
  const { data, error } = await db.rpc("complete_service_job", {
    p_job_id: jobId,
    p_work_performed: input.work_performed,
    p_parts_used: input.parts_used,
    p_before_measurement: input.before_measurement,
    p_after_measurement: input.after_measurement,
    p_outcome: input.outcome,
    p_technician_notes: input.technician_notes,
    p_evidence_url: input.evidence_url,
  });
  if (error) {
    if (error.message.includes("ALREADY_COMPLETED"))
      throw new DuplicateCompletionError(`Job ${jobId} is already completed`, error.code);
    if (error.message.includes("JOB_NOT_FOUND")) throw new NotFoundError(`Service job ${jobId} not found`);
    fail("completeServiceJob", error);
  }
  return data as ServiceJobRow;
}

/** Completed jobs for an asset, oldest first, with technician names (drives the timeline). */
export async function listCompletedJobsForAsset(
  assetId: string,
  db: Db = getSupabase()
): Promise<ServiceJobWithTechnician[]> {
  const { data: requests, error: rErr } = await db.from("service_requests").select("id").eq("asset_id", assetId);
  if (rErr) fail("listCompletedJobsForAsset(requests)", rErr);
  const ids = (requests ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("service_jobs")
    .select("*, technician:users(id, name)")
    .in("service_request_id", ids)
    .eq("status", "completed")
    .order("completed_at", { ascending: true });
  if (error) fail("listCompletedJobsForAsset", error);
  return (data ?? []) as unknown as ServiceJobWithTechnician[];
}

export async function getUserById(id: string, db: Db = getSupabase()): Promise<UserRow> {
  const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (error) fail("getUserById", error);
  if (!data) throw new NotFoundError(`User ${id} not found`);
  return data as UserRow;
}

// ----------------------------------------------------------- experiences
export async function upsertExperience(
  jobId: string,
  structured: unknown,
  db: Db = getSupabase()
): Promise<ExperienceRow> {
  const { data, error } = await db
    .from("experiences")
    .upsert({ service_job_id: jobId, structured }, { onConflict: "service_job_id" })
    .select("*")
    .single();
  if (error) fail("upsertExperience", error);
  return data as ExperienceRow;
}

export async function markExperienceStored(
  jobId: string,
  documentId: string,
  db: Db = getSupabase()
): Promise<void> {
  const { error } = await db
    .from("experiences")
    .update({ hindsight_status: "stored", hindsight_document_id: documentId, hindsight_error: null, retained_at: new Date().toISOString() })
    .eq("service_job_id", jobId);
  if (error) fail("markExperienceStored", error);
}

export async function markExperienceFailed(jobId: string, message: string, db: Db = getSupabase()): Promise<void> {
  const { error } = await db
    .from("experiences")
    .update({ hindsight_status: "failed", hindsight_error: message.slice(0, 500) })
    .eq("service_job_id", jobId);
  if (error) fail("markExperienceFailed", error);
}
