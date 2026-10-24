create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  sharing_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.locations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision check (accuracy is null or accuracy >= 0),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.locations enable row level security;
alter table public.locations replica identity full;

revoke all on public.admin_users from anon, authenticated;

create or replace function public.is_location_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_location_admin() from public;
grant execute on function public.is_location_admin() to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create or replace function public.set_location_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_location_updated_at
  before insert or update on public.locations
  for each row execute procedure public.set_location_updated_at();

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.locations to authenticated;

create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_location_admin()));

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Admins can read locations"
  on public.locations for select to authenticated
  using ((select public.is_location_admin()));

create policy "Users can share their own location"
  on public.locations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and sharing_enabled
    )
  );

create policy "Users can update their own shared location"
  on public.locations for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and sharing_enabled
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and sharing_enabled
    )
  );

create policy "Users can delete their own location"
  on public.locations for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.locations;
alter publication supabase_realtime add table public.profiles;
