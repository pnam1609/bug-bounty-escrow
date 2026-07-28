-- SR-01: the public program URL is keyed by slug, so changing it would break canonical links.
-- Uniqueness and lowercase kebab-case are already enforced by programs_slug_key and
-- programs_slug_format_check respectively.

create or replace function public.prevent_program_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.slug is distinct from old.slug then
    raise exception using
      errcode = '22023',
      message = 'Program slug cannot be changed after creation',
      detail = 'program_slug_immutable';
  end if;

  return new;
end;
$function$;

create trigger programs_slug_immutable
before update of slug on public.programs
for each row
execute function public.prevent_program_slug_change();
