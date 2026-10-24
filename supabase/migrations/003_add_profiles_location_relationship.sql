insert into public.profiles (id, display_name)
select
  users.id,
  nullif(users.raw_user_meta_data ->> 'display_name', '')
from auth.users as users
on conflict (id) do nothing;

alter table public.locations
  add constraint locations_user_id_profiles_fkey
  foreign key (user_id)
  references public.profiles (id)
  on delete cascade;
