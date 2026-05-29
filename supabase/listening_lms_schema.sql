create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('teacher', 'student');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  lesson_title text not null,
  lesson_path text not null,
  lesson_segment_count integer not null default 0 check (lesson_segment_count >= 0),
  due_at timestamptz,
  note text,
  source_type text not null default 'static_lesson',
  content_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_progress (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  current_segment_index integer not null default 0 check (current_segment_index >= 0),
  completed boolean not null default false,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.segment_progress (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  segment_id text not null,
  segment_index integer not null default 0 check (segment_index >= 0),
  listen_count integer not null default 0 check (listen_count >= 0),
  answer text not null default '',
  submitted boolean not null default false,
  score integer check (score is null or (score >= 0 and score <= 100)),
  submitted_at timestamptz,
  heard_through boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, segment_id)
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists assignments_teacher_idx on public.assignments(teacher_id, created_at desc);
create index if not exists assignments_student_idx on public.assignments(student_id, created_at desc);
create index if not exists segment_progress_student_idx on public.segment_progress(student_id, assignment_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists assignments_touch_updated_at on public.assignments;
create trigger assignments_touch_updated_at
before update on public.assignments
for each row execute function public.touch_updated_at();

drop trigger if exists assignment_progress_touch_updated_at on public.assignment_progress;
create trigger assignment_progress_touch_updated_at
before update on public.assignment_progress
for each row execute function public.touch_updated_at();

drop trigger if exists segment_progress_touch_updated_at on public.segment_progress;
create trigger segment_progress_touch_updated_at
before update on public.segment_progress
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'student'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'teacher', false)
$$;

alter table public.profiles enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_progress enable row level security;
alter table public.segment_progress enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_teacher_select_students" on public.profiles;
create policy "profiles_teacher_select_students"
on public.profiles for select
to authenticated
using (public.is_teacher() and role = 'student');

drop policy if exists "profiles_insert_own_student" on public.profiles;
create policy "profiles_insert_own_student"
on public.profiles for insert
to authenticated
with check (id = auth.uid() and role = 'student');

drop policy if exists "assignments_select_owned" on public.assignments;
create policy "assignments_select_owned"
on public.assignments for select
to authenticated
using (
  student_id = auth.uid()
  or (teacher_id = auth.uid() and public.is_teacher())
);

drop policy if exists "assignments_teacher_insert" on public.assignments;
create policy "assignments_teacher_insert"
on public.assignments for insert
to authenticated
with check (
  teacher_id = auth.uid()
  and public.is_teacher()
  and exists (
    select 1 from public.profiles p
    where p.id = student_id
      and p.role = 'student'
  )
);

drop policy if exists "assignments_teacher_update" on public.assignments;
create policy "assignments_teacher_update"
on public.assignments for update
to authenticated
using (teacher_id = auth.uid() and public.is_teacher())
with check (
  teacher_id = auth.uid()
  and public.is_teacher()
  and exists (
    select 1 from public.profiles p
    where p.id = student_id
      and p.role = 'student'
  )
);

drop policy if exists "assignments_teacher_delete" on public.assignments;
create policy "assignments_teacher_delete"
on public.assignments for delete
to authenticated
using (teacher_id = auth.uid() and public.is_teacher());

drop policy if exists "assignment_progress_select_owned" on public.assignment_progress;
create policy "assignment_progress_select_owned"
on public.assignment_progress for select
to authenticated
using (
  student_id = auth.uid()
  or exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.teacher_id = auth.uid()
      and public.is_teacher()
  )
);

drop policy if exists "assignment_progress_student_insert" on public.assignment_progress;
create policy "assignment_progress_student_insert"
on public.assignment_progress for insert
to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.student_id = auth.uid()
  )
);

drop policy if exists "assignment_progress_student_update" on public.assignment_progress;
create policy "assignment_progress_student_update"
on public.assignment_progress for update
to authenticated
using (student_id = auth.uid())
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.student_id = auth.uid()
  )
);

drop policy if exists "segment_progress_select_owned" on public.segment_progress;
create policy "segment_progress_select_owned"
on public.segment_progress for select
to authenticated
using (
  student_id = auth.uid()
  or exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.teacher_id = auth.uid()
      and public.is_teacher()
  )
);

drop policy if exists "segment_progress_student_insert" on public.segment_progress;
create policy "segment_progress_student_insert"
on public.segment_progress for insert
to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.student_id = auth.uid()
  )
);

drop policy if exists "segment_progress_student_update" on public.segment_progress;
create policy "segment_progress_student_update"
on public.segment_progress for update
to authenticated
using (student_id = auth.uid())
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.student_id = auth.uid()
  )
);

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_teacher() to authenticated;
