-- Sending to someone on ELUM by their handle or their ELUM Account address.
-- "theo", "theo@elum.services" and "theo@type.elum.services" are the same person. Before this, only the
-- last form reached them; the others were treated as outside email (or as no recipient at all).
-- Safe to run more than once.
create or replace function type.recipients(p_list jsonb)
returns table (address text, name text)
language plpgsql stable security definer set search_path = type, elum, public as $$
declare
  v_domain text := coalesce((select value from elum.config where key = 'type_domain'), 'type.elum.services');
  v_family text := regexp_replace(v_domain, '^type\.', '');
begin
  if p_list is null or jsonb_typeof(p_list) = 'null' then return; end if;
  if jsonb_typeof(p_list) <> 'array' then
    raise exception using errcode = 'PT400', message = 'Recipients must be a list.';
  end if;
  return query
  select distinct on (a.addr) a.addr, a.nm from (
    select case
             when r.raw !~ '@' and r.raw ~ '^[a-z0-9._-]+$' then r.raw || '@' || v_domain
             when split_part(r.raw, '@', 2) in (v_family, 'account.' || v_family)
               and exists (select 1 from type.mailboxes m where m.address = split_part(r.raw, '@', 1) || '@' || v_domain)
               then split_part(r.raw, '@', 1) || '@' || v_domain
             else r.raw
           end as addr,
           r.nm, r.ord
    from (
      select lower(btrim(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e ->> 'address' end)) as raw,
             nullif(left(btrim(case when jsonb_typeof(e) = 'object' then e ->> 'name' end), 80), '') as nm,
             ord
      from jsonb_array_elements(p_list) with ordinality as x (e, ord)
    ) r
  ) a
  where a.addr is not null and a.addr <> ''
  order by a.addr, a.ord;
end $$;
revoke all on function type.recipients(jsonb) from public, anon;
grant execute on function type.recipients(jsonb) to authenticated, service_role;
