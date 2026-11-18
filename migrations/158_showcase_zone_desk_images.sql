-- One image per PC zone on the public page: a Standard, VIP or Pro gaming
-- desk with Counter-Strike 2 open on the monitor, stored in the public
-- showcase bucket under each Pixel Gaming club's folder. Zones are matched by
-- name; PlayStation zones keep their GTA IV image (157). Data only.

update showcase_pc_zones z
set image_url = 'https://vmhpsizkzbtsjblrieie.supabase.co/storage/v1/object/public/showcase/'
  || z.club_id || case
    when z.name ilike '%vip%' then '/zone-vip.jpg'
    when z.name ilike '%pro%' then '/zone-pro.jpg'
    else '/zone-standard.jpg'
  end
where z.club_id in ('7a9c8427-9cf1-45d2-8df5-7f9ca9fdf305', '8390a015-5f28-4f78-a5a2-302dd61852a7')
  and coalesce(z.kind, 'pc') = 'pc';
