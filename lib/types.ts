// Row types mirror supabase/migrations/0001_init.sql exactly.

export type Priority = "low" | "medium" | "high" | "critical";
export type RequestStatus = "open" | "in_progress" | "completed" | "cancelled";
export type JobStatus = "in_progress" | "completed";
export type Outcome = "resolved" | "partial" | "unresolved";
export type HindsightStatus = "pending" | "stored" | "failed";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "technician" | "supervisor" | "admin";
  created_at: string;
}

export interface AssetRow {
  id: string;
  asset_code: string;
  name: string;
  type: string;
  customer_name: string;
  location: string;
  status: "operational" | "degraded" | "down";
  created_at: string;
}

export interface ServiceRequestRow {
  id: string;
  asset_id: string;
  reported_problem: string;
  priority: Priority;
  status: RequestStatus;
  current_measurement: number | null;
  measurement_name: string;
  measurement_unit: string;
  created_at: string;
}

export interface ServiceJobRow {
  id: string;
  service_request_id: string;
  technician_id: string;
  problem_description: string;
  work_performed: string | null;
  parts_used: string | null;
  before_measurement: number | null;
  after_measurement: number | null;
  measurement_name: string;
  measurement_unit: string;
  outcome: Outcome | null;
  technician_notes: string | null;
  evidence_url: string | null;
  status: JobStatus;
  completed_at: string | null;
  created_at: string;
}

export interface ExperienceRow {
  id: string;
  service_job_id: string;
  structured: unknown;
  hindsight_document_id: string | null;
  hindsight_status: HindsightStatus;
  hindsight_error: string | null;
  retained_at: string | null;
  created_at: string;
}

/** A request joined with its asset. */
export interface ServiceRequestWithAsset extends ServiceRequestRow {
  asset: AssetRow;
}

/** A job joined with its technician (for asset history / timeline). */
export interface ServiceJobWithTechnician extends ServiceJobRow {
  technician: Pick<UserRow, "id" | "name">;
}
