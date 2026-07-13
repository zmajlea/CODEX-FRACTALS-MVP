-- Allow CPAs to override semantic continuity tokens on top of a base data-brand preset.

create or replace function public.normalize_module_branding(p_branding jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_branding jsonb := coalesce(p_branding, '{}'::jsonb);
  v_preset text;
  v_key text;
  v_val text;
  v_allowed text[] := array[
    '--brand', '--brand-2', '--seal', '--foil',
    '--canvas', '--paper', '--ink', '--cinnabar'
  ];
begin
  v_preset := nullif(trim(v_branding ->> 'data-brand'), '');

  if v_preset is not null and v_preset not in (
    'ff1', 'ff2', 'ff3', 'ff4', 'fractals', 'summit'
  ) then
    raise exception 'Invalid data-brand preset: %', v_preset;
  end if;

  if v_branding ? 'wordmark' then
    v_branding := v_branding || jsonb_build_object(
      'wordmark', left(trim(v_branding ->> 'wordmark'), 120)
    );
  end if;

  foreach v_key in array v_allowed loop
    if v_branding ? v_key then
      v_val := nullif(trim(v_branding ->> v_key), '');
      if v_val is not null then
        if v_val !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
          raise exception 'Invalid color for %: %', v_key, v_val;
        end if;
        v_branding := v_branding || jsonb_build_object(v_key, lower(v_val));
      else
        v_branding := v_branding - v_key;
      end if;
    end if;
  end loop;

  return v_branding;
end;
$$;
