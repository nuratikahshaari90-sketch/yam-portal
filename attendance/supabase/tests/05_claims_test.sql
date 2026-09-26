begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

select plan(15);

select pg_temp.login('farid@yam.test');
select throws_ok($$ select save_claim('{"id":"dddddddd-0000-0000-0000-000000000001","trip_id":"44444444-0000-0000-0000-000000000002","items":[]}') $$,
  'P0001', 'Claims must be linked to one of your approved outstation trips.', 'Cannot claim against someone else''s trip');
select lives_ok($$ select save_claim('{"id":"dddddddd-0000-0000-0000-000000000001","trip_id":"44444444-0000-0000-0000-000000000001","notes":"Extra",
  "items":[{"item_date":"2026-09-16","category":"mileage","description":"Kuantan town to relief centre","distance_km":"42.5"},
           {"item_date":"2026-09-16","category":"meals","description":"Dinner","amount":"18.90","receipt_path":"11111111-0000-0000-0000-000000000004/receipts/a.jpg"}]}') $$,
  'Farid saves a draft claim with two items');
select is((select amount from claim_items where claim_id = 'dddddddd-0000-0000-0000-000000000001' and category = 'mileage'), 25.50,
  'Mileage: 42.5 km x RM0.60 = RM25.50 (calculated by the system)');
select is((select total_amount from claims_view where id = 'dddddddd-0000-0000-0000-000000000001'), 44.40, 'Claim total = RM44.40');
select throws_ok($$ select save_claim('{"id":"dddddddd-0000-0000-0000-000000000002","trip_id":"44444444-0000-0000-0000-000000000001",
  "items":[{"item_date":"2026-09-16","category":"meals","description":"Lunch","amount":"0"}]}') $$,
  'P0001', 'Item 1: please enter the amount in RM.', 'Amount is required');
select throws_ok($$ select save_claim('{"id":"dddddddd-0000-0000-0000-000000000002","trip_id":"44444444-0000-0000-0000-000000000001",
  "items":[{"item_date":"2026-09-16","category":"mileage","description":"Trip"}]}') $$,
  'P0001', 'Item 1: please enter the kilometres travelled.', 'Kilometres required for mileage');
select pg_temp.logout();

-- HR changes the mileage rate before Farid submits: the new rate applies
update app_settings set mileage_rate_per_km = 0.70;
select pg_temp.login('farid@yam.test');
select is((select status::text from submit_claim('dddddddd-0000-0000-0000-000000000001')), 'submitted', 'Farid submits');
select is((select amount from claim_items where claim_id = 'dddddddd-0000-0000-0000-000000000001' and category = 'mileage'), 29.75,
  'Mileage is recalculated with the rate in force at submission (42.5 x 0.70)');
select is((select approver_id from claims where id = 'dddddddd-0000-0000-0000-000000000001'), null, 'Claims go to HR');
select throws_ok($$ select save_claim('{"id":"dddddddd-0000-0000-0000-000000000001","trip_id":"44444444-0000-0000-0000-000000000001","items":[]}') $$,
  'P0001', 'This claim has already been submitted and can no longer be edited.', 'A submitted claim is locked');
select throws_ok($$ select submit_claim('dddddddd-0000-0000-0000-000000000003') $$, 'P0001', 'Claim not found.', 'Unknown claim');
select is((select sum(total_amount) from claims_view where trip_id = '44444444-0000-0000-0000-000000000001'), 810.75,
  'Trip total across claims = 762.10 + 29.75 + 18.90');
select pg_temp.logout();

update app_settings set mileage_rate_per_km = 0.60;
select pg_temp.login('supervisor@yam.test');
select is((select count(*)::int from claims_view), 2, 'Supervisor can see her team''s claims (read only)');
select pg_temp.logout();
select pg_temp.login('meiling@yam.test');
select is((select count(*)::int from claims_view), 2, 'Mei Ling sees only her own claims');
select is((select count(*)::int from claim_items), 4, '... and only her own claim items');
select pg_temp.logout();

select * from finish();
rollback;
