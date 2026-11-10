-- Insert Note update 2: note types (romantic / hangout / fun) and handwritten notes.
-- Paste into Supabase > SQL Editor and press Run. Safe to run more than once.

alter table public.notes add column if not exists kind text not null default 'hang_any';
alter table public.notes add column if not exists drawing text;
alter table public.notes drop constraint if exists notes_color_check;
alter table public.notes drop constraint if exists notes_activity_check;
alter table public.notes drop constraint if exists notes_kind_check;
alter table public.notes add constraint notes_kind_check
  check (kind in ('rom_mw','rom_mm','rom_ww','rom_open','hang_guy','hang_girl','hang_any','fun'));
alter table public.notes drop constraint if exists notes_content_check;
alter table public.notes add constraint notes_content_check check (
  char_length(activity) <= 80
  and (char_length(activity) >= 3 or drawing is not null)
  and (drawing is null or (drawing like 'data:image/png;base64,%' and char_length(drawing) <= 120000)));

drop function if exists public.leave_note(text,text,text,text,text);
create or replace function public.leave_note(p_slot text, p_kind text, p_activity text, p_drawing text, p_name text, p_contact text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_color text;
begin
  if not public.is_approved() then raise exception 'not_approved'; end if;
  v_color := case p_kind
    when 'rom_mw' then 'pink' when 'rom_mm' then 'blue' when 'rom_ww' then 'violet' when 'rom_open' then 'coral'
    when 'hang_guy' then 'green' when 'hang_girl' then 'teal' when 'hang_any' then 'yellow' when 'fun' then 'white' end;
  if v_color is null then raise exception 'bad_kind'; end if;
  if p_kind <> 'fun' and (char_length(trim(coalesce(p_name, ''))) < 1 or char_length(trim(coalesce(p_contact, ''))) < 3) then
    raise exception 'missing_details';
  end if;
  if (select count(*) from public.notes where author = auth.uid() and pulled_by is null and pulled_at is null) >= 3 then
    raise exception 'limit';
  end if;
  begin
    insert into public.notes (slot, kind, activity, drawing, color, author)
    values (p_slot, p_kind, left(trim(coalesce(p_activity, '')), 80), nullif(p_drawing, ''), v_color, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then raise exception 'slot_taken';
    when check_violation then raise exception 'bad_note';
  end;
  insert into public.note_secrets (note_id, name, contact)
  values (v_id,
    case when p_kind = 'fun' then '' else left(trim(p_name), 20) end,
    case when p_kind = 'fun' then '' else left(trim(p_contact), 32) end);
  return v_id;
end $$;

revoke all on function public.leave_note(text,text,text,text,text,text) from public, anon;
grant execute on function public.leave_note(text,text,text,text,text,text) to authenticated;
