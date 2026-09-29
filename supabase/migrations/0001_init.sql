-- ServiceMemory: transactional source of truth.
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent where practical.
-- Hindsight is NOT modelled here: it holds organizational experience, this holds what happened.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- users
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,
  role        text not null default 'technician'
              check (role in ('technician', 'supervisor', 'admin')),
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- assets
create table if not exists assets (
  id             uuid primary key default gen_random_uuid(),
  asset_code     text not null unique,
  name           text not null,
  type           text not null,
  customer_name  text not null,
  location       text not null,
  status         text not null default 'operational'
                 check (status in ('operational', 'degraded', 'down')),
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------- service_requests
create table if not exists service_requests (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references assets(id) on delete restrict,
  reported_problem    text not null,
  priority            text not null default 'medium'
                      check (priority in ('low', 'medium', 'high', 'critical')),
  status              text not null default 'open'
                      check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  current_measurement numeric,
  measurement_name    text not null default 'vibration velocity',
  measurement_unit    text not null default 'mm/s',
  created_at          timestamptz not null default now()
);
create index if not exists service_requests_asset_idx  on service_requests(asset_id);
create index if not exists service_requests_status_idx on service_requests(status);

-- --------------------------------------------------------- service_jobs
create table if not exists service_jobs (
  id                   uuid primary key default gen_random_uuid(),
  service_request_id   uuid not null references service_requests(id) on delete restrict,
  technician_id        uuid not null references users(id) on delete restrict,
  problem_description  text not null,
  work_performed       text,
  parts_used           text,
  before_measurement   numeric,
  after_measurement    numeric,
  measurement_name     text not null default 'vibration velocity',
  measurement_unit     text not null default 'mm/s',
  outcome              text check (outcome in ('resolved', 'partial', 'unresolved')),
  technician_notes     text,
  evidence_url         text,
  status               text not null default 'in_progress'
                       check (status in ('in_progress', 'completed')),
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  -- A completed job must carry the technician-confirmed facts.
  constraint completed_job_has_facts check (
    status <> 'completed'
    or (work_performed is not null and outcome is not null and completed_at is not null)
  )
);
create index if not exists service_jobs_request_idx on service_jobs(service_request_id);
create index if not exists service_jobs_status_idx  on service_jobs(status);

-- ---------------------------------------------------------- experiences
-- One row per completed job: the extracted lesson and whether it reached Hindsight.
create table if not exists experiences (
  id                    uuid primary key default gen_random_uuid(),
  service_job_id        uuid not null unique references service_jobs(id) on delete cascade,
  structured            jsonb not null,
  hindsight_document_id text,
  hindsight_status      text not null default 'pending'
                        check (hindsight_status in ('pending', 'stored', 'failed')),
  hindsight_error       text,
  retained_at           timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists experiences_status_idx on experiences(hindsight_status);

-- ------------------------------------------------- atomic job completion
-- Marks a job and its request completed in ONE transaction, and refuses to run twice.
-- Raises 'ALREADY_COMPLETED' if the job is not in_progress (duplicate submission),
-- 'JOB_NOT_FOUND' if the id is unknown.
create or replace function complete_service_job(
  p_job_id             uuid,
  p_work_performed     text,
  p_parts_used         text,
  p_before_measurement numeric,
  p_after_measurement  numeric,
  p_outcome            text,
  p_technician_notes   text,
  p_evidence_url       text
) returns service_jobs
language plpgsql
as $$
declare
  v_job service_jobs;
begin
  update service_jobs
     set work_performed     = p_work_performed,
         parts_used         = p_parts_used,
         before_measurement = p_before_measurement,
         after_measurement  = p_after_measurement,
         outcome            = p_outcome,
         technician_notes   = p_technician_notes,
         evidence_url       = p_evidence_url,
         status             = 'completed',
         completed_at       = now()
   where id = p_job_id
     and status = 'in_progress'
  returning * into v_job;

  if not found then
    if exists (select 1 from service_jobs where id = p_job_id) then
      raise exception 'ALREADY_COMPLETED';
    end if;
    raise exception 'JOB_NOT_FOUND';
  end if;

  update service_requests set status = 'completed' where id = v_job.service_request_id;
  return v_job;
end;
$$;

-- ---------------------------------------------------------------- RLS
-- All access goes through server routes using the service-role key, which bypasses RLS.
-- Enabling RLS with no policies means the anon/public key can read or write nothing.
alter table users            enable row level security;
alter table assets           enable row level security;
alter table service_requests enable row level security;
alter table service_jobs     enable row level security;
alter table experiences      enable row level security;
