-- ملفات تقارير الواتساب: رفع للأدمن بس، والقراءة لمن عنده الرابط (اسم عشوائي ٣٢ حرف)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', true, 10485760, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
drop policy if exists "dafter admin uploads reports" on storage.objects;
create policy "dafter admin uploads reports" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reports' and public.is_admin());
