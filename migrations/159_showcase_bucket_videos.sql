-- Let the public showcase bucket hold short videos for Google Maps.
--
-- The Google Maps page uploads a video here first; Google then downloads it
-- from its public URL (Business Profile v4 media, mediaFormat VIDEO). Google
-- takes videos up to 30 seconds and 75 MB; the bucket allows 50 MB, the
-- largest single upload Supabase accepts on every plan. Images stay limited
-- to 5 MB by the upload field itself.

do $storage$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  update storage.buckets
     set file_size_limit = 52428800,
         allowed_mime_types = array[
           'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
           'video/mp4', 'video/quicktime'
         ]
   where id = 'showcase';
end;
$storage$;
