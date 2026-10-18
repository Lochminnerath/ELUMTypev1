-- Assertion helpers for the *.test.sql files, run as whoever is signed in.
create function public.expect_error(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL %: expected error %, but it succeeded', p_label, p_code;
exception when others then
  if sqlstate <> p_code then
    raise exception 'FAIL %: expected %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
  end if;
end $$;
create function public.expect(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL %', p_label; end if;
end $$;
grant execute on function public.expect_error(text, text, text), public.expect(boolean, text) to authenticated;
