do $$
declare
  business_color_default text;
begin
  select column_default
  into business_color_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'businesses'
    and column_name = 'primary_color';

  if business_color_default not like '%#A78BFA%' then
    raise exception 'New businesses must default to the BookEasy lilac accent';
  end if;
end;
$$;