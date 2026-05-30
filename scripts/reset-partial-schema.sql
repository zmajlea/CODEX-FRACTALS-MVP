-- Run in SQL Editor ONLY if a previous migration attempt failed partway through.
-- Safe on an empty project; drops enums/helpers left from a failed first pass.

drop function if exists public.set_updated_at() cascade;

drop type if exists public.temporal_object_kind cascade;
drop type if exists public.record_status cascade;
drop type if exists public.user_role cascade;
