-- OLD is unavailable on INSERT, and only visits have movement fields.
-- Keep those checks inside a separate branch so Postgres never evaluates them
-- for other operations or tables.
create or replace function public.queue_excel_sync() returns trigger
language plpgsql as $$
begin
  if TG_TABLE_NAME = 'visits' and TG_OP = 'UPDATE' then
    if row(old.status, old.company_time_in, old.loading_area_in, old.loading_area_out, old.company_time_out)
       is not distinct from
       row(new.status, new.company_time_in, new.loading_area_in, new.loading_area_out, new.company_time_out) then
      return new;
    end if;
  end if;

  insert into public.excel_sync_queue(entity_type, entity_id)
  values (TG_TABLE_NAME, new.id);
  return new;
end;
$$;
