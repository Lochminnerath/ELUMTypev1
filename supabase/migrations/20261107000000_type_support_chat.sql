-- ELUM Type: carry on an open ELUM Support request as a chat.
--
-- When the ELUM team has turned live chat on (ELUM Console > Live chat saves the Tawk.to ids in
-- elum.config) and the signed-in person has a support request that is still new or open, Type
-- opens that request as a Tawk.to chat. This function says whether to, and which request. It
-- returns null otherwise, so nobody without an open request loads the chat at all.
--
-- Reads the support form's answers (inquire.responses, ELUM Inquire) and the chat ids (elum.config,
-- ELUM Console). If either is not set up yet it returns null. Safe to run more than once.

create or replace function public.type_support_chat() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid();
  v_property text;
  v_widget text;
  v_request record;
begin
  if v_uid is null or to_regclass('elum.config') is null or to_regclass('inquire.responses') is null then
    return null;
  end if;
  select nullif(btrim(value), '') into v_property from elum.config where key = 'chat.tawk_property';
  select nullif(btrim(value), '') into v_widget from elum.config where key = 'chat.tawk_widget';
  if v_property is null or v_widget is null then
    return null;
  end if;
  select r.id, r.created_at, r.status, nullif(r.answers ->> 'what', '') as kind into v_request
    from inquire.responses r
    join inquire.forms f on f.id = r.form_id
   where f.slug = 'support' and f.owner_id is null
     and r.account_id = v_uid and r.status in ('new', 'open')
   order by r.created_at desc
   limit 1;
  if v_request.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'property', v_property,
    'widget', v_widget,
    'request', jsonb_build_object('id', v_request.id, 'createdAt', v_request.created_at, 'status', v_request.status, 'kind', v_request.kind));
end $$;

revoke execute on function public.type_support_chat() from public, anon;
grant execute on function public.type_support_chat() to authenticated;

-- Check: one row.
select proname from pg_proc where proname = 'type_support_chat';
