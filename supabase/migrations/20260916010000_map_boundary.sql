begin;

alter table public.zombie_maps add column if not exists boundary jsonb;

create or replace function public.zr_validate_boundary() returns trigger
language plpgsql set search_path='' as $$
declare point jsonb;
begin
 if new.boundary is null then return new; end if;
 if jsonb_typeof(new.boundary) <> 'array' then raise exception 'Invalid boundary'; end if;
 if jsonb_array_length(new.boundary) not between 3 and 200 then raise exception 'Invalid boundary length'; end if;
 for point in select value from jsonb_array_elements(new.boundary) loop
  if jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lon') is distinct from 'number'
   then raise exception 'Invalid boundary coordinates'; end if;
  if not((point->>'lat')::double precision between -90 and 90)
   or not((point->>'lon')::double precision between -180 and 180) then raise exception 'Invalid boundary coordinates'; end if;
 end loop;
 return new;
end $$;
revoke all on function public.zr_validate_boundary() from public, anon, authenticated;
drop trigger if exists zr_validate_boundary on public.zombie_maps;
create trigger zr_validate_boundary before insert or update on public.zombie_maps
 for each row execute function public.zr_validate_boundary();

notify pgrst, 'reload schema';
commit;
