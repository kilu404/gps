create policy "Users can read own location"
  on public.locations for select to authenticated
  using (user_id = (select auth.uid()));
