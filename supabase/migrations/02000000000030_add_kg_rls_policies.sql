-- =============================================================================
-- Phase 5.3: Knowledge Graph Security Layer (Row Level Security)
-- =============================================================================

alter table public.kg_entities enable row level security;
alter table public.kg_relationships enable row level security;
alter table public.kg_document_attributions enable row level security;
alter table public.kg_confirmed_overrides enable row level security;
alter table public.kg_mutation_log enable row level security;

-- =============================================================================
-- kg_entities policies
-- =============================================================================
create policy "Owner can select own kg_entities"
  on public.kg_entities for select to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is null);

create policy "Owner can update own kg_entities"
  on public.kg_entities for update to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is null)
  with check ((select auth.uid()) = owner_id);

create policy "Service role can select kg_entities"
  on public.kg_entities for select to service_role using (true);

create policy "Service role can insert kg_entities"
  on public.kg_entities for insert to service_role with check (true);

create policy "Service role can update kg_entities"
  on public.kg_entities for update to service_role using (true) with check (true);

create policy "Service role can delete kg_entities"
  on public.kg_entities for delete to service_role using (true);

-- =============================================================================
-- kg_relationships policies
-- =============================================================================
create policy "Owner can select own kg_relationships"
  on public.kg_relationships for select to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is null);

create policy "Owner can update own kg_relationships"
  on public.kg_relationships for update to authenticated
  using ((select auth.uid()) = owner_id and deleted_at is null)
  with check ((select auth.uid()) = owner_id);

create policy "Service role can select kg_relationships"
  on public.kg_relationships for select to service_role using (true);

create policy "Service role can insert kg_relationships"
  on public.kg_relationships for insert to service_role with check (true);

create policy "Service role can update kg_relationships"
  on public.kg_relationships for update to service_role using (true) with check (true);

create policy "Service role can delete kg_relationships"
  on public.kg_relationships for delete to service_role using (true);

-- =============================================================================
-- kg_document_attributions policies
-- =============================================================================
create policy "Owner can select own kg_document_attributions"
  on public.kg_document_attributions for select to authenticated
  using (
    document_id in (
      select id from public.documents
      where owner_id = (select auth.uid()) and deleted_at is null
    )
  );

create policy "Service role can select kg_document_attributions"
  on public.kg_document_attributions for select to service_role using (true);

create policy "Service role can insert kg_document_attributions"
  on public.kg_document_attributions for insert to service_role with check (true);

create policy "Service role can update kg_document_attributions"
  on public.kg_document_attributions for update to service_role using (true) with check (true);

create policy "Service role can delete kg_document_attributions"
  on public.kg_document_attributions for delete to service_role using (true);

-- =============================================================================
-- kg_confirmed_overrides policies
-- =============================================================================
create policy "Owner can select own kg_confirmed_overrides"
  on public.kg_confirmed_overrides for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owner can insert own kg_confirmed_overrides"
  on public.kg_confirmed_overrides for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Owner can update own kg_confirmed_overrides"
  on public.kg_confirmed_overrides for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Owner can delete own kg_confirmed_overrides"
  on public.kg_confirmed_overrides for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Service role can select kg_confirmed_overrides"
  on public.kg_confirmed_overrides for select to service_role using (true);

create policy "Service role can insert kg_confirmed_overrides"
  on public.kg_confirmed_overrides for insert to service_role with check (true);

create policy "Service role can update kg_confirmed_overrides"
  on public.kg_confirmed_overrides for update to service_role using (true) with check (true);

create policy "Service role can delete kg_confirmed_overrides"
  on public.kg_confirmed_overrides for delete to service_role using (true);

-- =============================================================================
-- kg_mutation_log policies
-- =============================================================================
create policy "Owner can select own kg_mutation_log"
  on public.kg_mutation_log for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Service role can select kg_mutation_log"
  on public.kg_mutation_log for select to service_role using (true);

create policy "Service role can insert kg_mutation_log"
  on public.kg_mutation_log for insert to service_role with check (true);
-- No update/delete for service_role on logs
