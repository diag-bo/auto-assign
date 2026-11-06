-- Labcenter (Delivery Module) calls POST /api/labcenter/failed-jobs whenever it fails
-- to create a job in Cartrack. One row per reference number: a repeat failure re-opens
-- it. A row closes when a Cartrack job with that reference turns up, or by hand.
-- Server-only: RLS on, no policies.
create table if not exists public.labcenter_failed_jobs (
  reference_number text primary key check (reference_number <> ''),
  lc_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  resolved_at timestamptz,
  resolved_by text,
  cartrack_job_id bigint
);
alter table public.labcenter_failed_jobs enable row level security;
create index if not exists labcenter_failed_jobs_open on public.labcenter_failed_jobs (lc_created_at) where resolved_at is null;
