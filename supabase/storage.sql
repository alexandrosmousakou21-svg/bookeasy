-- Run this migration in the live Supabase SQL editor before using Profile uploads.
insert into storage.buckets (id, name, public)
values ('business-media', 'business-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "public can read business media files" on storage.objects;
create policy "public can read business media files"
on storage.objects for select
to public
using (bucket_id = 'business-media');

drop policy if exists "business owners upload media files" on storage.objects;
create policy "business owners upload media files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'business-media'
  and public.is_business_owner(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "business owners update media files" on storage.objects;
create policy "business owners update media files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'business-media'
  and public.is_business_owner(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'business-media'
  and public.is_business_owner(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "business owners delete media files" on storage.objects;
create policy "business owners delete media files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'business-media'
  and public.is_business_owner(((storage.foldername(name))[1])::uuid)
);