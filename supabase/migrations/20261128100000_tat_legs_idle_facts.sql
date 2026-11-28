-- Raw stop facts the "thời gian chết" (idle by choice) report reads. Nothing
-- derived is stored: the minutes are computed on read (lib/idle.ts), so a rule
-- change applies to every archived day without a re-archive.
alter table public.tat_legs
  add column if not exists from_arrived_ts  timestamptz, -- arrival at the from stop (long stay)
  add column if not exists from_ready_at    timestamptz, -- from stop's job ready for the driver (first stop)
  add column if not exists from_due_at      timestamptz, -- from stop's delivery-window END (first stop)
  add column if not exists from_opens_at    timestamptz, -- from stop's window OPENING (waiting for it is not a long stay)
  add column if not exists to_ready_at      timestamptz, -- to stop's job ready, kept even when it post-dates arrival
  add column if not exists to_due_at        timestamptz, -- to stop's delivery-window END
  add column if not exists start_ts         timestamptz, -- seq 1 only: check-in tap before the first stop
  add column if not exists start_bench_mins integer;     -- seq 1 only: expected ride check-in place → first stop
