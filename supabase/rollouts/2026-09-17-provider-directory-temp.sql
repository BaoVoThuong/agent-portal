-- =====================================================================
-- Bảng tạm `provider_directory`: bản dữ liệu provider ĐÃ LÀM SẠCH.
--
-- Vì sao tách bảng: `provider_address` bị luồng sync xoá sạch rồi chèn lại mỗi
-- đêm 02:00 (promote_sheet_sync_run xoá theo cặp source_sheet_id+source_gid).
-- Mọi chỉnh sửa trên đó sống không quá một đêm. Bảng này nằm ngoài tầm với của
-- sync, nên vừa sạch vừa sửa được, mà KHÔNG phải tắt sync ngay.
--
-- Dữ liệu vào đây đã qua:
--   • bỏ 437 dòng rỗng hoàn toàn (đuôi trống của Sheet, chỉ có "Yes" ở cột
--     Accepting new patients);
--   • tách 6 dòng nhiều cơ sở thành 13 bản ghi (địa chỉ/điện thoại/ZIP khớp số);
--   • gộp 10 dòng nhiều số điện thoại hoặc nhiều tên cơ sở về một ô;
--   • chuẩn hoá điện thoại về (XXX) XXX-XXXX, bang về mã 2 chữ, ZIP+4 còn 5 số,
--     bỏ khoảng trắng thừa và dấu gạch nối lạ (U+2011).
-- 451 dòng thật → 458 bản ghi. 24 dòng còn vấn đề được đánh `needs_review`.
--
-- Idempotent: chạy lại sẽ KHÔNG nhân đôi (chỉ seed khi bảng rỗng).
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

create table if not exists provider_directory (
  id uuid primary key default gen_random_uuid(),
  doctors text,
  facility text,
  npi text,
  practices_as text,
  phone text,
  street text,
  city text,
  state text,
  zip_code text,
  accepting_new_patients text,
  business_hours text,
  obamacare text,
  medicare text,
  other_plans text,
  verified_by text,
  date text,
  custom_values jsonb not null default '{}'::jsonb,
  -- Dòng nào còn vấn đề người phải xử: địa chỉ gãy dòng, ZIP giả (78xxx),
  -- hoặc street chỉ ghi "X's Locations" thay vì địa chỉ thật.
  needs_review boolean not null default false,
  -- Vết dẫn ngược về Google Sheet để đội còn tra được. KHÔNG phải khoá:
  -- một dòng Sheet có thể tách thành nhiều bản ghi ở đây.
  source_row_number integer,
  created_by_email text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists provider_directory_active_idx
  on provider_directory (archived_at, updated_at desc);
create index if not exists provider_directory_npi_idx on provider_directory (npi);
create index if not exists provider_directory_city_idx on provider_directory (city, state);

-- Bật bảo vệ hàng và KHÔNG tạo policy nào: chỉ service role đọc/ghi được bảng
-- này. Toàn bộ đường vào đều đi qua `getSupabaseAdmin()` (trang server, hai
-- route API, và Provider Finder), mà service role bỏ qua bảo vệ hàng — nên bật
-- lên không chặn tính năng nào, chỉ chặn khoá công khai của trình duyệt.
--
-- Bảng mới KHÔNG tự được hưởng: vòng lặp bật hàng loạt trong schema.sql chạy
-- trên một danh sách tên bảng ghi cứng, nên bảng nào không có tên trong đó thì
-- mãi không được bật. Tên `provider_directory` đã được thêm vào danh sách ấy để
-- lần dựng lại database từ đầu vẫn còn bảo vệ này.
alter table provider_directory enable row level security;

-- Chỉ seed khi bảng còn rỗng: chạy lại file này không nhân đôi dữ liệu, và
-- không đụng vào những gì người dùng đã sửa sau đó.
do $$
begin
  if (select count(*) from provider_directory) > 0 then
    raise notice 'provider_directory đã có dữ liệu — bỏ qua bước seed.';
    return;
  end if;

  insert into provider_directory (
    doctors, facility, npi, practices_as, phone, street, city, state, zip_code,
    accepting_new_patients, business_hours, obamacare, medicare, other_plans,
    verified_by, date, source_row_number, needs_review
  ) values
  ('Hoang Anh Phan', 'Houston Methodist Primary Care Group', '1407020035', 'PCP - Adults', '(281) 737-8300', '18220 State Highway 249', 'Houston', 'TX', '77070', 'Yes', 'Mon - Fri: 9am - 4pm
Sat: 9am - 2pm', 'Ambetter HMO, Ambetter EPO, BCBS Advantage, CHC Premier, CHC Select, UHC', 'Healthspring/Cigna, UHC', null, null, '04/06/2026', 2, false),
  ('Hoang Anh Phan', 'Progressive Medical Clinic LLP', '1407020035', 'PCP - Adults', '(281) 481-1197', '11920 Astoria Blvd Ste 300', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 9am - 4pm
Sat: 9am - 2pm', 'Ambetter HMO, Ambetter EPO, BCBS Advantage, CHC Premier, CHC Select, UHC', 'Healthspring/Cigna, UHC', null, null, '04/06/2026', 2, false),
  ('Hoang Anh Phan', 'Willow Creek Hospice LLC', '1407020035', 'PCP - Adults', '(832) 644-0200', '7111 Harwin Dr Ste 201', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9am - 4pm
Sat: 9am - 2pm', 'Ambetter HMO, Ambetter EPO, BCBS Advantage, CHC Premier, CHC Select, UHC', 'Healthspring/Cigna, UHC', null, null, '04/06/2026', 2, false),
  ('Huy Q. Le', 'Mtl. MD Pllc', '1750645859', 'PCP - Adults', '(281) 481-6663', '12600 Scarsdale Blvd Ste A', 'Houston', 'TX', '77089', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri - Sat: 8:30am - 1:00pm', 'Oscar HMO, Oscar EPO, Ambetter EPO, CHC Premier, UHC, BCBS Advantage', null, null, null, '04/06/2026', 3, false),
  ('Connie Pham', null, '1730165648', 'PCP - Adults', '(346) 220-6388', '7850 Parkwood Cir Dr Ste A-7', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'CHC Premier, CHC Select', null, null, null, '04/06/2026', 4, false),
  ('Vi Nguyen', 'Prompt Care Medical Doctors', '1225265192', 'PCP - Adults', '(713) 270-0909', '9999 Bellaire Blvd, Ste 370', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:30 AM - 5:00 PM
Sat: 8:30 AM - 12:30 PM', 'BCBS Advantage, CHC Select, UHC', 'BCBS, Healthspring/Cigna, CHC D-SNP', null, null, '04/06/2026', 5, false),
  ('Vinh Q. Le', 'Peachtree Medical', '1659346856', 'PCP - Adults', '(832) 327-7700', '10411 Veterans Memorial Dr Ste A', 'Houston', 'TX', '77038', 'Yes', 'Mon -  Tues: 7:00am - 6:30pm
Wed: 8:00am - 1:00pm
Thurs - Fri: 7:00am - 6:30pm
Sat: 8:00am - 1:00pm', 'Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', 'Verda, CHC D-SNP', null, null, '04/06/2026', 6, false),
  ('Jamie A. Ngo', 'Eldridge Pointe Pediatrics PLLC', '1376699512', 'PCP - Children', '(832) 939-8956', '126 Eldridge Rd Ste D', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
Sat: 8:30am - 12:30pm', 'CHC Premier, CHC Select', 'CHC D-SNP', null, null, '04/06/2026', 7, false),
  ('Duc Phan', 'Sunrise Comprehensive Healthcare', '1083946693', 'PCP - Adults', '(832) 328-1437', '10603 Bellaire Blvd', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:30 am - 5:00pm
Sat: 9:00am - 2:00pm', 'CHC Premier, CHC Select, Molina, BCBS Advantage, Ambetter HMO, Ambetter EPO', 'All Medicare Plans', null, null, '04/06/2026', 8, false),
  ('Bao Pham (Bao Tommy)', 'Pham Medical Clinic Pa', '1417098500', 'PCP - Adults', '(281) 531-5293', '12545 Briar Forest Dr Ste A', 'Houston', 'TX', '77077', 'Yes', 'Mon - Wed: 8:00am - 4:00pm
Thurs: 7:00am - 3:00pm
Fri: 7:00am - 11:00am', 'Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Molina, CHC Premier', null, null, null, '04/06/2026', 9, false),
  ('Lisa Nguyen (Lisa My Phung Nguyen)', 'ABCD Pediatrics', '1598347189', 'PCP - Children', '(210) 566-4777', '2200 Roy Richard Drive', 'Schertz', 'TX', '78154', 'Yes', 'Mon - Fri:  8:00am - 5:00pm
Sat: 8:00am - 12:00pm', 'UHC, Oscar HMO, Oscar EPO', null, null, null, '04/06/2026', 10, false),
  ('Rosen Trinidad', 'Village Medical', '1841725991', 'PCP - Adults', '(726) 200-1691', '6017 Ingram Rd #102', 'San Antonio', 'TX', '78238', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, UHC', null, null, null, '04/06/2026', 11, false),
  ('Charles Phan', 'Memorial Hermann, Texas Digestive Deseas Consultants', '1457303737', 'Gastroenterology', '(281) 277-2213', '16659 Southwest Fwy, Ste 175', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, CHC Premier, UHC', null, null, null, '04/06/2026', 12, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', 'Hillside''s Locations', 'San Antonio', 'TX', '78xxx', 'Yes', 'Hillside''s Locations', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 13, true),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '2207 S Clear Creek Rd, Suite 303', 'Killeen', 'TX', '76549', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 14, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '1009 NW Loop 410', 'Castle Hills', 'TX', '78216', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 15, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '232 Brite Rd, Suite 117', 'Cibolo', 'TX', '78108', 'Yes', 'Mon - Fri: 7:00am - 4:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 16, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '1923 Culebra Rd', 'San Antonio', 'TX', '78201', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 17, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '840 E Redd Rd', 'El Paso', 'TX', '79912', 'Yes', 'Mon - Fri: 7:00am - 4:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 18, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '2201 S W S Young Dr, Suite 111-B', 'Killeen', 'TX', '76543', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 19, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults, Location Closed', '(210) 742-6555', '1300 Dacy Ln, Suite 110', 'Kyle', 'TX', '78640', 'No', 'Mon - Fri: 8:00am - 5:00pm (Coming soon)', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 20, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '6430 Bandera Rd, Suite 98', 'San Antonio', 'TX', '78238', 'Yes', 'Mon - Fri: 7:30am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 21, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '12881 I-35 N', 'Live Oak', 'TX', '78233', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
Sat: 8:00am - 2:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 22, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '4926 Golden Quail Dr, Suite 104', 'San Antonio', 'TX', '78240', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 23, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '741 Generation Dr, Suite 210', 'New Braunfels', 'TX', '78130', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 24, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '17766 Verde Pkwy Suite 200', 'Schertz', 'TX', '78154', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 25, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '519 N King St, Suite 101', 'Seguin', 'TX', '78155', 'Yes', 'Mon, Wed, Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 26, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '3710 Roosevelt Ave', 'San Antonio', 'TX', '78214', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 27, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '26081 Bulverde Rd', 'San Antonio', 'TX', '78261', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 28, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '2009 Pat Booker Rd', 'Universal City', 'TX', '78148', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 29, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '5253-2 Walzem Rd', 'Windcrest', 'TX', '78218', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 30, false),
  ('Derinbal Patel', 'Hillside Primary Care', '1306165014', 'PCP - Adults', '(210) 742-6555', '10423 State Hwy 151, Suite 105', 'San Antonio', 'TX', '78251', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC, Wellpoint', 'Aetna, Healthspring/Cigna, Humana, UHC, Wellcare, Molina, BCBS', null, null, '04/06/2026', 31, false),
  ('Laurie Incledon
Keisha Wiles
(submit bills under Derinbal Patel)', 'Women''s Wellness Center Of SA', null, 'OBGYN', '(210) 858-9767', '12410 Toepperwein Rd', 'Live Oak', 'TX', '78233', 'Yes', 'Wed - Fri: 8am - 5pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, UHC', null, null, null, '04/06/2026', 32, false),
  ('Centromed PCP', 'Centromed', null, 'PCP - Family (Adults and Children)', '(210) 922-7000', 'Centromed''s Locations', 'San Antonio', 'TX', '78xxx', 'Yes', 'Based on each location', 'Oscar HMO, Oscar EPO, BCBS MyBlue Health, UHC', null, null, null, '04/06/2026', 33, true),
  ('Jean Anthony Do', 'Northeast OBGYN', '1962454694', 'OBGYN', '(210) 653-5501', '1139 East Sonterra Blvd Suite 205', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage, UHC', null, null, null, '04/06/2026', 34, false),
  ('Specialists', 'San Antonio Specialty Health & Sport Medicinces', null, 'Specialists', '(210) 229-7242', '1200 Brooklyn Ave, , Suite #320', 'San Antonio', 'TX', '78212', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage, UHC, BCBS MyBlue Health, UHC Sanitas', null, null, null, '04/06/2026', 35, true),
  ('Methodist Hospital', 'Methodist Hospital', null, 'Hospital', '(210) 575-4000', '7700 Floyd Curl Dr', 'San Antonio', 'TX', '78229', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', 'Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, Imperial', null, null, null, '04/06/2026', 36, false),
  ('Wendy Thuy Nguyen', 'Wellmed', '1982602702', 'PCP - Adults', '(210) 496-7999', '19114 U.S. Hwy 281 N', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 37, false),
  ('ThanhVi D. Nguyen', 'HealthTexas Primary Care Doctors', '1669039954', 'Does not take ACA', '(210) 546-1600', '20821 US Hwy 281 N Ste 122', 'San Antonio', 'TX', '78258', 'No', 'Mon/Thurs/Fri: 7:00am - 5pm
Tue: 7:00am - 8:00pm
Wed: 10:00am - 5:00pm', null, null, null, null, '04/06/2026', 38, false),
  ('Cedilia Silva', 'AdventHealth Medical Group Family Medicine at Harker Heights', '1124537881', 'Does not take ACA', '(254) 519-8922', '3035 Stillhouse Lake Dr', 'Harker Heights', 'TX', '76548', 'No', 'Mon - Fri: 7:00am - 7:00pm', null, null, null, null, '04/06/2026', 39, false),
  ('Cuong Trinh', null, '1871537837', 'PCP - Adults', '(281) 495-1950', '7991 S Dairy Ashford Rd', 'Houston', 'TX', '77099', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
Sat: 8:00am - 12:00pm', 'Oscar HMO, Oscar EPO, Molina, Ambetter EPO, UHC', 'Aetna, Healthspring/Cigna, Humana, Wellcare, Wellpoint', null, null, '04/06/2026', 40, false),
  ('Khoa Pham', 'Hope Clinic', '1265843668', 'PCP - Family (Adults and Children)', '(713) 773-0803', 'Hope Clinic''s Locations', 'Houston', 'TX', '77xxx', 'Yes', 'Based on each location', 'Oscar HMO, Oscar EPO, Ambetter EPO, CHC Premier, CHC Select, Molina, UHC', null, null, null, '04/06/2026', 41, true),
  ('Alexander S. Roka, MD', 'Roka Health', '1982602264', 'PCP - Adults', '(210) 403-3220', '20658 Stone Oak Pkwy #108', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, UHC', null, null, null, '04/06/2026', 42, false),
  ('Quynh Lam', 'Memorial Hermann', '1235373804', 'Nephrology', '(832) 230-5139', '10080 Bellaire Blvd, Ste 108', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Ambetter HMO, CHC Premier, CHC Select, UHC', null, null, null, '04/06/2026', 43, false),
  ('Richard A Le', 'Primecare Medical Center', '1356662779', 'PCP - Adults', '(480) 597-5270', '2855 E Brown Rd Ste 15', 'Mesa', 'AZ', '85213', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, UHC, Ambetter EPO', 'Verda', null, null, '04/06/2026', 44, false),
  ('Alex P Nguyen', 'Oncology Consultants', '1922069624', 'Oncology, Hematology', '(713) 827-9525', '925 Gessner Rd #600', 'Houston', 'TX', '77024', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 45, false),
  ('Kien A Nguyen', 'Women''s Specialists of Katy', '1043501455', 'OBGYN', '(281) 398-2140', '21700 Kingsland Blvd Ste 203', 'Katy', 'TX', '77450', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri: 8:30am - 12:30pm', 'UHC, Oscar HMO, Oscar EPO, CHC Premier, CHC Select', null, null, 'Ngan Nguyen', '01/06/2026', 46, false),
  ('Mai T. Vu', 'Women''s Specialists of Katy', '1700049582', 'OBGYN', '(281) 398-2140', '23964 Katy Freeway, Suite 400', 'Katy', 'TX', '77494', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri: 8:30am - 12:30pm', 'UHC, Oscar HMO, Oscar EPO, CHC Premier, CHC Select', null, null, 'Ngan Nguyen', '01/06/2026', 47, false),
  ('E. Leon Etter II, MD', 'Southwest Surgical Associates', '1457302390', 'General Surgeon', '(713) 772-1200', '1315 St Joseph Pkwy suite 1708', 'Houston', 'TX', '77002', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter EPO, Ambetter HMO, BCBS Advantage, CHC Premier, Molina', null, null, null, '04/06/2026', 48, false),
  ('Bong Q Mui', 'HCA Houston Healthcare NorthwestHouston, TX Memorial Hermann Greater Heights HospitalHouston, TX', '1487618435', 'PCP - Adults', '(713) 955-3919', '11417 Veterans Memorial Dr', 'Houston', 'TX', '77067', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, UHC, Ambetter HMO, Ambetter EPO, CHC Premier', 'CHC Dualcare', null, null, '04/06/2026', 49, false),
  ('Nam Ho', 'Rudolph Medical Associates PA', '1730344185', 'PCP - Adults', '(713) 457-5500', '12924 Bellaire Ste 100', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Ambetter EPO, BCBS Advantage, CHC Premier, Molina', null, null, null, '04/06/2026', 50, false),
  ('Na Vang', 'Rudolph Medical Associates PA', '1518399344', 'PCP - Adults', '(713) 457-5500', '12924 Bellaire Ste 100', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Ambetter EPO, BCBS Advantage, CHC Premier, Molina', null, null, null, '04/06/2026', 51, false),
  ('Binh T Nguyen', 'The Kidney Institute', '1881696888', 'Nephrology', '(281) 866-9995', '10425 Huffmeister Rd, Ste 250', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'UHC, CHC Select, BCBS Advantage', null, null, null, '04/06/2026', 52, false),
  ('Hanh Truong', 'Hanh Truong, M.D., Pa (Doctor''s Office)', '1912998618', 'PCP - Adults', '(281) 265-5505', '16651 Southwest Fwy Ste 340', 'Sugar Land', 'TX', '77479', 'No', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage, UHC', null, null, null, '04/06/2026', 53, false),
  ('Vinh L. Nguyen', 'Care Pediatric Clinic', '1871756940', 'PCP - Children', '(713) 637-9575, (832) 770-9069', '6918 Wilcrest Dr Ste B', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 6:00pm
Sat: 9:00am - 1:00pm', 'Ambetter HMO, Ambetter EPO, CHC Premier, CHC Select, UHC, BCBS MyBlue Health, BCBS Advantage', null, null, null, '04/06/2026', 54, false),
  ('Anhthu Bui', 'Primecare Medical Center', '1164994570', 'PCP - Adults, Nurse Practitioner', '(281) 631-0202', 'Primecare''s Locations', 'Houston', 'TX', '77067', 'Yes', 'Mon - Fri: 9:00am - 6:00pm', 'Oscar HMO, Oscar EPO, CHC Premier, CHC Select, BCBS MyBlue Health, BCBS Advantage, UHC', 'Healthspring/Cigna, UHC', null, null, '04/06/2026', 55, true),
  ('Tony Chuong', 'Arlington Primary Clinic', '1922056803', 'PCP - Adults', '(817) 394-0240', '4860 Matlock Rd Ste 140', 'Arlington', 'TX', '76018', 'Yes', 'Mon/Tue/Thurs/Fri: 8:30am - 5:00 pm
Wed/Sat: 8:30am - 12:00pm', 'Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', 'BCBS, Healthspring/Cigna', null, null, '04/06/2026', 56, false),
  ('Quyen Trinh', 'Memorial Hermann', '1033205224', 'PCP - Adults', '(281) 646-0740', '21770 Kingsland Blvd', 'Katy', 'TX', '77450', 'Yes', 'Mon - Fri: 7:00am - 5:00pm
Sat: 8:00am - 2:00pm', 'CHC Premier, Molina, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, Oscar HMO, Oscar EPO', null, null, null, '04/06/2026', 57, false),
  ('Julie Vu', 'HCA Houston Healthcare West', '1871729871', 'OBGYN', '(281) 713-5870', '1140 Business Center Dr., Suite 403', 'Houston', 'TX', '77043', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage, Molina', null, null, null, '04/06/2026', 58, true),
  ('Tracy Hoang', 'Circadian Sleep Center LLC', '1477789600', 'PCP - Adults', '(713) 955-4550', '5431 Barker Cypress Rd Ste 500', 'Houston', 'TX', '77084', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 1:00pm', null, null, null, null, '04/06/2026', 59, false),
  ('Thimios D Partilas', 'Texas Chiropractic Association', '1396859211', 'Nurse Practitioner, Neurology', '(210) 229-7242', '1200 Brooklyn Ave Ste 320', 'San Antonio', 'TX', '78212', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', null, null, null, '04/06/2026', 60, false),
  ('Alejandro Arizmendi', null, '1457317232', 'Geriatric, PCP - Adults', '(210) 695-9002', '12002 Bandera Rd # 111', 'Helotes', 'TX', '78023', 'Yes', 'Mon/Wed/Fri: 7:45am - 5:15pm
Tue/Thurs: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage, UHC', null, null, null, '04/06/2026', 61, false),
  ('Jerryce Hudson', 'Memorial Hermann', '1780097121', 'PCP - Adults, Does not take ACA', '(281) 485-0334', '4320 Broadway St #100', 'Pearland', 'TX', '77581', 'No', 'Mon - Fri: 8:00am - 5:00pm
Sat: 8:00am - 12:00pm', null, null, null, null, '04/06/2026', 62, false),
  ('Jesus Naranjo', 'MedFirst Primary Care, (Baptist Health System)', '1255385605', 'PCP - Adults', '(210) 541-8689', '4103 N Loop 1604 W Suite 212', 'San Antonio', 'TX', '78249', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO', null, null, null, '04/06/2026', 63, false),
  ('Susan T. Lee', 'Providence Family Practice PA', '1629039573', 'PCP - Adults', '(713) 270-7224', '9798 Bellaire Blvd, Ste D', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 5:00pm
Sat: 9:00am - 12:00pm', 'BCBS Advantage, CHC Premier, CHC Select', 'CHC D-SNP', null, null, '04/06/2026', 64, false),
  ('KimPhuong P. Truong', 'Austin Regional Clinic PA', '1821157579', 'PCP - Family (Adults and Children)', '(512) 250-5571', '10401 Anderson Mill Rd Ste 110B', 'Austin', 'TX', '78750', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage, BCBS MyBlue Health, UHC', null, null, null, '04/06/2026', 65, false),
  ('Cornerstone Clinic', null, null, 'PCP - Family (Adults and Children)', '(830) 995-5633', '815 Front St', 'Comfort', 'TX', '78013', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Ambetter EPO', null, null, null, '04/06/2026', 66, false),
  ('Gautam Ram Moorjani', 'Rheumatology Associates of South Texas', '1780617282', 'Rheumatology', '(210) 265-8851', '19272 Stone Oak Pkwy # 101', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, UHC, Christus', null, null, null, '04/06/2026', 67, false),
  ('Michael Piesman', 'Gastroenterology Consultants of San Antonio', '1750402046', 'Gastroenterology', '(210) 614-1234', '12850 Toepperwein Rd', 'Live Oak', 'TX', '78233', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Christus, Imperial, BCBS Advantage, Ambetter HMO, Ambetter EPO', null, null, null, '04/06/2026', 68, false),
  ('Baptist M&S Imaging', 'Baptist M&S Imaging', null, 'Imaging Facility', '(210) 590-5822', 'Baptist''s Locations', 'San Antonio
Schertz
New Braunfels', 'TX', '78***', 'Yes', 'Based on each location', 'Oscar HMO, Oscar EPO, BCBS Advantage, BSW, Ambetter HMO, Ambetter EPO, UHC, Wellpoint, Imperial', 'Devoted, Humana, Healthspring/Cigna, Wellcare, Molina, Aetna', null, null, '04/06/2026', 69, true),
  ('Truc Tran, MD', 'Orlando Health - Health Central Hospital', '1497721385', 'PCP - Adults', '(407) 296-1923', '10000 W. Colonial Dr., Suite 184', 'Ocoee', 'FL', '34761', 'Yes', 'Mon - Thurs: 8:00am - 4:30pm
Fri: 8:00am - 4:00pm', 'BCBS MyBlue Health, BCBS Advantage, Ambetter HMO, Ambetter EPO', null, null, null, '04/06/2026', 70, true),
  ('Duyen-Anh Luu', 'Memorial Hermann', '1124405261', 'PCP - Adults', '(281) 371-1980', '22430 Grand Corner Dr', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 7:00am - 5:00pm', 'Oscar HMO, Oscar EPO, BCBS Advantage, CHC Premier, CHC Select, Cigna', 'CHC Dualcare', null, null, '04/06/2026', 71, false),
  ('Minh Q Mai', 'Mai Medical Clinic', '1427248970', 'PCP - Adults', '(713) 999-2860', '12660 Beechnut St, Ste 110', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 5:00pm
Sat by appointment only', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, CHC Premier, UHC, Molina', 'Devoted', null, null, '04/06/2026', 72, false),
  ('Minh Q Mai', 'Mai Medical Clinic', '1427248970', 'PCP - Adults', '(832) 604-9944', '3648 Cypress Creek Pkwy, Ste 240 (Memorial Hermann)', 'Houston', 'TX', '77068', 'Yes', 'Mon - Fri: 9:00am - 5:00pm
Sat by appointment only', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, CHC Premier, UHC, Molina', 'Devoted', null, null, '04/06/2026', 72, false),
  ('Tuan Anh Ngoc Nguyen', 'Gessner Medical Center', '1932238821', 'PCP - Adults', '(713) 270-8818', '5704 S Gessner Rd, Ste D', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 5:00pm
Sat: 9:00am - 2:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage, UHC', null, null, null, '04/06/2026', 73, false),
  ('Gloria S. Wright', 'Total Health Primary Care', '1154397842', 'PCP - Adults', '(210) 654-9300', '5016 FM1518', 'Selma', 'TX', '78154', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 12:00pm', 'BCBS MyBlue Health, BCBS Advantage, UHC, Cigna, Imperial', null, null, null, '04/06/2026', 74, false),
  ('Richard Le', 'Primecare Medical Center', '1962421016', 'PCP - Adults', '(281) 631-0202', '11918 Veterans Memorial Dr', 'Houston', 'TX', '77067', 'Yes', 'Mon/Tue/Thurs/Fri: 9:00am - 6:00pm
Wed: 9:00am - 2:00pm
Sat: 9:00am - 3:00pm', 'Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, CHC Premier, CHC Select, UHC, Molina', null, null, null, '04/06/2026', 75, false),
  ('Valdes Nora', null, '1124069406', 'PCP - Adults', '(210) 614-0000', '4903 Golden Quail Ste 114', 'San Antonio', 'TX', '78240', 'Yes', 'Mon/Tue/Thurs/Fri: 8:00am - 5:00pm
Wed: 2:00pm - 6:00pm', 'Oscar HMO, UHC, Wellpoint', null, null, null, '04/06/2026', 76, false),
  ('James G. Jennings', 'Leon Springs Family Practice P.A.', '1588787212', 'PCP - Adults', '(210) 698-7777', '24165 Frontage Rd Suite 118', 'San Antonio', 'TX', '78257', 'Yes', 'Mon - Thurs: 7:30am - 5:00pm
Fri: 7:30am - 12:00pm', 'UHC, UHC Sanitas', null, null, null, '04/06/2026', 77, false),
  ('Katherine Nguyen', 'Digestive and Liver Specialists', '1083881916', 'Gastroenterology', '(713) 461-1026', 'Medical Plaza 3, 915 Gessner Rd #850', 'Houston', 'TX', '77024', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 12:00pm', 'CHC Select, BCBS Advantage', null, null, null, '04/06/2026', 78, false),
  ('Bac Nguyen', 'Berkeley Eye Center', '1871853077', 'Opthamology', '(713) 526-1600', '3100 Weslayan St, Ste 400', 'Houston', 'TX', '77027', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 12:00pm (Laser Center) / 8:00am - 2:00pm (Clinic)', 'BCBS MyBlue Health, BCBS Advantage', null, null, null, '04/06/2026', 79, false),
  ('David J. Sandercoek', 'North San Antonio Healthcare Associates', '1871672436', 'PCP - Adults', '(210) 822-3646', '3338 Oakwell Ct Ste 107', 'San Antonio', 'TX', '78218', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri: 8:30am - 4:00pm', 'Ambetter EPO, UHC, BCBS Advantage, Imperial', null, null, null, '04/06/2026', 80, false),
  ('Chau Tran', 'Tran-Vo Clinic', '1508365396', 'PCP - Adults', '(713) 234-7871', '4899 Highway 6 Ste 107D', 'Missouri City', 'TX', '77459', 'Yes', 'Mon - Thurs: 8:00am - 4:00pm
Fri: 8:00am - 12:00pm', 'CHC Premier, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage, Oscar HMO, Oscar EPO, UHC, Molina', null, null, null, '04/06/2026', 81, false),
  ('Vu To', 'Westlake Medical Clinic', '1346622230', 'PCP - Adults', '(281) 829-3999', '2430 N Fry Rd # 100', 'Houston', 'TX', '77084', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'CHC Premier, CHC Select, Molina', 'Aetna, UHC, Wellmed', null, null, '04/06/2026', 82, false),
  ('Moiz Abbas Tajkhanji

(Dollie Husfeld, Nurse Practitioner)', 'Genesis Medical Group - Live Oak', '1215022421', 'PCP - Adults', '(210) 654-7200', '11355 Toepperwein Rd', 'San Antonio', 'TX', '78233', 'Yes', 'Mon - Fri: 8:00am - 5:30pm', 'BCBS MyBlue Health, BCBS Advantage, UHC', null, null, null, '04/06/2026', 83, false),
  ('Mona-Lisa Alattar', 'Oncology Consultants Katy Office', '1558624239', 'Oncology, Hematology', '(281) 578-0201', 'Oncology''s Locations', 'Corpus Christi
Cypress
Greater Heights
Katy
League City
Houston
Humble
Pasadena
Pearland
Rockport
Sugar Land', 'TX', '77***, 78***', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', 'Oscar HMO, Oscar EPO, CHC Premier, CHC Select, BCBS Advantage, UHC', null, null, null, '04/06/2026', 84, true),
  ('Kelly Dempsey', 'Southwest Surgical Associates', '1891888400', 'General Surgeon', '(713) 772-1200', '16651 Southwest Fwy, Ste 360', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'CHC Premier, Oscar EPO, Ambetter EPO', null, null, null, '04/06/2026', 85, false),
  ('Ameer A. Khowaja', 'Northeast Endocrinology', '1366672701', 'Endocrinology', '(210) 650-3360', '7323 N Loop 1604 E, ', 'Selma', 'TX', '78154', 'Yes', 'Mon - Fri: 7:30am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, Oscar HMO, Oscar EPO', null, null, null, '04/06/2026', 86, false),
  ('Viviana Juarez', 'ABCD Pediatrics – Schertz', '1700455037', 'PCP - Children', '(210) 566-4777', '2200 Roy Richard Drive', 'Schertz', 'TX', '78154', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'UHC, Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', null, null, null, '04/06/2026', 87, false),
  ('Pediatric Cardiology Care', 'Pediatric Cardiology Care', null, 'Cardiologist', '(281) 648-3000', 'Locations', 'Webster
Houston
Katy
Spring', 'TX', '77***', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, CHC Premier, CHC Select', null, null, null, '04/06/2026', 88, true),
  ('Huyen Duong', 'Hope Clinic', '1235410101', 'PCP - Family (Adults and Children)', '(713) 773-0803', '7001 Corporate Dr Ste 120', 'Houston', 'TX', '77036', 'Yes', 'Mon/Fri: 8:00am - 5:00pm
Tue/Wed/Thurs: 8:00am - 7:00pm
Sat: 9:00am - 5:00pm', 'Wellpoint, BCBS MyBlue Health, BCBS Advantage, CHC Premier, CHC Select, Molina', null, null, null, '04/06/2026', 89, false),
  ('Khoa Cao', 'Medical Clinic: Cao Khoa T MD', '1982702031', 'PCP - Adults', '(281) 484-0449', '11034 Scarsdale Blvd Ste B', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 9:00am - 6:00pm', 'CHC Premier, UHC, BCBS Advantage, Molina, Ambetter EPO', 'CHC D-SNP', null, null, '04/06/2026', 90, false),
  ('Susan Novak', 'Baptist Health System', '1720075021', 'OBGYN', '(210) 946-1300', '502 Madison Oak Dr', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, UHC, BCBS Advantage, Ambetter HMO, Ambetter EPO', null, null, null, '04/06/2026', 91, false),
  ('Bridge Creek family Medicine', 'Bridge Creek family Medicine', null, 'PCP - Family (Adults and Children)', '(832) 220-5103', '16700 House Hahl Rd Blgd 5', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Thurs: 7:00am - 4:00pm
Fri: 7:00am - 12:00pm', 'Oscar HMO, Oscar EPO, Ambetter EPO, CHC Premier, CHC Select, Molina, UHC', null, null, null, '04/06/2026', 92, false),
  ('Yvette Almendarez', 'Aquarius Pediatrics', '1699937078', 'PCP - Children', '(210) 560-4500', '11515 Toepperwein Rd #203', 'San Antonio', 'TX', '78233', 'Yes', 'Mon - Wed: 8:30am - 5:00pm
Thurs: 8:30am - 12:30pm
Fri: 8:30am - 1:00pm', 'Oscar EPO, BCBS Advantage, UHC', null, null, null, '04/06/2026', 93, false),
  ('Barry Ford', 'Little Rock Family Practice', '1982698965', 'PCP - Adults', '(501) 228-7200', '4208 N Rodney Parham Rd', 'Little Rock', 'AZ', '72212', 'Yes', 'Mon - Fri: 8:16am - 5:16pm', null, null, null, null, '04/06/2026', 94, false),
  ('Michael Cope', 'The Woman''s Clinic', '1588639959', 'OBGYN', '(501) 664-4131', '9601 Baptist Health Drive, Suite 1200', 'Little Rock', 'AZ', '72205', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage, Ambetter HMO, Ambetter EPO, UHC, Cigna', null, null, null, '04/06/2026', 95, true),
  ('Thanh Nguyen', 'Memorial Hermann Medical Group Webster Urology Associates', '1518967090', 'Urology', '(281) 332-0202', '250 Blossom St, Suite 220', 'Webster', 'TX', '77598', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'CHC Premier, CHC Select, BCBS Advantage, Molina', null, null, null, '04/06/2026', 96, false),
  ('Texas Liver Institute', 'Texas Liver Institute', null, 'Specialists', '(210) 253-3426', '607 Camden St, Suite 101', 'San Antonio', 'TX', '78215', 'Yes', null, null, null, null, null, '04/06/2026', 97, false),
  ('North San Antonio Healthcare Associates', 'North San Antonio Healthcare Associates', null, 'PCP - Family (Adults and Children)', '(210) 822-3646', '3338 Oakwell Ct, Ste 107', 'San Antonio', 'TX', '78218', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 4:00pm', 'Oscar HMO, Oscar EPO, UHC', 'Aetna, Healthspring/Cigna', null, null, '04/06/2026', 98, true),
  ('Cevey Pediatrics', 'Cevey Pediatrics', null, 'PCP - Children', '(210) 826-0311', '414 W Sunset Rd Ste 105', 'San Antonio', 'TX', '78209', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage', null, null, null, '04/06/2026', 99, false),
  ('Vu Hoang', 'Memorial Hermann', '1356865737', 'Cardiologist', '(281) 922-9239', '11914 Astoria Blvd Suite 410', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'CHC Premier, CHC Select, Molina, BCBS MyBlue Health, UHC, Ambetter HMO', null, null, null, '04/06/2026', 100, false),
  ('Kenneth DesRosier', 'Rheumatology Solutions', '1568447563', 'Rheumatology', '(210) 590-9596', '8930 Fourwinds Dr #100', 'Windcrest', 'TX', '78239', 'Yes', 'Mon - Thurs: 7:00am - 5:00pm', null, 'Aetna, Healthspring/Cigna, Devoted, Humana, BCBS, Wellcare, Wellmed, UHC', null, null, '04/06/2026', 101, false),
  ('Juan A. Garcia', 'Northeast Pulmonary & Sleep Associates', '1104856400', 'Pulmonologist', '(210) 655-6400', '12709 Toepperwein Rd #201', 'Live Oak', 'TX', '78233', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'Aetna, Healthspring/Cigna, Devoted, Humana, BCBS, Wellcare, Wellmed, UHC', null, null, '04/06/2026', 102, false),
  ('Jay Ferrell', 'UT Health San Antonio', '1295083558', 'Otolaryngologist (ENT)', '(210) 450-9950', '8300 Floridaoyd Curl Dr., 6th Floridaoor', 'San Antonio', 'TX', '78229', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage', null, null, null, '04/06/2026', 103, false),
  ('Joseph Becker', 'UT Health San Antonio', '1235313321', 'Endocrinology, Does not take ACA', '(210) 450-9800', '8435 Wurzbach Rd', 'San Antonio', 'TX', '78229', 'No', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 104, false),
  ('Daruka Mahadevan', 'UT Health San Antonio MD Anderson Cancer Center', '1841398302', 'Hematology, Oncology', '(210) 450-1000', '7979 Wurzbach Rd', 'San Antonio', 'TX', '78229', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'BCBS Advantage, Molina', null, null, null, '04/06/2026', 105, false),
  ('Martha Bilbatua', 'Northeast Endocrinology Associates, P.A.', '1548757404', 'Endocrinology', '(210) 650-3360', '7323 N 1604 E, Suite 601', 'San Antonio', 'TX', '78233', 'Yes', 'Mon - Fri: 7:30am - 5:00pm', 'Oscar HMO, BCBS MyBlue Health, BCBS Advantage, UHC', null, null, null, '04/06/2026', 106, false),
  ('Sarah Ho', 'Memorial Hermann', '1063049906', 'PCP - Children', '(281) 208-9503', '18440 W Airport Blvd, Ste 350', 'Richmond
Missouri City', 'TX', '77407', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'CHC Premier, CHC Select', null, null, null, '04/06/2026', 107, false),
  ('Sarah Ho', 'Memorial Hermann', '1063049906', 'PCP - Children', '(281) 208-9503', '20303 S University Blvd, Ste 101', 'Richmond
Missouri City', 'TX', '77459', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'CHC Premier, CHC Select', null, null, null, '04/06/2026', 107, false),
  ('Thuan T Nguyen', 'Liver & Digestive Consultants: Thuan T. Nguyen, MD', '1659421535', 'Gastroenterology', '(281) 655-5100', '12060 Bellaire Blvd A', 'Houston', 'TX', '77072', 'Yes', 'Mon - Thurs: 8:30am - 6:00pm', 'BCBS MyBlue Health, BCBS Advantage, CHC Premier', null, null, null, '04/06/2026', 108, false),
  ('Horacio Rafael Ramirez', 'WellMed', '1992728893', 'PCP - Adults', '(210) 706-2580', '8353 Culebra Rd Ste 101', 'San Antonio', 'TX', '78251', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'UHC, BCBS MyBlue Health, BCBS Advantage', 'Aetna, Healthspring/Cigna, Humana', null, null, '04/06/2026', 109, false),
  ('Juan C. Garza', null, '1669449971', 'PCP - Adults', '(210) 558-8878', '4318 Moonlight Way', 'San Antonio', 'TX', '78230', 'Yes', 'Mon/Tue/Thurs: 9:00am - 5:00pm
Wed/Fri: 9:00am - 3:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage', null, null, null, '04/06/2026', 110, false),
  ('Dongchau Nguyen', 'Progressive Medical Clinic', '1639149453', 'Cardiologist', '(281) 481-1197', '11920 Astoria Blvd # 300', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 8:00am - 4:00pm', 'Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, UHC', 'Healthspring/Cigna, Humana, Aetna, Wellcare, Wellmed', null, null, '04/06/2026', 111, false),
  ('Luis A. Lopez', 'CommuniCare Health Centers', '1083600035', 'PCP - Children', '(210) 650-0814', '20642 Stone Oak Parkway, Ste 105, Other Locations', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, UHC', null, null, null, '04/06/2026', 112, true),
  ('Lauren Ashley Thomas', 'HEALTH 210 Primary Care Clinic', '1477383230', 'PCP - Adults', '(210) 352-5200', '1202 East Sonterra Boulevard, Suite 301, Other Locations', 'San Antonio
Boerne', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, UHC, BCBS Advantage', null, null, null, '04/06/2026', 113, true),
  ('CCH Clinic Green Tree', 'Covington County Hospital', null, 'PCP - Family (Adults and Children)', '(601) 797-3405', 'CCH''s Locations', 'Mt. Olive
Collins
Seminary
Magee
Sumrall', 'MS', '39***', 'Yes', 'Based on each locations', 'Ambetter HMO, Ambetter EPO, Cigna, Molina, UHC', null, null, null, '04/06/2026', 114, true),
  ('Ngoc Pham', 'Memorial Hermann
Oncology Consultants', '1912342908', 'Oncology', '(713) 722-9660', '27700 Northwest Freeway (Memorial Hermann), Oncology''s Locations', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', 'CHC Premier, CHC Select, Ambetter EPO', null, null, null, '04/06/2026', 115, true),
  ('Monica I. Chopra', 'Gonzaba Medical Group', '1184674475', 'PCP - Adults', '(210) 921-3800', '7219 Culebra Rd', 'San Antonio', 'TX', '78251', 'Yes', 'Mon - Fri: 7:00am - 5:00pm', 'Oscar HMO, Oscar EPO, UHC, Cigna, Wellpoint, BCBS Advantage', null, null, null, '04/06/2026', 116, false),
  ('Viviane B. Nguyen', 'Doctors Clinic Houston - West Memorial', '1972630424', 'PCP - Adults, Nurse Practitioner', '(281) 496-7333', '14770 Memorial Dr', 'Houston', 'TX', '77079', 'Yes', 'Mon - Fri: 8:30am - 6:30pm
Sat: 9:00am - 1:00pm', 'BCBS MyBlue Health, BCBS Advantage, Cigna, UHC, Wellpoint', null, null, null, '04/06/2026', 117, false),
  ('Pediatricz Now Aliana', 'Pediatricz Now Aliana - Pediatric Clinic & Pediatrician', null, 'PCP - Children', '(832) 810-9025', '10321 W Grand Pkwy S Suite 130', 'Richmond', 'TX', '77407', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'Oscar HMO, Oscar EPO, Ambetter HMO, Ambetter EPO, BCBS Advantage, CHC Premier, CHC Select', null, null, null, '04/06/2026', 118, false),
  ('NE Orthopaedics & Sports Medicine', 'Northeast Orthopaedics & Sports Medicine', null, 'Specialists, Orthopedic', '(210) 934-6917', '6704 Randolph Blvd', 'Live Oak', 'TX', '78233', 'Yes', 'Based on each locations', 'Oscar HMO, Oscar EPO, UHC, Ambetter HMO, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', null, null, null, '04/06/2026', 119, false),
  ('Steven X. Nguyen', 'Generational Medical Clinic LLC', '1255594180', 'PCP - Adults', '(281) 879-1800', '11322 Bellaire Blvd Ste 117', 'Houston', 'TX', '77072', 'Yes', 'Mon/Tue/Thurs: 8:00am - 5:00pm
Fri/Sat: 8:00am - 12:00pm', 'CHC Premier, CHC Select, BCBS Advantage, Ambetter HMO, Ambetter EPO', null, null, null, '04/06/2026', 120, false),
  ('Steven Do', 'Hope Clinic', '1447611124', 'PCP - Family (Adults and Children)', '(713) 773-0803', '13930 Bellaire Blvd', 'Houston', 'TX', '77083', 'Yes', 'Mon - Thurs: 8:00am - 7:00pm
Fri: 8:00am - 5:00pm
Sat: 9:00am - 5:00pm', 'BCBS MyBlue Health, BCBS Advantage, CHC Premier, CHC Select, UHC, Molina, Ambetter HMO, Ambetter EPO', null, null, null, '04/06/2026', 121, false),
  ('Nicholas Martinez', 'Gastroenterology Clinic of San Antonio, P.A.', '1174843726', 'Gastroenterology', '(210) 615-8308', '8550 Datapoint Dr Ste 200', 'San Antonio', 'TX', '78229', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 12:00pm', 'Oscar HMO', null, null, null, '04/06/2026', 122, false),
  ('Jason Wang', 'Bellaire Primary Care', '1295052504', 'PCP - Adults', '(281) 973-0024', '11548 Bellaire Blvd', 'Houston', 'TX', '77072', 'Yes', 'Mon/Tue/Thurs/Fri: 9:00am - 5:00pm
Sat: 10:00am - 2:00pm', null, null, null, null, '04/06/2026', 123, false),
  ('Thanh K. Hoang', 'Horizon Healthcare Clinic', '1508828724', 'PCP - Adults', '(281) 564-2900', '11210 Bellaire Blvd, Ste 126A', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 6:30pm', null, null, null, null, '04/06/2026', 124, false),
  ('Nam Hoang', 'Village Medical of Southeast Texas PA (GIFM)', '1578563524', 'PCP - Adults', '(713) 797-1087', '4543 Post Oak Place Dr, Ste 105', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 7:15am - 4:30pm', null, null, null, null, '04/06/2026', 125, false),
  ('Vu A Phung', 'PMG Family Med', '1124290390', 'PCP - Family (Adults and Children)', '(281) 984-6351', '13480 Veterans Memorial Dr', 'Houston', 'TX', '77014', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 126, false),
  ('Lily Thu-Thao Thi Luc', 'Baylor College Of Medicine PA', '1306305636', 'PCP - Adults, Physician Assistant', '(713) 798-7700', '3743 Westheimer Rd', 'Houston', 'TX', '77027', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 127, false),
  ('Hung T. Dang', 'Holman Medical Associates', '1568403889', 'PCP - Adults', '(281) 575-9967', '10838 Beechnut St', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 5:00pm
Sat - Sun: 9:00am - 2:00pm', null, null, null, null, '04/06/2026', 128, false),
  ('Victoria Do', 'Advanced Diagnostics Healthcare System', '1992744064', 'PCP - Adults', '(713) 795-4884', '4200 Twelve Oaks Dr, Houston, Texas', 'Houston', 'TX', '77027', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 129, false),
  ('Cavatina Luugiang Pham', 'West Houston Family Practice', '1821409780', 'PCP - Adults', '(281) 558-6700', '12245 Richmond Ave.', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:30am - 5:00pm
Sat: 8:30am - 12:30pm', null, null, null, null, '04/06/2026', 130, false),
  ('Khanh V. Nguyen', null, '1720178510', 'Nurse Practitioner, PCP - Adults', '(832) 944-5570', '13218 Bellaire Boulevard', 'Houston', 'TX', '77083', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 131, false),
  ('Khoinguyen Nguyen', null, '1417184813', 'PCP - Adults', '(713) 266-3343', '7601 W Sam Houston Pkwy S suit 800', 'Houston', 'TX', '77072', 'Yes', 'Mon - Thurs: 9:00am - 3:00pm', null, null, null, null, '04/06/2026', 132, false),
  ('Tiffany Nguyen', 'Hope Clinic', '1881941938', 'Nurse Practitioner, PCP - Adults, PCP - Family (Adults and Children)', '(713) 773-0803', '13930 Bellaire Blvd.', 'Houston', 'TX', '77083', 'Yes', 'Mon - Thurs: 8:00am - 7:00pm
Fri: 8:00am - 5:00pm
Sat: 9:00am - 5:00pm', null, null, null, null, '04/06/2026', 133, false),
  ('Na Liu', 'Bellaire Pediatrics', '1356732119', 'PCP - Children', '(713) 777-7772', '8250 Bellaire Blvd Ste 1', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 6:00pm
Sat: 9:00am - 12:00pm', null, null, null, null, '04/06/2026', 134, false),
  ('Jacqueline le-Guevara
(Jacqueline Le)', 'Kelsey-Seybold Clinic', '1417242637', 'PCP - Adults', '(713) 442-8000', '11211 Nexus Ave.', 'Stafford', 'TX', '77477', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'UHC Kelsey Seybold', null, null, null, '04/06/2026', 135, false),
  ('Dac Vu', 'CI Medical Center/Chinatown', '1649245663', 'PCP - Adults', '(713) 272-8858', '8278 Bellaire Blvd Ste A', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:30am - 5:00pm
Sat: 9:00am - 1:00pm', null, null, null, null, '04/06/2026', 136, false),
  ('Thanh-Thao Truong', 'CI Medical Center/Chinatown', '1609225572', 'PCP - Adults', '(713) 272-8858', '8278 Bellaire Blvd Ste A', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:30am - 5:00pm
Sat: 9:00am - 1:00pm', null, 'CHC D-SNP', null, null, '04/06/2026', 137, false),
  ('Giao N. Hoang', null, '1801825286', 'PCP - Adults', '(713) 779-2212', '8282 Bellaire Blvd', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 138, false),
  ('Nghia Nguyen', null, '1922042977', 'PCP - Adults', '(713) 779-2212', '8282 Bellaire Blvd', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'Verda', null, null, '04/06/2026', 139, false),
  ('Xudong Xu', 'Welcome Family Medicine PA', '1992701908', 'PCP - Adults', '(713) 995-8886', '9160 Bellaire Blvd Ste E', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:00am - 4:00pm
Sat: 8:00am - 2:30pm', null, null, null, null, '04/06/2026', 140, false),
  ('Vinh Nguyen', 'Providence Family Practice Pa', null, 'PCP - Adults', '(713) 270-7224', '9798 Bellaire Blvd Ste D', 'Houston', 'TX', '77036', 'Yes', 'Mon/Tues/Wed/Fri: 9:00am - 5:00pm
Thurs/Sat: 9:00am - 12:00pm', 'BCBS Advantage, CHC Premier, CHC Select', null, null, null, '04/06/2026', 141, false),
  ('Minh H. Le', 'Gessner Medical Center', '1033612080', 'PCP - Adults', '(713) 270-8818', '5704 S Gessner Rd', 'Houston', 'TX', '77036', 'Yes', 'Mon - Thurs: 9:00am - 4:00pm
Fri: 9:00am - 2:00pm
Sat: 9:00 - 12:00pm', null, null, null, null, '04/06/2026', 142, false),
  ('Yi Zhou', 'Dr. Zhou Family Medicine', '1649491697', 'PCP - Adults', '(713) 981-8898', '7850 Parkwood Cir Dr Suite B6', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 4:00pm', null, null, null, null, '04/06/2026', 143, false),
  ('Jiaxin Lu', 'Dr. Zhou Family Medicine', '1174910889', 'PCP - Adults', '(713) 981-8898', '7850 Parkwood Cir Dr Suite B6', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 4:00pm', null, null, null, null, '04/06/2026', 144, false),
  ('Tuan H. Nguyen', 'Family Care Pediatrics Clinic', '1457330029', 'PCP - Children', '(281) 933-7900', '12060 Bellaire Boulevard, Suite D', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 145, false),
  ('Nam P. Ho', 'Rudolph Medical Associates', '1730344185', 'PCP - Adults', '(713) 457-5500', '12924 Bellaire Blvd #100', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:30am - 4:00pm
Sat: 7:00am - 1:30pm', null, null, null, null, '04/06/2026', 146, false),
  ('Tram Ho', 'Rudolph Medical Associates', '1649350901', 'PCP - Adults', '(713) 457-5500', '12924 Bellaire Blvd #100', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:30am - 4:00pm
Sat: 7:00am - 1:30pm', null, null, null, null, '04/06/2026', 147, false),
  ('Lien-Thuy Nguyen', 'UT Physicians Multispecialty', '1457775058', 'PCP - Family (Adults and Children), Physician Assistant', '(713) 486-5900', '10623 Bellaire Boulevard, Suite C280', 'Houston', 'TX', '77072', 'Yes', 'Mon - Wed: 8:00am. - 7:00pm
Thu/Fri: 8:00am. - 5:00pm
Sat: 8:00am. - 12:00pm', null, null, null, null, '04/06/2026', 148, false),
  ('Loi P Nguyen', 'Bellaire Cardiovascular Care', '1275528481', 'Cardiologist', '(281) 988-6462', '12168 Bellaire Blvd Ste 108', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, '04/06/2026', 149, false),
  ('Dzung A. Nguyen', 'Medical Clinic/Beltway Viet Hoa', '1487639886', 'PCP - Adults', '(713) 520-1115', '7601 W Sam Houston Parkway S, Suite 850', 'Houston', 'TX', '77072', 'Yes', 'Mon - Thurs: 9:00am - 5:00pm
Sat: 9:00am - 2:00pm', null, 'Verda', null, null, '04/06/2026', 150, false),
  ('Khanh P. Nguyen', null, '1003803974', 'PCP - Adults', '(281) 530-0300', '8200 Wilcrest Drive, Suite 9', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 151, false),
  ('Thien Nguyen', 'Village Medical', '1841228970', 'PCP - Adults', '(346) 202-3492', '12611 S Gessner Rd A', 'Houston', 'TX', '77071', 'Yes', 'Mon - Fri: 7:00 am - 7:00 pm
Sat/Sun: 9:00 am. - 5:00 pm', null, null, null, null, '04/06/2026', 152, false),
  ('Cherry Chau', null, '1609496462', 'PCP - Adults', '(713) 778-4450', '7789 Southwest Fwy #350', 'Houston', 'TX', '77074', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 153, false),
  ('Mai N. Lam, PA', 'Legacy Community Health', '1194047035', 'Physician Assistant', '(832) 548-5000', '6677 Rookin Street', 'Houston', 'TX', '77074', 'Yes', 'Based on each locations', null, null, null, null, '04/06/2026', 154, false),
  ('Linh T. Ha', 'Legacy Community Health', '1063606077', 'PCP - Children', '(832) 548-5000', '6441 High Star Drive', 'Houston', 'TX', '77074', 'Yes', 'Based on each locations', null, null, null, null, '04/06/2026', 155, false),
  ('Phong T. Luu', 'Harris County Hospital District: Luu Phong MD', '1376623777', 'PCP - Adults', '(713) 272-2600', '6630 De Moss Dr', 'Houston', 'TX', '77074', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 156, false),
  ('Mai Pham', 'Wang&Jiang MD PA / Dairy Ashford Family Practice', '1902251317', 'PCP - Adults', '(281) 759-0200', '1500 S Dairy Ashford Road, Suite 198', 'Houston', 'TX', '77077', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 157, false),
  ('Juliette A Depue', 'Village Medical', '1952594616', 'PCP - Adults', '(346) 646-3525', '20675 FM 1093 Rd, Suite A', 'Richmond', 'TX', '77407', 'Yes', '(Temporarily Closed)', null, null, null, null, '04/06/2026', 158, false),
  ('John Nguyen', 'Village Medical', '1578595864', 'PCP - Adults', '(346) 500-5453', '11994 Richmond Avenue', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 159, false),
  ('Quynh Do', 'Village Medical', '1114118593', 'PCP - Adults', '(346) 500-5453', '11994 Richmond Avenue', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 160, false),
  ('Tuong-Vi Ho', null, '1720178510', 'Nurse Practitioner', '(832) 944-5570', '13218 Bellaire Boulevard', 'Houston', 'TX', '77083', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 161, false),
  ('Cuong V. Pham', 'Harris Health El Franco Lee Health Center', '1780619684', 'PCP - Adults', '(281) 454-0500', '8901 Boone Rd', 'Houston', 'TX', '77099', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 162, false),
  ('Lieu N. Chau', 'Harris Health El Franco Lee Health Center', '1376742569', 'PCP - Adults', '(281) 454-0500', '8901 Boone Rd', 'Houston', 'TX', '77099', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 163, false),
  ('Kevin D. Doan', 'Blue Fish Pediatrics', '1285262766', 'PCP - Children', '(281) 855-3700', '9530 Huffmeister Rd', 'Houston', 'TX', '77095', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, '04/06/2026', 164, false),
  ('Khoa Don Nguyen', 'Houston Family Physicians', '1437146966', 'PCP - Adults', '(713) 773-1102', '8313 Southwest Freeway Ste 105', 'Houston', 'TX', '77074', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, '04/06/2026', 165, false),
  ('Andres Splenser', 'Spenser Endocrinology', '1609910835', 'Endocrinology', '(832) 702-2225', '3100 Edloe St #210', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 166, false),
  ('Yongfang Chen', 'Welcome Family Medicine PA', '1245238880', 'PCP - Adults', '(713) 995-8886', '9160 Bellaire Blvd Ste E', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 8:00am - 4:00pm
Sat: 8:00am - 2:30pm', null, null, null, null, '04/06/2026', 167, false),
  ('Ai T. Nguyen', 'MD Medical Group', '1649783937', 'Physician Assistant, PCP - Children', '(713) 807-8921', '1213 Hermann Drive, Suite 770', 'Houston', 'TX', '77004', 'Yes', 'Mon - Fri: 8:00am - 6:00pm', null, null, null, null, '04/06/2026', 168, false),
  ('Huy B. Vinh', null, '1992774822', 'PCP - Adults', '(713) 790-3311, (281) 252-9993', '6565 Fannin St.', 'Houston', 'TX', '77030', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 169, false),
  ('Katie K. Tran', 'UT Physicians Pediatric Primary Care - Texas Medical Center', '1225390933', 'PCP - Children', '(832) 325-7111', '6410 Fannin Street, Suite 500', 'Houston', 'TX', '77030', 'Yes', 'Mon/Thurs/Fri: 7:45am - 5:00pm
Tues/Wed: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 170, false),
  ('Sarah L. Tran', 'Legacy Community Health', '1124389309', 'PCP - Adults', '(832) 548-5000', '1415 California Street', 'Houston', 'TX', '77006', 'Yes', 'Mon - Thurs: 8:00am - 8:00pm
Fri: 8:00am - 6:00pm
Sat: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 171, false),
  ('Jeannie Banh', 'Legacy Community Health', '1407293046', 'PCP - Adults', '(832) 548-5000', '1415 California Street', 'Houston', 'TX', '77006', 'Yes', 'Mon - Thurs: 8:00am - 8:00pm
Fri: 8:00am - 6:00pm
Sat: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 172, false),
  ('Elizabeth U. Tran', null, '1548580970', 'PCP - Adults', '(713) 798-7700', '3701 Kirby Drive, Suite 100', 'Houston', 'TX', '77098', 'Yes', 'Mon - Fri: 7:30am - 6:00pm', null, null, null, null, '04/06/2026', 173, false),
  ('Tram T. Mai', null, '1497250328', 'Nurse Practitioner', '(713) 295-2570', '6300 Chimney Rock Road', 'Houston', 'TX', '77081', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 174, false),
  ('Truc Le Jr.', null, '1093714388', 'PCP - Adults', '(713) 662-9500', '3003 S Loop W #210', 'Houston', 'TX', '77054', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 175, false),
  ('Diemphuong N. Pham', null, '1902986128', 'PCP - Adults', '(713) 880-1950', '2951 Chimney Rock Rd suite c', 'Houston', 'TX', '77056', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 176, false),
  ('Bich Van Nguyen', 'Medical Clinic', '1558458851', 'PCP - Adults, Physician Assistant', '(281) 484-0449', '11034 Scarsdale Blvd Ste B', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 9:00am - 6:00pm', null, null, null, null, '04/06/2026', 177, false),
  ('Thuy T. Tran', 'UT Physicians Family Practice - Bayshore', '1013309285', 'Nurse Practitioner', '(713) 486-6200', '11452 Space Center Boulevard', 'Houston', 'TX', '77059', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 178, false),
  ('Khanh-Trang T. Nguyen', 'Progressive Medical Clinic', '1619995768', 'PCP - Adults', '(281) 481-8878', '11920 Astoria Blvd Ste 300', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, '04/06/2026', 179, false),
  ('Co-May D. Pasdar-Shirazi', 'Select Internal Medicine & Pediatrics', '1487947685', 'PCP - Family (Adults and Children)', '(832) 492-4467', '7619 Branford Pl Suite 210', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 7:30am - 5:00pm', null, null, null, null, '04/06/2026', 180, false),
  ('Huong H. Tong', 'OakBend Medical Center', '1609288208', 'PCP - Adults', '(281) 238-7870', '4911 Sandhill Dr', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 181, false),
  ('Tu Dan Kathy Nguyen', 'Memorial Hermann', '1356753057', 'PCP - Adults', '(281) 325-4100', '14023 Southwest Fwy', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 3:00pm', null, null, null, null, '04/06/2026', 182, false),
  ('Trang Nguyen', 'Conroe Family Doctor', '1588752414', 'PCP - Adults', '(936) 441-2012', '1020 Riverwood Ct Ste 100', 'Conroe', 'TX', '77304', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 183, false),
  ('Chanh Nguyen', 'Village Medical', '1932366135', 'PCP - Adults', '(346) 646-4220', '1120 N Loop 336 W', 'Conroe', 'TX', '77301', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 184, false),
  ('Khoa Truong', 'Magnolia Family Medicine', '1184374944', 'PCP - Adults', '(281) 356-1945', '764 Fish Creek ThoroughFare', 'Woodforest', 'TX', '77316', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 185, false),
  ('Tuyetlan N. Vo', 'WeeKare Pediatrics', '1487202446', 'Physician Assistant', '(281) 540-5437', '19333 Highway 59 N, Suite 145', 'Humble', 'TX', '77338', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, '04/06/2026', 186, false),
  ('Nhu Q. Do', 'WeeKare Pediatrics', '1104089663', 'PCP - Children', '(281) 540-5437', '19333 Highway 59 N, Suite 145', 'Humble', 'TX', '77338', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 187, false),
  ('Huong Q. Hoang', 'Houston Methodist Primary Care Group', '1942293121', 'PCP - Adults', '(936) 270-4949', '4501 Magnolia Cove Dr #106', 'Kingwood', 'TX', '77345', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 188, false),
  ('Elizabeth A Coon-Nguyen', 'Genesis Medical Group', '1104856723', 'PCP - Adults', '(281) 547-4050', '22751 Professional Dr', 'Kingwood', 'TX', '77339', 'Yes', 'Mon - Fri: 8:00am - 4:30pm', null, null, null, null, null, 189, false),
  ('Alex Nguyen', 'Genesis Medical Group', null, 'PCP - Adults', '(281) 440-5300', '2255 E Mossy Oaks Rd Ste 500, Spring, TX 77389', 'Spring', 'TX', '77389', 'Yes', 'Mon - Fri: 7:30am - 4:30pm', null, null, null, null, null, 190, false),
  ('Annalysa Nguyen', 'Baylor St. Luke''s Medical Group', '1235118035', 'Physician Assistant', '(480) 909-3872', '2255 E. Mossy Oaks Rd Suite 320', 'Spring', 'TX', '77389', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 191, false),
  ('Hong Nguyen', 'Vitacare Medical Clinic', null, 'Nurse Practitioner', '(281) 397-1410', '2128 Spears Road, Suite 600', 'Houston', 'TX', '77067', 'Yes', '(Temporarily Closed)', null, null, null, null, null, 192, false),
  ('Hac Nguyen', null, '1447281829', 'PCP - Adults', '(832) 559-7950', '16736 Champion Forest Dr.', 'Spring', 'TX', '77379', 'Yes', 'Mon - Thurs: 9:00am - 4:00pm
Fri: 9:00am - 3:00pm
Sat: 8:00am - 12:00pm', null, null, null, null, null, 193, false),
  ('Trinh T. Han', 'MD Medical Group', '1043722648', 'Nurse Practitioner, PCP - Children', '(281) 742-0708', '9115 Fm 723 Road, Suite 900', 'Richmond', 'TX', '77406', 'Yes', 'Mon - Fri: 8:00am - 6:00pm', null, null, null, null, null, 194, false),
  ('Ha M. To', null, '1447794912', 'Nurse Practitioner', '(832) 437-5544, (713) 461-2915', '1259 FM 1463 Suite 300', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 195, false),
  ('Son B. Duong', null, '1073808424', 'PCP - Adults', '(281) 342-4530', '400 Austin Street', 'Richmond', 'TX', '77469', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 196, false),
  ('Long B. Cao', 'Memorial Hermann', '1124281118', 'Cardiologist', '(281) 633-4925', '1601 Main Street, Suite 105', 'Richmond', 'TX', '77469', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 197, false),
  ('Keith A. Huynh', 'HCA Houston Healthcare North Cypress', '1164471702', 'PCP - Adults', '(281) 469-3221', '21216 Northwest Freeway, Suite 560', 'Cypress', 'TX', '77429', 'Yes', 'Mon - Thurs: 9:00am - 5:00pm', null, null, null, null, null, 198, false),
  ('Janette Nguyen', 'Premier NW Houston Medical Group', '1124115308', 'PCP - Adults', '(281) 758-1022', '7025 Fry Rd # 500', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'Verda', null, null, null, 199, false),
  ('Trung D. Dinh', 'Fair Field Family Physican', '1083710271', 'PCP - Adults', '(281) 373-0162', '15201 Mason Rd # 1200', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Thurs: 8:15am - 5:00pm
Fri: 8:15am - 2:00pm', null, null, null, null, null, 200, false),
  ('Lesly Dessieux MD', 'Bridge Creek Family Medicine, PLLC', '1336215490', 'PCP - Family (Adults and Children)', '(832) 220-5103', '16700 House Hahl Rd Blgd 5', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Thurs: 7:00am - 4:00pm
Fri: 7:00am - 12:00pm', 'Oscar HMO, Oscar EPO, Ambetter EPO, CHC Premier, CHC Select, Molina, UHC', null, null, null, null, 201, false),
  ('Tuoanh H. Nguyen', 'Magnolia Psychiatry', '1134817463', 'Nurse Practitioner, Psychiatrist', '(281) 724-7980', '13145 Spring Cypress Rd', 'Cypress', 'TX', '77429', 'Yes', 'Mon - Thurs: 8:00am - 7:00pm', null, null, null, null, null, 202, false),
  ('Tommy C Vo', 'Barker Cypress Family Practice', '1932197498', 'PCP - Adults', '(281) 550-7600', '9740 Barker Cypress Rd Ste 116', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 203, false),
  ('Cynthia A Pham', 'Cyfair Family Medicine', '1063623080', 'PCP - Adults', '(281) 345-2336', '7160 Barker Cypress Rd A', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, null, 204, false),
  ('Minh Q. Mai', 'Prime Physicians, Mai Medical Clinic', '1427248970', 'PCP - Adults', '(832) 604-9944', '3648 Cypress Creek Parkway, FM 1960 Ste# 240', 'Houston', 'TX', '77068', 'Yes', 'Mon - Thurs: 9:00am - 5:00pm
Fri: 9:00am - 2:00pm', null, 'Verda', null, null, null, 205, false),
  ('Jamie Tran', 'Village Medical', '1265740401', 'Physician Assistant', '(832) 376-3880', '10220 Louetta Ste 100', 'Houston', 'TX', '77070', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 206, false),
  ('Timothy T. Tang', null, '1093805046', 'PCP - Adults', '(281) 858-4888', '17531 Farm to Market Rd 529 #100', 'Houston', 'TX', '77095', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 207, false),
  ('Anthony H. Phi', null, '1013913581', 'PCP - Adults', '(281) 469-4690', '11427 Jones Road', 'Houston', 'TX', '77070', 'Yes', 'Mon - Fri: 8:30am - 3:30pm
Sat: 8:30am - 12:00pm', null, null, null, null, null, 208, false),
  ('Susie L. Nguyen', 'HC Medical Doctors', '1275532764', 'PCP - Adults', '(832) 912-7111', '11810 Fm 1960 Rd W', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 209, false),
  ('Hung T. Nguyen', 'HC Medical Doctors', '1790784288', 'PCP - Adults', '(832) 912-7111', '11810 Fm 1960 Rd W', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 210, false),
  ('Haiyen T. Le', 'MD Medical Group', '1992772990', 'PCP - Children', '(832) 912-7044', '11840 Fm 1960 Rd W', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 211, false),
  ('Loc T. Vu, MD', 'Northchase Family Practice Clinic', '1508836321', 'PCP - Adults', '(713) 955-3919', '11417 Veterans Memorial Drive', 'Houston', 'TX', '77067', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 212, false),
  ('Thuy-Van Nguyen', 'Northchase Family Practice Clinic', '1962438333', 'Nurse Practitioner', '(713) 955-3919', '11417 Veterans Memorial Drive', 'Houston', 'TX', '77067', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 213, false),
  ('Vinh H. Vo', 'First Choice Family Clinic', '1164772570', 'Nurse Practitioner', '(832) 953-3232', '11399 Veterans Memorial Drive, Suite B', 'Houston', 'TX', '77067', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 214, false),
  ('Janie T. Doan', 'CyFair Pediatrics', '1669740601', 'PCP - Children', '(281) 894-3100', '10680 Jones Road Ste 2000', 'Houston', 'TX', '77065', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 6:00pm', null, null, null, null, null, 215, false),
  ('Dao Albert H. Ho', 'Blue Fish Pediatrics', '1073957866', 'PCP - Children', '(281) 855-3700', '9530 Huffmeister Road', 'Houston', 'TX', '77095', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', 'CHC Select', null, null, null, null, 216, false),
  ('Dawn P Nevle', 'Windrose Family Medicine', '1366537243', 'PCP - Adults', '(281) 500-8660', '20423 Kuykendahl Rd Ste 100', 'Spring', 'TX', '77379', 'Yes', 'Mon - Thurs: 7:30am - 5:00pm
Fri: 7:30am - 1:00pm', null, null, null, null, null, 217, false),
  ('Huy K. Nguyen', 'Saint Michael Medical Clinic', '1952469819', 'PCP - Adults', '(281) 655-5100', '12609 Louetta Rd.', 'Cypress', 'TX', '77429', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 218, false),
  ('Jimmy T. Nguyen', 'Family Medicine Specialists of Texas', '1568827798', 'PCP - Adults', '(346) 387-7001', '21800 Katy Fwy Ste 240', 'Katy', 'TX', '77449', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 219, false),
  ('Timothy Bui', 'The Y Factor by ManCenters', '1255829511', 'Nurse Practitioner, Urology', '(832) 358-8600', '9190 Katy Fwy Ste 101', 'Houston', 'TX', '77055', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 220, false),
  ('Bach-Cuc Tran', 'Advanced Dermatology – Sugar Land, TX', '1861822769', 'Physician Assistant, Dermatology', '(281) 665-4444', '1235 Lake Pointe Pkwy, Suite 200', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 221, false),
  ('Hien Quang Pham
(Henry Pham)', 'Village Medical', '1689647968', 'PCP - Adults', '(713) 347-6828', '10720 Barker Cypress Rd', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 222, false),
  ('Harvard Nguyen', 'Blue Fish Pediatrics', '1780261388', 'PCP - Children', '(281) 347-0080', '23211 First Park Dr', 'Katy', 'TX', '77449', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, null, 223, false),
  ('Chau M. Tran', null, '1073834636', 'PCP - Adults', '(281) 679-5600', '12345 Katy Freeway', 'Houston', 'TX', '77079', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 224, false),
  ('Linda Dang, MD', 'Children’s Memorial Hermann Pediatrics Katy', '1326394396', 'PCP - Children', '(281) 644-8955', '23964 Katy Freeway, Suite 300', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 225, false),
  ('Phuong H. Tran', null, '1710197678', 'PCP - Adults', '(972) 733-3090', '16980 Dallas Pkwy Suite 110', 'Dallas', 'TX', '75248', 'Yes', 'Mon - Fri: 8:00am - 4:30pm', null, null, null, null, null, 226, false),
  ('Mong Thao T. Le, PAC', 'Baylor Scott & White Family Medicine – Uptown', null, 'PCP - Adults', '(972) 817-7040', '4161 McKinney Avenue, Suite 300', 'Dallas', 'TX', '75240', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 227, false),
  ('Trang Cung', 'Baylor Scott & White Primary Care - Prosper', '1861751778', 'PCP - Adults', '(469) 800-5200', '111 S Preston Rd, Ste 10', 'Prosper', 'TX', '75078', 'Yes', 'Mon - Fri: 7:00am - 5:00pm', null, null, null, null, null, 228, false),
  ('Alejandra Dao', 'MD Medical Group', '1811558158', 'Physician Assistant', '(214) 330-7767', '3247 Dawes Drive', 'Dallas', 'TX', '75211', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 229, false),
  ('Howard H. Nguyen', null, '1932174711', 'PCP - Adults', '(214) 630-9559', '2261 Singleton Boulevard, Suite 101', 'Dallas', 'TX', '75212', 'Yes', 'Mon/Tues/Thurs/Fri: 9:00am - 6:00pm
Wed/Sat: 9:00am - 1:00pm', null, null, null, null, null, 230, false),
  ('Scott Tong', 'Baylor Scott & White Family Medicine – Lakewood', '1780181966', 'PCP - Adults', '(469) 800-7900', '6301 Gaston Avenue, Suite 300', 'Dallas', 'TX', '75214', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 231, false),
  ('Tuyet Vu, FNP', 'Clinicas Mi Doctor MD Kids Pediatrics MD Family', '1740521723', 'Nurse Practitioner, PCP - Children', '(214) 466-6376', '6751 Abrams Road, Suite 108', 'Dallas', 'TX', '75231', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 232, false),
  ('Joseph D. Pham', 'Baylor Scott & White Dallas Diagnostic Association - Park Cities', '1982996088', 'PCP - Adults', '(469) 800-7100', '9101 N Central Expressway, Suite 300', 'Dallas', 'TX', '75231', 'Yes', 'Mon - Fri: 7:00am - 7:00pm
Sat: 7:00am - 1:00pm', null, null, null, null, null, 233, false),
  ('Mai T. Tran', 'Medical City Arlington, Texas Health Arlington Memorial Hospital', '1275737868', 'PCP - Children', '(512) 259-3467', '2715 Osler Dr.', 'Grand Prairie', 'TX', '75051', 'Yes', '(972) 206-2940', null, null, null, null, null, 234, false),
  ('Thang Hoang', 'Thang Dinh Hoang M.D. Group', '1932101268', 'PCP - Children', '(281) 482-9994', '1816 Broadway Street Suite 110', 'Pearland', 'TX', '77581', 'Yes', 'Mon - Thurs: 8:00am - 4:30pm
Fri: 8:00am - 12:00pm', null, null, null, null, null, 235, false),
  ('Loan Nguyen', 'Memorial Hermann', '1164840492', 'PCP - Adults', '(281) 485-8876', '3203 Broadway St Ste 100', 'Pearland', 'TX', '77581', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 236, false),
  ('Quang Bui', 'Village Medical', '1518954049', 'PCP - Adults', '(713) 461-2915', '6122 Broadway St Ste 100', 'Pearland', 'TX', '77581', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 237, false),
  ('Thanh-Thao T. Le', 'Memorial Hermann', '1538459193', 'PCP - Adults', '(713) 413-6610', '10907 Memorial Hermann Dr Ste 100', 'Pearland', 'TX', '77584', 'Yes', 'Mon - Fri: 7:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 238, false),
  ('Bich G. Nguyen', 'Village Medical - Beeler-Manske Clinic', '1093709834', 'PCP - Adults', '(409) 228-1166', '7111 Medical Center Dr Ste 200', 'Texas', 'TX', '77591', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 239, false),
  ('Jimmy D. Doan', 'JIMMY D. DOAN M.D INTERNAL MEDICINE / PEDIATRICS THE DOAN AND VO CLINIC, P.A', '1225042914', 'PCP - Children', '(832) 230-8721', '5413 Crenshaw Rd. Ste 333', 'Pasadena', 'TX', '77505', 'Yes', 'Mon - Thurs: 9:00am - 5:00pm
Fri: 9:00am - 12:00pm', null, null, null, null, null, 240, false),
  ('Di Van Le', 'Clear Lake Medical Group', '1154315414', 'PCP - Adults', '(281) 486-7900', '450 W Medical Center Boulevard, Suite 400', 'Webster', 'TX', '77598', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 241, false),
  ('Dennis Tang', 'Clear Lake Medical Group', '1154315349', 'PCP - Adults', '(281) 316-6064', '450 W Medical Center Boulevard, Suite 400', 'Webster', 'TX', '77598', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 242, false),
  ('Phuong Anh T. Nguyen', null, '1992034391', 'Nurse Practitioner', '(281) 316-0046', '500 W Medical Center Boulevard', 'Webster', 'TX', '77598', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 243, false),
  ('Nancy T. Ngo', 'Triangle Pediatrics', '1366448557', 'PCP - Children', '(409) 722-3761', '8333 9th Ave C', 'Port Arthur', 'TX', '77642', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri: 8:30am - 12:00pm', null, null, null, null, null, 244, false),
  ('Anson T. Huynh', 'Legacy Community Health', '1174900575', 'PCP - Adults', '(409) 242-2526, (832) 548-5000', '3455 Stagg Drive', 'Beaumont', 'TX', '77701', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 245, false),
  ('Tuan A Dao', 'Insight Medical Clinic', '1013453265', 'PCP - Adults', '(409) 227-4529', '1233 S Main St', 'Lumberton', 'TX', '77657', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 1:00pm', null, null, null, null, null, 246, false),
  ('Tan Duong', 'Broadway Medical Office', '1528091642', 'PCP - Adults', '(773) 878-4800', '5449 N Broadway', 'Chicago', 'IL', '60640', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 247, false),
  ('Tommy Q. Dang', 'S M G Uptown (Swedish Medical Group)', '1639539752', 'PCP - Adults', '(773) 293-4200', '5060 North Broadway Street', 'Chicago', 'IL', '60640', 'Yes', 'Mon: 8:00am - 6:00pm
Tues/Wed: 7:00am - 4:30pm
Thurs: 8:00am - 4:30pm
Fri: 7:00am - 5:00pm', null, null, null, null, null, 248, false),
  ('Sean Adam Le', 'SMG Uptown', '1578552915', 'PCP - Adults', '(773) 293-4200', '5060 North Broadway Street', 'Chicago', 'IL', '60640', 'Yes', 'Mon/Wed: 10:00am - 6:00pm
Thurs: 10:00am - 5:00pm
Sat: 9:00am - 2:00pm', null, null, null, null, null, 249, false),
  ('Queenie T. Duong', 'Medical City Internal Medicine - Grand Prairie', '1144782046', 'PCP - Adults', '(817) 633-9590, (972) 457-2970', '5203 Lake Ridge Pkwy Suite 101', 'Grand Prairie', 'TX', '75052', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 250, false),
  ('Dana Huyen M. Dinh', null, '1851337190', 'PCP - Adults', '(817) 460-2580', '2440 S Collins St Suite 140', 'Arlington', 'TX', '76014', 'Yes', 'Mon - Fri: 8:30am - 5:30pm
Sat: 8:30am - 12:30pm', null, null, null, null, null, 251, false),
  ('Mai Vu-Quynh Hoang', 'Mai Hoang, MD Palm Primary Care - Haltom City', '1801982335', 'PCP - Adults', '(817) 759-2315', '4045 E Belknap St', 'Haltom', 'TX', '76111', 'Yes', 'Mon - Fri: 8:30am - 4:30pm', null, null, null, null, null, 252, false),
  ('Tuan Huu Nguyen', 'Tuan Nguyen, MD Palm Primary Care - Haltom City', '1881663193', 'PCP - Adults', '(817) 759-2315', '4045 E Belknap St', 'Haltom', 'TX', '76111', 'Yes', 'Mon - Fri: 8:30am - 4:30pm', null, null, null, null, null, 253, false),
  ('Nhung H. Tran', 'Tarrant Internal Medicine and Pediatrics, PLLC', '1720737703', 'Nurse Practitioner, PCP - Children', '(817) 984-7100', '7520 N Beach St Ste 108', 'Fort Worth', 'TX', '76137', 'Yes', 'Mon - Fri: 8:30am - 4:00pm
Sat: 8:30am - 12:00pm', null, null, null, null, null, 254, false),
  ('Thao Phuong P. Nguyen', 'Metroplex Medical Centre Fort Worth', '1326493941', 'PCP - Adults', '(682) 610-7900', '201 Commerce St', 'Fort Worth', 'TX', '76102', 'Yes', 'Mon - Fri: 7:30am - 4:30pm', null, null, null, null, null, 255, false),
  ('Julius N. Ngu', 'Jayhealth Medical Group Inc', '1952748238', 'PCP - Adults', '(214) 444-7871', '351 W Randol Mill Rd Ste 131', 'Arlington', 'TX', '76011', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 256, false),
  ('Ha Do', 'Tarrant Internal Medicine and Pediatrics, PLLC', null, 'PCP - Children', '(817) 984-7100', '7520 N Beach St Ste 108', 'Fort Worth', 'TX', '76137', 'Yes', 'Mon - Fri: 8:30am - 4:30pm', null, null, null, null, null, 257, false),
  ('Minh Q. Le', null, '1629203724', 'PCP - Adults', '(817) 466-9100', '6507 S Cooper St Ste 105', 'Arlington', 'TX', '76001', 'Yes', 'Mon - Fri: 7:00am - 4:30pm', null, null, null, null, null, 258, false),
  ('Khoi Tran', null, '1750769840', 'PCP - Adults', '(682) 242-8990', '252 Matlock Rd Ste 130', 'Mansfield', 'TX', '76063', 'Yes', 'Mon - Thurs: 7:00am - 5:00pm
Fri: 7:00am - 3:00pm', null, null, null, null, null, 259, false),
  ('Tuan D. Nguyen', 'Texas Health Resources', '1427027762', 'PCP - Adults', '(817) 557-9616', '3295 S Cooper St Ste 101', 'Arlington', 'TX', '76015', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 260, false),
  ('Dan D. Nguyen', null, '1568779742', 'PCP - Adults', '(972) 247-3600', '12879 Josey Ln Ste 100', 'Farmers Branch', 'TX', '75234', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 261, false),
  ('Memorial Hermann', 'Memorial Hermann Health System', null, 'Hospital', '(713) 242-3000', 'Memorial Hermann''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 9:00am - 3:00pm
Sat: 10:30am - 1:30pm
24/7 for ER', null, null, null, null, null, 262, true),
  ('St. Luke''s Health', 'Common Spirit', null, 'Hospital, Urgent Care, PCP - Adults, Neurology, Cardiologist, Orthopedic', null, 'St.Luke''s Health''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 263, true),
  ('HCA Healthcare', 'HCA Healthcare', null, 'Hospital, Urgent Care, PCP - Family (Adults and Children)', null, 'HCA Healthcare''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 264, true),
  ('Houston Methodist', 'Houston Methodist', null, 'Hospital, PCP - Family (Adults and Children), Urgent Care, Imaging Facility', null, 'Houston Methodist''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 265, true),
  ('Baylor College of Medicine', 'Baylor College of Medicine', null, 'Hospital, Specialists, PCP - Family (Adults and Children), Cardiologist, Orthopedic', null, 'BCM''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 266, true),
  ('UT Physician', 'UT Physician', null, 'Hospital, Cardiologist, Orthopedic, Urology, OBGYN', null, 'UT Physicians''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 267, true),
  ('Texas Children''s Specialty Care Sugar Land', 'Texas Children''s Specialty Care Sugar Land', null, 'Hospital, Urgent Care, Imaging Facility', '(281) 494-7010', '15400 Southwest Fwy Suite 100, 200, 310', 'Sugar Land', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 268, false),
  ('Texas Children''s Pediatrics', null, null, 'PCP - Children, Hospital', null, 'Texas Children''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 269, true),
  ('CHRISTUS Health System', null, null, 'PCP - Family (Adults and Children), Urgent Care, Orthopedic, OBGYN, ER', null, 'CHRISTUS''s Locations', '', 'TX', null, 'Yes', 'Mon - Fri: 8:00am - 5:00pm
24/7 for ER', null, null, null, null, null, 270, true),
  ('CVS', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 271, false),
  ('HEB', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 272, false),
  ('Walmart', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 273, false),
  ('Walgreen', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 274, false),
  ('Kroger', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 275, false),
  ('Randalls', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 276, false),
  ('Costco', null, null, 'Pharmacy', null, null, '', 'TX', null, 'Yes', 'Based on each locations', null, null, null, null, null, 277, false),
  ('Kim-Thu Chu', 'HCA West Houston OBGYN', '131609039', 'OBGYN', '(713) 230-8677', '12606 W Houston Center Blvd Suite 302', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
Sat: 8:00am - 3:00pm', null, null, null, null, null, 278, false),
  ('Cindy ThanhHoa H. Bui', 'Southwest WomanCare OBGYN', '1871813782', 'OBGYN', '(832) 649-4273', '7789 Southwest Fwy, Suite 400', 'Houston', 'TX', '77074', 'Yes', 'Mon - Fri: 8:00am - 4:30pm
Sat: 8:00am - 1:30pm', 'CHC Premier, CHC Select, Ambetter EPO, BCBS MyBlue Health, BCBS Advantage', null, null, 'Ngan Nguyen', '01/06/2026', 279, false),
  ('Jeanie Thao-Uyen Huynh', 'Houston Women''s Center', '1497704415', 'OBGYN', '(281) 497-1177', '12121 Richmond Ave. #403', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:00am - 5:00pm
Sat: 9:00am - 12:00pm', null, null, null, null, null, 280, false),
  ('Oanh N. Bui', 'Cypress OBGYN', '1871987966', 'OBGYN', '(281) 477-0417', '10680 Jones Rd #600', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 281, false),
  ('Chau Nguyen-Tran', 'Sugar Land Women''s Care', '1568464840', 'OBGYN', '(713) 578-3820', '17520 W Grand Pkwy S Suite 230', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Thurs: 8:30am - 5:00pm
Fri: 8:30am - 2:00pm', 'CHC Select', null, null, null, null, 282, false),
  ('Ashley J. Lopez', 'Centromed', '1437668787', 'PCP - Children', '(210) 223-3543', '17323 IH 35 North, Suite 113 & 114', 'Schertz', 'TX', '78154', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 283, false),
  ('Ha T Nguyen', 'UT Physicians Multispecialty - Greens', '1740523372', 'OBGYN', '(713) 486-5600', '550 Greens Pkwy Suite 150', 'Houston', 'TX', '77067', 'Yes', 'Mon/Wed/Fri: 8:00am - 5:00pm
Tues/Thurs: 9:00am -7:00pm
Sat: 8:00am - 12:00pm', 'CHC Premier, CHC Select, Oscar HMO, Oscar EPO', null, null, 'Ngan Nguyen', '01/06/2026', 284, false),
  ('Vu Truong', 'Northeast OB/GYN', '1134180961', 'OBGYN', '(210) 653-5501', '1139 East Sonterra Blvd. Suite 205', 'San Antonio', 'TX', '78258', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 285, false),
  ('Julie K. Vu', 'Ovation OBGYN', '1891850905', 'OBGYN', '(972) 777-3232', '5758 Warren Pkwy Suite 200 Professional Building 2', 'Frisco', 'TX', '75034', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 12:00pm', null, null, null, null, null, 286, false),
  ('Duc Bui Le', 'Sugar Land OBGYN', '1952313462', 'OBGYN', '(281) 499-4999', '3525 Town Center Blvd S', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', 'CHC Select', null, null, null, null, 287, false),
  ('Laura Nguyen', 'Team Dermatology', '1710578190', 'Dermatology, Physician Assistant', '(832) 572-5533', '1435 Hwy 6 Ste 250', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm', null, null, null, null, null, 288, false),
  ('Simone Stalling', 'Aviva Dermatology', '1922310911', 'Dermatology', '(713) 468-0303', '915 Gessner Rd # 500', 'Houston', 'TX', '77024', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 289, false),
  ('Khanh Connie Nguyen', 'Premier Derm Center', '1487675898', 'Dermatology', '(832) 767-5975', '1245 Yale St # A', 'Houston', 'TX', '77008', 'Yes', 'Mon - Thurs: 10:00am - 6:00pm
Fri: 10:00am - 2:00pm', null, null, null, null, null, 290, false),
  ('Doanh Nguyen', 'Aspire Allergy & SInus', '1760640304', 'Allergist', '(281) 886-7440', '17203 Red Oak Dr # 101', 'Houston', 'TX', '77090', 'Yes', 'Mon/Fri: 8:30am - 5:30pm', null, null, null, null, null, 291, false),
  ('Leslie E Wilson', 'Rheumatology Partners of Houston, LLC.', '1861466815', 'Rheumatology', '(281) 315-8130', '129 Vision Park Blvd., Ste. 206', 'Shenandoah', 'TX', '77384', 'Yes', 'Mon - Thurs: 8:00am - 4:30pm
Fri: 8:00am - 3:00pm', null, null, null, null, null, 292, false),
  ('Hung Le', 'Le Eye Institute', '1902913825', 'Opthamology', '(713) 772-2020', '6002 Rogerdale Rd Ste 150', 'Houston', 'TX', '77072', 'Yes', 'Mon/Tues/Thurs: 8:45am - 5:00pm
Wed: 8:45am - 4:00pm
Fri: 9:00am - 1:00pm', 'CHC Select', null, null, null, null, 293, false),
  ('Johnny P. Mai', 'Allergy & ENT Associates', '1669738787', 'Otolaryngologist (ENT)', '(281) 325-0258', '1201 Creek Way Dr Ste A', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon: 9:00am - 6:00pm
Tue/Wed: 8:30am - 5:00pm
Thurs: 9:30am - 6:30pm
Fri: 7:30am - 3:00pm', null, null, null, null, null, 294, false),
  ('Khuyen Do', 'Houston Cardiology', '1730481516', 'Cardiologist', '(832) 930-7794', '9440 Bellaire Blvd #212', 'Houston', 'TX', '77036', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, null, null, null, null, 295, false),
  ('Mark L. Mayo', 'Eye Center of Texas', '1538144423', 'Opthamology', '(281) 977-8800', '4415 Crenshaw Rd', 'Pasadena', 'TX', '77504', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, null, 296, false),
  ('Louay Zeid', 'CLS Health', '1407087430', 'OBGYN', '(346) 586-7050', '4615 Southwest Fwy 10th Floor', 'Houston', 'TX', '77027', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm', null, null, null, null, null, 297, false),
  ('Vivian Duong', 'West Houston OBGYN', '1235786062', 'Nurse Practitioner', '(346) 776-7234', '12606 West Houston Center Boulevard, Suite 302', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 298, false),
  ('KIM-Thu Chu', 'West Houston OBGYN', '1316090392', 'OBGYN', '(713) 230-8677', '12606 West Houston Center Boulevard, Suite 302', 'Houston', 'TX', '77082', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm
Fri: 8:00am - 1:00pm', 'Ambetter HMO, Ambetter EPO, Oscar HMO, Oscar EPO, BCBS MyBlue Health', null, null, 'Ngan Nguyen', '01/06/2026', 299, false),
  ('Nicole N. Tran', 'The Woman’s Hospital of Texas', '1699768994', 'OBGYN', '(713) 795-1000', '7400 Fannin Street, Suite 1050', 'Houston', 'TX', '77054', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, null, 300, false),
  ('Vu Quach', null, '1427430883', 'Physician Assistant', '(713) 873-2000', '1504 Taub Loop Fl 5', 'Houston', 'TX', '77030', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, null, null, null, null, 301, false),
  ('Truc T. Inthaphom', 'Blue Fish Pediatrics', '1982015616', 'PCP - Children', '(832) 334-4011', '27700 Northwest Fwy, Suite 440', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 8:30am - 5:00pm', null, null, null, null, null, 302, false),
  ('Steven Nguyen', 'Village Medical', '1780723346', 'PCP - Adults', '(346) 396-2451', '21820 Katy Fwy Ste 200.', 'Katy', 'TX', '77449', 'Yes', 'Mon - Fri: 7:30am - 5:00pm', 'BCBS Advantage, CHC Premier, CHC Select', null, null, 'Zoe Nguyen', '01/07/2026', 303, false),
  ('Ronald M. Pucillo', 'Pucillo Family Practice PA', '1548263106', 'PCP - Adults', '(281) 340-9355', '1111 Hwy 6 Suite 40', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Fri: 7:00am - 7:00pm
Sat: 8:00am - 12:00pm', null, null, null, null, null, 304, false),
  ('Rea Colby', 'Village Medical', '1649835968', 'PCP - Adults', '(726) 200-1715', '901 Bitters Rd, Suite 102', 'San Antonio', 'TX', '78216', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'CHC Select', null, null, null, null, 305, false),
  ('Quoc D. Le', 'Willow Brook Medical', '1396787396', 'PCP - Adults', '(832) 698-4377', '18310 Tomball Pkwy STE 200', 'Houston', 'TX', '77070', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', 'CHC Select', 'CHC Dualcare', null, null, null, 306, false),
  ('Huynh Nelson', 'Village Medical', '1447883335', 'Nurse Practitioner', '(210) 695-1900', '6800 1H-10 W, Suite 200', 'San Antonio', 'TX', '78201', 'Yes', 'Based on each location', 'Oscar HMO, Oscar EPO', null, null, null, null, 307, false),
  ('Huynh Nelson', 'Village Medical', '1447883335', 'Nurse Practitioner', '(726) 200-1725', '5282 Medical Dr., Suite 210', 'San Antonio', 'TX', '78229', 'Yes', 'Based on each location', 'Oscar HMO, Oscar EPO', null, null, null, null, 307, false),
  ('Ailinh Do', 'Memorial Hermann', '1518520634', 'PCP - Children', '(713) 242-2222', '915 Gessner Rd, Ste 100', 'Houston', 'TX', '77024', 'Yes', 'Mon - Fri: 7:00am - 5:30pm', 'CHC Select', 'Verda, CHC Dualcare', null, null, null, 308, false),
  ('Reginald Nguyen, MD', 'Memorial Hermann', '1306209614', 'PCP - Family (Adults and Children)', '(281) 766-5480', '5201 Highway 6, Ste 595', 'Missouri City', 'TX', '77459', 'Yes', 'Mon - Thurs: 8:00am - 4:30pm
Fri: 8:00am - 2:30pm', null, 'CHC D-SNP', null, null, null, 309, false),
  ('Mai T Pham, MD', 'Baytown Health Center', '1902251317', 'PCP - Family (Adults and Children)', '(281) 837-2700', '1602 Garth Road', 'Baytown', 'TX', '77520', 'Yes', 'Mon - Fri: 7:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 310, false),
  ('Duc M Vu, MD', 'TMH Physician Associates PLLC', '1124423751', 'PCP - Family (Adults and Children)', '(281) 737-0587', '13300 Hargrave Rd, Ste 480', 'Houston', 'TX', '77070', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 311, false),
  ('Lucy N Luu, MD', 'Memorial Hermann Hospital Based Physician Group', '1619363413', 'Emergency Medicine, Specialists', '(281) 929-6100', '11800 Astoria Blvd', 'Houston', 'TX', '77089', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 312, false),
  ('Tatsuo Yamakawa, MD', 'Memorial Hermann Hospital Based Physician Group', '1033345855', 'Emergency Medicine, Specialists', '(713) 867-2000, (713) 338-6565', '1635 North Loop W', 'Houston', 'TX', '77008', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 313, false),
  ('John K Wueste, PA', 'Memorial Hermann Hospital Based Physician Group', '1679582571', 'General Surgeon', '(713) 500-7004', '6431 FANNIN ST STE 6.150', 'Houston', 'TX', '77030', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 314, false),
  ('Ngan T Nguyen, MD', 'Ngan T Nguyen MD PLLC', '1750701710', 'General Surgeon', '(346) 298-0777', '23920 Katy Fwy, Ste 405', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 315, false),
  ('Quy Pham, MD', 'Clear Dermatology PLLC', '1487000154', 'Dermatology', '(832) 772-3330', '17756 Katy Fwy, Ste G1', 'Houston', 'TX', '77094', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 316, false),
  ('Thien An Nguyen, MD', 'Memorial Hermann', '1477872505', 'Pulmonologist', '(713) 520-6875', '7015 Almeda Rd, Ste 3', 'Houston', 'TX', '77054', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 317, false),
  ('Thien An Nguyen, MD', 'Memorial Hermann', '1477872505', 'Pulmonologist', '(281) 703-3020', '23900 Katy Frwy', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 7:00am - 7:00pm', null, 'CHC D-SNP', null, null, null, 318, false),
  ('Lisa M Davila, APN', 'Legacy Community Health Services Inc', '1972141158', 'PCP - Adults', '(832) 548-5000', '450 N 11th St.', 'Beaumont', 'TX', '77702', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 319, false),
  ('Justina F Assaad, OD', 'UH Eye Surgery Center', '1174140081', 'Opthamology', '(713) 743-2020', '4401 Martin Luther King Blvd', 'Houston', 'TX', '77204', 'Yes', 'Mon - Thurs: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 320, false),
  ('Dung D Nguyen, MD', 'Memorial Hermann Medical Group', '1437416518', 'Hospital', '(713) 867-2066', '1635 North Loop West, South Tower Fl 1', 'Houston', 'TX', '77008', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 321, false),
  ('Ling-Chun Lu, MD', 'St. Luke''s Health - Sugar Land Hospital - Sugar Land, TX', '1083051569', 'Emergency Medicine', '(281) 637-7700', '1317 Lake Pointe Pkwy', 'Sugar Land', 'TX', '77478', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 322, false),
  ('Stephen Odaibo, MD', 'Retina Health', '1174840920', 'Opthamology', '(832) 234-9050', '2925 Richmond Ave, Suite 1200', 'Houston', 'TX', '77098', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 323, false),
  ('Meron A Fitta, OD', 'UH College of Optometry', '1336872084', 'Opthamology', '(713) 743-2020', '4401 Martin Luther King Blvd', 'Houston', 'TX', '77204', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 324, false),
  ('Lei Wang, MD', 'Memorial Hermann Medical Group', '1558925263', 'Hospital', '(713) 792-6161', '1515 HOLCOMBE BLVD', 'Houston', 'TX', '77030', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 325, false),
  ('Juana Gaytan, PA', 'HOPE Clinic', '1154917797', 'Physician Assistant', '(713) 773-0803', '2112 Aldine Meadows Rd', 'Houston', 'TX', '77032', 'Yes', 'Mon: 11:00am - 7:00pm
Tue - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 326, false),
  ('Hector Carrillo, OD', 'Children''s Hospital of Orange County', '1609587831', 'Opthamology', '(714) 203-2181', '1201 W. La Veta Ave., Suite 100', 'Orange', 'CA', '92868', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 327, false),
  ('Diane Sayah, OD', 'UH College of Optometry', '1811667298', 'Opthamology', '(713) 743-0421', '4401 Martin Luther King Blvd', 'Houston', 'TX', '77204', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 328, false),
  ('Lisa Ostrin, OD', 'University Of Houston Eye Institute', '1902933484', 'Opthamology', '(713) 857-9983', '4901 CALHOUN RD', 'Houston', 'TX', '77004', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 329, false),
  ('Sarah Tarkenaka, OD', null, '1063126167', 'Opthamology', '(713) 743-1921', '4401 Martin Luther King Blvd', 'Houston', 'TX', '77204', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 330, false),
  ('Muriel Martinez, OD', 'Lifetime Eyecare Associates', '1982045951', 'Opthamology', '(281) 465-8300', '27214 Kuykendahl Rd, Ste 100', 'The Woodlands
Spring', 'TX', '77375', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 331, false),
  ('Muriel Martinez, OD', 'Lifetime Eyecare Associates', '1982045951', 'Opthamology', '(281) 465-8300', '8515 Spring Cypress Rd, Ste 105', 'The Woodlands
Spring', 'TX', '77379', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 331, false),
  ('Vanessa R Chen, MD', 'Memorial Hermann Medical Group', '1124648043', 'PCP - Family (Adults and Children)', '(281) 277-0695', '16550 Southwest Fwy, Ste B', 'Sugar Land', 'TX', '77479', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 332, false),
  ('Qiong Lu, APN', 'Woodlands Heart and Vascular Institute PA', '1891452264', 'Nurse Practitioner', '(832) 562-3974', '920 Medical Plaza Dr, Ste 260', 'Shenandoah', 'TX', '77380', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 333, false),
  ('Kim N Huynh, APN', 'Memorial Hermann Medical Group', '1104396647', 'Neurology', '(346) 231-5887', '27800 Northwest Fwy, Ste 4201', 'Cypress', 'TX', '77433', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 334, false),
  ('Jingyang Ye, MD', 'Memorial Hermann Medical Group', '1962023416', 'Hospital', '(832) 231-2609', '23900 Katy Fwy', 'Katy', 'TX', '77494', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 335, false),
  ('Parth M Dixit, DPM', 'Houston Cardiothoracic and Vein Surgeons PLLC', '1689164337', 'Podiatrist', '(832) 305-5693', '1900 North Loop W, Ste 180', 'Houston', 'TX', '77018', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 336, false),
  ('Parth M Dixit, DPM', 'Garcia Heart And Vascular', '1689164337', 'Podiatrist', '(713) 244-4134', '2200 North Loop West, SUITE 300', 'Houston', 'TX', '77018', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 336, false),
  ('Brandon Le, OD', 'University Of Houston Eye Institute', '1740962323', 'Opthamology', '(713) 743-1921', '4401 Martin Luther King Blvd', 'Houston', 'TX', '77204', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 337, false),
  ('Andrew Salem, OD', 'Diagnostic Eye Center', '1114218278', 'Opthamology', '(713) 893-1868', '3405 Edloe Street, Suite 300', 'Houston', 'TX', '77027', 'Yes', 'Mon - Thurs: 8:00am - 5:30pm
Fri: 8:00am - 3:00pm', null, 'CHC D-SNP', null, null, null, 338, false),
  ('Barbara Stivala, OD', 'Northside Eye Care Center', '1003592692', 'Opthamology', '(817) 625-4709', '2332 Beverly Hills Dr', 'Fort Worth', 'TX', '76114', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 339, false),
  ('Frank C Lee, MD', 'Charles A Garcia MD PA', '1932163839', 'Opthamology', '(713) 333-0151', '4704 Montrose Blvd', 'Houston', 'TX', '77006', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 340, false),
  ('Daniel Y Zhang, PA', 'Gastrodoxs PLLC', '1265295000', 'Gastroenterology, Physician Assistant', '(832) 476-7389', '10425 Huffmeister Rd, Ste 280', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'CHC D-SNP', null, null, null, 341, false),
  ('Robert Robinson, MD', 'TP Health Clinic', '1386756989', 'Psychiatrist', '(832) 916-2677', '4810 Riverstone Blvd', 'Missouri City', 'TX', '77459', 'Yes', 'Mon - Fri: 9:00am - 6:00pm', null, 'CHC D-SNP', null, null, null, 342, false),
  ('Ryan R Harris, MD', 'Texana Center', '1205240850', null, '(281) 239-1443', '4910 Airport Ave, Bldg D', 'Rosenberg', 'TX', '77471', 'Yes', null, null, 'CHC D-SNP', null, null, null, 343, false),
  ('Ryan R Harris, MD', 'Bread of Life Inc', '1205240850', null, null, '2019 Crawford St', 'Houston', 'TX', '77002', 'Yes', null, null, 'CHC D-SNP', null, null, null, 344, false),
  ('Christine Feng, MD', 'Memorial Hermann Medical Group', '1801399977', null, '(281) 929-6291', '11800 Astoria Blvd, Ste E 2031 1', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 345, false),
  ('Joyce Shiau, OD', 'Pupila Family Eye Care', '1437525854', null, '(281) 741-7295', '14634 Memorial Dr', 'Houston', 'TX', '77079', 'Yes', null, null, 'CHC D-SNP', null, null, null, 346, false),
  ('Luwei Tao, MD', 'TMH Physician Associates PLLC', '1639601966', null, '(346) 356-7000', '4191 Bellaire Blvd, Ste 250', 'Houston', 'TX', '77025', 'Yes', null, null, 'CHC D-SNP', null, null, null, 347, false),
  ('Truong Q Ngo, PA', 'Trumen Physicians and Associates PLLC', '1669588679', null, '(713) 796-9955', '2626 S Loop W, Ste 265', 'Houston', 'TX', '77054', 'Yes', null, null, 'CHC D-SNP', null, null, null, 348, false),
  ('Shikha Bharaktiya, MD', 'Endocrinology Clinics of Texas PA', '1467460139', null, '(281) 779-4243', '7500 Beechnut St, Ste 252', 'Houston', 'TX', '77074', 'Yes', null, null, 'CHC D-SNP', null, null, null, 349, false),
  ('Maria P Nguyen, MD', 'UTMB Faculty Group Practice', '1609936582', null, '(281) 585-2530', '2020 E Highway 6', 'Alvin', 'TX', '77511', 'Yes', null, null, 'CHC D-SNP', null, null, null, 350, false),
  ('Phong V Vu, MD', 'Memorial Hermann Hospital Based Physician Group', '1356653612', null, '(713) 932-3000', '921 Gessner Rd', 'Houston', 'TX', '77024', 'Yes', null, null, 'CHC D-SNP', null, null, null, 351, false),
  ('Phong V Vu, MD', 'UT Physicians', '1356653612', null, '(713) 448-6455', '921 Gessner Rd', 'Houston', 'TX', '77024', 'Yes', null, null, 'CHC D-SNP', null, null, null, 352, false),
  ('Swati C. Modi, OD', 'Cedar Springs Eye Clinic', '1548263809', null, '(713) 743-2020', '4401 Martin Luther King Blvd, Rm 2195', 'Houston', 'TX', '77204', 'Yes', null, null, 'CHC D-SNP', null, null, null, 353, false),
  ('Anjali Aggarwal, MD', 'Baylor AMS', '1063687663', null, '(713) 272-2600', '6630 De Moss St', 'Houston', 'TX', '77074', 'Yes', null, null, 'CHC D-SNP', null, null, null, 354, false),
  ('Joseph H Vu, MD', 'Baylor AMS', '1306926647', null, '(713) 873-2860', '1504 Taub Loop, Dept of Anesthesia 4th Fl', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 355, false),
  ('Doan K Nguyen, MD', 'ADS Orthopaedics', '1619945896', null, '(281) 807-5432', '11301 Fallbrook Dr, Ste 100', 'Houston', 'TX', '77065', 'Yes', null, null, 'CHC D-SNP', null, null, null, 356, false),
  ('Connie K Tran, MD', 'Baylor AMS', '1376623611', null, '(713) 873-2860', '1504 Taub Loop, Dept of Anesthesia 4th Fl', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 357, false),
  ('Khoa V Pham, MD', 'Baylor AMS', '1124056650', null, '(713) 861-3939', '1100 West 34th St', 'Houston', 'TX', '77018', 'Yes', null, null, 'CHC D-SNP', null, null, null, 358, false),
  ('Lan K Nguyen, MD', '1960 Physician Associates', '1477632586', null, '(281) 586-3888', '837 Cypress Creek Pkwy, Ste 105', 'Houston', 'TX', '77090', 'Yes', null, null, 'CHC D-SNP', null, null, null, 359, false),
  ('Quyen Trinh, DO', 'Mason Park Medical Clinic', '1033205224', null, '(281) 646-0740', '21770 Kingsland Blvd', 'Katy', 'TX', '77450', 'Yes', null, null, 'CHC D-SNP', null, null, null, 360, false),
  ('Ruth Wintz, MD', 'Kidney Associates PLLC', '1891728168', null, '(713) 795-5511', '6560 Fannin St, Ste 1730', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 361, false),
  ('Dora E Cantu, MD', 'OPIA Vision Center', '1194725366', null, '(713) 405-7646', '1740 W 27th St, Ste 180', 'Houston', 'TX', '77008', 'Yes', null, null, 'CHC D-SNP', null, null, null, 362, false),
  ('Dora E Cantu, MD', 'Northwest Eye Associates', '1194725366', null, '(713) 864-8652', '1740 W 27th St, Ste 180', 'Houston', 'TX', '77008', 'Yes', null, null, 'CHC D-SNP', null, null, null, 363, false),
  ('Kathryn Musgrove, MD', 'Houston Eye Associates', '1326033424', null, '(713) 668-6828', '2855 Gramercy St', 'Houston', 'TX', '77025', 'Yes', null, null, 'CHC D-SNP', null, null, null, 364, false),
  ('Dac Tien Vu, MD', 'Center for Integrated Medicine PA', '1649245663', null, '(713) 272-8858', '8278 Bellaire Blvd Ste A', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 365, false),
  ('Khoa D Tran, MD', 'Houston Head & Neck Surgical PA', '1124011945', null, '(281) 897-1112', '10311 North Eldridge Pkwy Ste B4', 'Houston', 'TX', '77065', 'Yes', null, null, 'CHC D-SNP', null, null, null, 366, false),
  ('Nam N Hoang, MD', 'Simcare PLLC', '1578563524', null, '(281) 491-1911', '2225 Williams Trace Blvd Ste 110', 'Sugar Land', 'TX', '77478', 'Yes', null, null, 'CHC D-SNP', null, null, null, 367, false),
  ('Nam N Hoang, MD', 'VillageMD of Southeast Texas PA', '1578563524', null, '(713) 797-1087', '4543 Post Oak Place Dr Suite 105', 'Houston', 'TX', '77027', 'Yes', null, null, 'CHC D-SNP', null, null, null, 368, false),
  ('Nam N Hoang, MD', 'Medical Associates Of Pearland', '1578563524', null, '(281) 997-7333', '2425 County Rd 90', 'Pearland', 'TX', '77584', 'Yes', null, null, 'CHC D-SNP', null, null, null, 369, false),
  ('Talynn A Hanissian, MD', 'Hanissian Pediatrics, PLLC', '1891749339', null, '(713) 644-1119', '9809 Rowlett Rd Ste A1', 'Houston', 'TX', '77075', 'Yes', null, null, 'CHC D-SNP', null, null, null, 370, false),
  ('Andre L Huu, PT', 'ProActive Physical Therapy Centers', '1942405055', null, '(281) 998-8600', '4600 Fairmont Pkwy Ste 205', 'Pasadena', 'TX', '77504', 'Yes', null, null, 'CHC D-SNP', null, null, null, 371, false),
  ('Thanh K Hoang, MD', 'Horizon Healthcare Clinic', '1508828724', null, '(281) 564-2900', '11210 Bellaire Blvd Ste 126A', 'Houston', 'TX', '77072', 'Yes', null, null, 'CHC D-SNP', null, null, null, 372, false),
  ('Binh T Nguyen, MD', 'Nephrology, Dialysis & Transplantation Associates PA', '1881696888', null, '(713) 790-9080', '6560 Fannin St Ste 1824', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 373, false),
  ('Christopher Kwoh, MD', 'Nephrology, Dialysis & Transplantation Associates PA', '1962427534', null, '(713) 790-9080', '6560 Fannin St Ste 1824', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 374, false),
  ('Becky J Fredrickson, MD', 'Houston Eye Associates', '1134129455', null, '(713) 869-6400', '1415 N Loop West Ste 400', 'Houston', 'TX', '77008', 'Yes', null, null, 'CHC D-SNP', null, null, null, 375, false),
  ('Marsha E Thigpen, MD', 'Gulf Coast Health Center Inc', '1518047000', null, '(409) 983-1161', '2548 Memorial Blvd', 'Port Arthur', 'TX', '77640', 'Yes', null, null, 'CHC D-SNP', null, null, null, 376, false),
  ('Khanh PC Nguyen, MD', 'Harmony Physicians Associates', '1003803974', null, '(281) 530-0300', '10839 Bellaire Blvd Suite C', 'Houston', 'TX', '77072', 'Yes', null, null, 'CHC D-SNP', null, null, null, 377, false),
  ('Julie D Ngo, OD', 'Eye Center Of Texas, LLP', '1851541189', null, '(470) 482-0044', '6565 West Loop S Ste 650', 'Bellaire', 'TX', '77401', 'Yes', null, null, 'CHC D-SNP', null, null, null, 378, false),
  ('Jean L Bombach, MD', 'Asian American Health Coalition of the Greater Houston Area', '1689676827', null, '(713) 773-0803', '7001 Corporate Dr Ste 120', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 379, false),
  ('Rosabelle V McConkey, MD', 'Wishing Well Childrens Clinic PLLC', '1093020117', null, '(832) 856-4600', '1259 FM 1463 Ste 300', 'Katy', 'TX', '77494', 'Yes', null, null, 'CHC D-SNP', null, null, null, 380, false),
  ('Ninh H Nguyen, DO', 'Advanced ENT and Allergy PLLC', '1003027038', null, '(832) 604-3636', '10726 Huffmeister Rd Ste 140', 'Houston', 'TX', '77065', 'Yes', null, null, 'CHC D-SNP', null, null, null, 381, false),
  ('Ninh H Nguyen, DO', 'Specialty Associates of West Houston, PLLC', '1003027038', null, '(832) 604-3636', '11307 FM 1960 Rd W Ste #260', 'Houston', 'TX', '77065', 'Yes', null, null, 'CHC D-SNP', null, null, null, 382, false),
  ('Uzma Ali, MD', 'Kingwood Neurology And Sleep PA', '1235337254', null, '(281) 359-5981', '320 Kingwood Executive Dr Ste E', 'Kingwood', 'TX', '77339', 'Yes', null, null, 'CHC D-SNP', null, null, null, 383, false),
  ('Hoang L Le, MD', 'Memorial Hermann Medical Group', '1497993141', null, '(281) 929-4420', '11920 Astoria Blvd Ste 350', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 384, false),
  ('Bich V Nguyen, MD', 'Bich Nguyen MD PA', '1558458851', null, '(281) 484-0449', '11034 Scarsdale Blvd Ste B', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 385, false),
  ('Jennifer T Nguyen, MD', 'Privia Medical Group Gulf Coast, PLLC', '1053330126', null, '(281) 537-5556', '19740 I 45 N', 'Spring', 'TX', '77373', 'Yes', null, null, 'CHC D-SNP', null, null, null, 386, false),
  ('Jennifer T Nguyen, MD', 'OBHG Texas Holdings, PA', '1053330126', null, '(864) 908-3530', '9250 Pinecroft Dr', 'The Woodlands', 'TX', '77380', 'Yes', null, null, 'CHC D-SNP', null, null, null, 387, false),
  ('Jennifer T Nguyen, MD', 'Advantage Women''s Care', '1053330126', null, '(281) 537-5556', '19740 I-45', 'Spring', 'TX', '77373', 'Yes', null, null, 'CHC D-SNP', null, null, null, 388, false),
  ('Ben Taub General Hospital', 'Harris Health System', '1205900370', null, '(713) 873-2000', '1504 Taub Loop', 'Houston', 'TX', '77030', 'Yes', null, null, 'CHC D-SNP', null, null, null, 389, false),
  ('John J Alappatt, MD', 'Houston Retina Associates', '1568409688', null, '(281) 495-2222', '7789 Southwest Fwy Ste 530', 'Houston', 'TX', '77074', 'Yes', null, null, 'CHC D-SNP', null, null, null, 390, false),
  ('Michael K Lam, MD', 'Houston Retina Associates', '1548200835', null, '(281) 495-2222', '7789 Southwest Fwy Ste 530', 'Houston', 'TX', '77074', 'Yes', null, null, 'CHC D-SNP', null, null, null, 391, false),
  ('Falanda M Limar-Troutman, DO', 'TMH Physician Associates PLLC', '1588685580', null, '(281) 523-3110', '2220 E League City Pkwy Ste 200', 'League City', 'TX', '77573', 'Yes', null, null, 'CHC D-SNP', null, null, null, 392, false),
  ('Jimin Wang, MD', 'Jimin Wang, MD, PA', '1316933690', null, '(713) 272-6442', '9888 Bellaire Blvd Ste 122', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 393, false),
  ('Thang D Hoang, MD', 'Vitalcare Medical', '1932101268', null, '(281) 482-9994', '1816 Broadway St Ste 110', 'Pearland', 'TX', '77581', 'Yes', null, null, 'CHC D-SNP', null, null, null, 394, false),
  ('Cuong X Nguyen, DO', 'Coung Xuan Ngyen DO PA', '1093828667', null, '(281) 922-9100', '11914 Astoria Blvd Ste 555', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 395, false),
  ('Thu Ha L Lee, MD', 'Southwest Surgical Associates', '1992802334', null, '(713) 772-1200', '920 Frostwood Dr Ste 620', 'Houston', 'TX', '77024', 'Yes', null, null, 'CHC D-SNP', null, null, null, 396, false),
  ('Nadim S Jafri, MD', 'Memorial Hermann Medical Group', '1326173386', null, '(281) 725-5970', '17520 W Grand Pkwy S Ste 350', 'Sugar Land', 'TX', '77479', 'Yes', null, null, 'CHC D-SNP', null, null, null, 397, false),
  ('George P Hanna, MD', 'Bay City Cardiology Clinic - Bay City', '1124027669', null, '(979) 323-7000', '5274 State Highway 60 S', 'Bay City', 'TX', '77414', 'Yes', null, null, 'CHC D-SNP', null, null, null, 398, false),
  ('George P Hanna, MD', 'Sweetwater Angiography Center, LP', '1124027669', null, '(281) 240-1016', '16651 Southwest Fwy Ste 250', 'Sugar Land', 'TX', '77479', 'Yes', null, null, 'CHC D-SNP', null, null, null, 399, false),
  ('Mazen S Ganim, MD', 'Vital Heart and Vein', '1740398577', null, '(281) 446-6656', '18450 Hwy 59 N', 'Humble', 'TX', '77338', 'Yes', null, null, 'CHC D-SNP', null, null, null, 400, false),
  ('Thanh A Nguyen, MD', 'Memorial Hermann Medical Group', '1518967090', null, '(281) 332-0202', '250 Blossom St Ste 220', 'Webster', 'TX', '77598', 'Yes', null, null, 'CHC D-SNP', null, null, null, 401, false),
  ('Uyen H Ta, MD', 'Legacy Community Health Services Inc', '1184634198', null, '(832) 548-5000', '5420 Dashwood Dr Ste 100', 'Houston', 'TX', '77081', 'Yes', null, null, 'CHC D-SNP', null, null, null, 402, false),
  ('Woon K Sim, MD', 'Physicians Clinic', '1730130782', null, '(713) 827-9900', '902 Frostwood Dr Ste 186', 'Houston', 'TX', '77024', 'Yes', null, null, 'CHC D-SNP', null, null, null, 403, false),
  ('Nathaniel L Barnes, MD', 'Memorial Hermann Medical Group', '1033119516', null, '(281) 332-0202', '250 Blossom St Ste 220', 'Webster', 'TX', '77598', 'Yes', null, null, 'CHC D-SNP', null, null, null, 404, false),
  ('Han H Dang, MD', 'Global Kidney Center PLLC', '1811929508', null, '(713) 866-6201', '2525 North Loop W Ste 600', 'Houston', 'TX', '77008', 'Yes', null, null, 'CHC D-SNP', null, null, null, 405, false),
  ('Jeanie Huynh, DO', 'OBHG Texas Holdings, PA', '1497704415', null, '(800) 967-2289', '1317 Lake Pointe Pkwy', 'Sugar Land', 'TX', '77478', 'Yes', null, null, 'CHC D-SNP', null, null, null, 406, false),
  ('Jeanie Huynh, DO', 'Houston Womens Center', '1497704415', null, '(281) 497-1177', '12121 Richmond Ave Ste 214', 'Houston', 'TX', '77082', 'Yes', null, null, 'CHC D-SNP', null, null, null, 407, false),
  ('Bay V Nguyen, MD', 'Bay Van Nguyen MD PA', '1811975477', null, '(281) 333-4556', '2045 Space Park Dr Ste 170', 'Houston', 'TX', '77058', 'Yes', null, null, 'CHC D-SNP', null, null, null, 408, false),
  ('Nhu Q Nguyen, MD', 'Summit Eye Associates', '1811959216', null, '(281) 530-0300', '8200 Wilcrest Dr Ste 9', 'Houston', 'TX', '77072', 'Yes', null, null, 'CHC D-SNP', null, null, null, 409, false),
  ('Chuong H Pham, MD', 'TMH Physician Associates PLLC', '1467420992', null, '(832) 533-3700', '24510 Northwest Fwy Bldg 1 Ste 580', 'Cypress', 'TX', '77429', 'Yes', null, null, 'CHC D-SNP', null, null, null, 410, false),
  ('Chuong H Pham, MD', 'Pediatrix Medical Group Of TX', '1467420992', null, '(281) 737-1000', '18220 State Hwy 249', 'Houston', 'TX', '77070', 'Yes', null, null, 'CHC D-SNP', null, null, null, 411, false),
  ('Tuan Mai, DPM', 'Mais Foot Specialist PA', '1629026620', null, '(832) 359-3125', '10655-A Fuqua', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 412, false),
  ('Tom T Nguyen, MD', 'Tom T Nguyen MD PA', '1093749400', null, '(281) 322-2222', '9722 Highway 90A Ste 207', 'Sugar Land', 'TX', '77478', 'Yes', null, null, 'CHC D-SNP', null, null, null, 413, false),
  ('Hanh M Nguyen, OD', 'Berkeley Eye Center', '1275591950', null, '(281) 422-2020', '4301 Garth Rd Ste 100', 'Baytown', 'TX', '77521', 'Yes', null, null, 'CHC D-SNP', null, null, null, 414, false),
  ('Hanh M Nguyen, OD', 'San Jacinto Region Eye Center', '1275591950', null, '(281) 422-2020', '4301 Garth Rd Ste 100', 'Baytown', 'TX', '77521', 'Yes', null, null, 'CHC D-SNP', null, null, null, 415, false),
  ('Christine C Chen, MD', 'Memorial Hermann Medical Group', '1285778571', null, '(281) 388-3700', '252 N Bypass 35 Ste D', 'Alvin', 'TX', '77511', 'Yes', null, null, 'CHC D-SNP', null, null, null, 416, false),
  ('Christina T Hai, MD', 'Pediatric Cardiology Care PA', '1194070615', null, '(281) 648-3000', '4130 Bellaire Blvd Ste 206', 'Houston', 'TX', '77025', 'Yes', null, null, 'CHC D-SNP', null, null, null, 417, false),
  ('My D Le, MD', 'Bich Nguyen MD PA', '1417107434', null, '(281) 484-0449', '11034 Scarsdale Blvd Ste B', 'Houston', 'TX', '77089', 'Yes', null, null, 'CHC D-SNP', null, null, null, 418, false),
  ('Duy T Hoang, DO', 'TMH Physician Associates PLLC', '1982915013', null, '(281) 737-0587', '1330 Hargrave Rd Ste 480', 'Houston', 'TX', '77070', 'Yes', null, null, 'CHC D-SNP', null, null, null, 419, false),
  ('Thi Thanh Nguyen, DO', 'First Urgent Care, PA', '1427343623', null, '(409) 344-4557', '3620 FM Hwy 365 Ste 400', 'Port Arthur', 'TX', '77642', 'Yes', null, null, 'CHC D-SNP', null, null, null, 420, false),
  ('Cindy-Thanhhoa H Bui, MD', 'Southwest Woman Care OBGYN PLLC', '1871813782', null, '(832) 779-4944', '7789 Southwest Fwy Ste 400', 'Houston', 'TX', '77074', 'Yes', null, null, 'CHC D-SNP', null, null, null, 421, false),
  ('Na Liu, MD', 'Bellaire Pediatrics', '1356732119', null, '(713) 777-7772', '8250 Bellaire Blvd Ste 1', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 422, false),
  ('Selina Hall, APN', 'Night Light Pediatric Urgent Care', '1235437617', null, '(281) 325-1010', '15551 Southwest Fwy', 'Sugar Land', 'TX', '77478', 'Yes', null, null, 'CHC D-SNP', null, null, null, 423, false),
  ('Selina Hall, APN', 'Cesar Parra MD Medical Clinic', '1235437617', null, '(713) 468-9003', '1821 Wirt Rd', 'Houston', 'TX', '77055', 'Yes', null, null, 'CHC D-SNP', null, null, null, 424, false),
  ('Tuan A Nguyen, MD', 'Gessner Medical Center', '1932238821', null, '(713) 270-8818', '5704 S Gessner Rd Ste D', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 425, false),
  ('Bidhan B Das, MD', 'Southwest Surgical Associates', '1881832145', null, '(713) 772-1200', '17510 W Grand Pkwy Ste 490', 'Sugar Land', 'TX', '77479', 'Yes', null, null, 'CHC D-SNP', null, null, null, 426, false),
  ('Fangxian Lu, MD', 'Sunshine Womens Care Clinic', '1275879066', null, '(281) 302-5026', '4732 Sugar Grove Blvd Ste 600', 'Stafford', 'TX', '77477', 'Yes', null, null, 'CHC D-SNP', null, null, null, 427, false),
  ('Fangxian Lu, MD', 'OBHG Texas Holdings, PA', '1275879066', null, '(800) 967-2289', '18300 Houston Methodist Dr', 'Houston', 'TX', '77058', 'Yes', null, null, 'CHC D-SNP', null, null, null, 428, false),
  ('Fangxian Lu, MD', 'UT Physicians', '1275879066', null, '(713) 556-5600', '5656 Kelley Street', 'Houston', 'TX', '77026', 'Yes', null, null, 'CHC D-SNP', null, null, null, 429, false),
  ('Dianne N Tran, MD', 'Memorial Hermann Medical Group', '1699091835', null, '(713) 242-3768', '921 Gessner Rd RM 317', 'Houston', 'TX', '77024', 'Yes', null, null, 'CHC D-SNP', null, null, null, 430, false),
  ('Dianne N Tran, MD', 'Dianne Tran MD PLLC', '1699091835', null, '(816) 517-6634', '1722 Bayram Dr', 'Houston', 'TX', '77055', 'Yes', null, null, 'CHC D-SNP', null, null, null, 431, false),
  ('Marili M Jackson, APN', 'Kids Care Pediatrics PA', '1033466537', null, '(713) 668-8900', '5800 Bellaire Blvd Ste 102', 'Houston', 'TX', '77081', 'Yes', null, null, 'CHC D-SNP', null, null, null, 432, false),
  ('Marili M Jackson, APN', 'Topcare Medical Group Inc', '1033466537', null, '(713) 807-8921', '1213 Hermann Dr Ste 770', 'Houston', 'TX', '77004', 'Yes', null, null, 'CHC D-SNP', null, null, null, 433, false),
  ('Marili M Jackson, APN', 'Houston Pediatric Clinic', '1033466537', null, '(832) 968-6050', '1625 Romano Park Ln', 'Houston', 'TX', '77090', 'Yes', null, null, 'CHC D-SNP', null, null, null, 434, false),
  ('Marili M Jackson, APN', 'Cesar Parra MD Medical Clinic', '1033466537', null, '(713) 468-9000', '1821 Wirt Rd', 'Houston', 'TX', '77055', 'Yes', null, null, 'CHC D-SNP', null, null, null, 435, false),
  ('Tony T Nguyen, MD', 'Village Dermatology PLLC', '1538425749', null, '(713) 952-8400', '7575 San Felipe St Ste 300', 'Houston', 'TX', '77063', 'Yes', null, null, 'CHC D-SNP', null, null, null, 436, false),
  ('Monica P Agrawal, MD', 'Trumen Physicians and Associates PLLC', '1184852642', null, '(713) 796-9955', '2626 S Loop W Ste 265', 'Houston', 'TX', '77054', 'Yes', null, null, 'CHC D-SNP', null, null, null, 437, false),
  ('Monica P Agrawal, MD', 'Rosewood Family Physicians PLLC', '1184852642', null, '(713) 266-7673', '2405 S Gessner Rd Ste B', 'Houston', 'TX', '77063', 'Yes', null, null, 'CHC D-SNP', null, null, null, 438, false),
  ('Ryan Christopher McHugh, MD', 'Mid County Pam Services LLC', '1811976715', null, '(409) 923-0012', '3610 Stagg Dr', 'Beaumont', 'TX', '77701', 'Yes', null, null, 'CHC D-SNP', null, null, null, 439, false),
  ('Ryan Christopher McHugh, MD', 'Winnie Community Clinic', '1811976715', null, '(409) 724-7904', '2400 Hwy 365 STE 112', 'Nederland', 'TX', '77627', 'Yes', null, null, 'CHC D-SNP', null, null, null, 440, false),
  ('Ryan Christopher McHugh, MD', 'Permian Premier Health Services, Inc', '1811976715', null, '(409) 853-5102', '2501 Jimmy Johnson Blvd Ste 201', 'Port Arthur', 'TX', '77640', 'Yes', null, null, 'CHC D-SNP', null, null, null, 441, false),
  ('KCI USA Inc', 'KCI USA INC', '1912994070', null, '(800) 275-4524', '2313 W Sam Houston Pkwy N Ste 127', 'Houston', 'TX', '77043', 'Yes', null, null, 'CHC D-SNP', null, null, null, 442, false),
  ('Truc Le, Jr, DO', 'Xpert MD PLLC', '1093714388', null, '(281) 332-3001', '18333 Egret Bay Blvd Ste 140', 'Houston', 'TX', '77058', 'Yes', null, null, 'CHC D-SNP', null, null, null, 443, false),
  ('Deanna D McDonald, MD', 'Fort Bend OB GYN LLP', '1730191214', null, '(281) 499-4999', '3525 Town Ctr Blvd S', 'Sugar Land', 'TX', '77479', 'Yes', null, null, 'CHC D-SNP', null, null, null, 444, false),
  ('Khanh N Ngo, DO', 'Providence Family Practice PA', '1245299841', null, '(713) 270-7224', '9798 Bellaire Blvd Ste D', 'Houston', 'TX', '77036', 'Yes', null, null, 'CHC D-SNP', null, null, null, 445, false),
  ('Marita Obenza, MD', 'Legacy Community Health Services Inc', '1962494153', null, '(832) 548-5000', '3455 Stagg Dr', 'Beaumont', 'TX', '77701', 'Yes', null, null, 'CHC D-SNP', null, null, null, 446, false),
  ('Thomas Iszard, OD', 'Charles A Garcia MD PA', '1871625103', null, '(713) 453-3521', '1315 St Joseph Pkwy Suite 1205', 'Houston', 'TX', '77002', 'Yes', null, null, 'CHC D-SNP', null, null, null, 447, false),
  ('Harsh Patel, DDS', 'DentalSave Dental Plans', '1952022519', 'Dentist', '(281) 304-1319', '17814 Spring Cypress Rd Ste 101', 'Cypress', 'TX', '77429', 'Yes', 'Mon - Fri: 8:00am - 5:00pm', null, 'Verda', null, null, null, 448, false),
  ('Michele Truong, D.D.S.', 'LA DENTAL II', '1740485184', 'Dentist', '(281) 568-8200', '11201 Bellaire Blvd., Suite A-18', 'Houston', 'TX', '77072', 'Yes', 'Mon - Fri: 9:00am - 6:00pm
Sat: 9:00am - 4:00pm
Sun: 9:00am - 3:00pm', null, 'Verda', null, null, null, 449, false),
  ('Roli Okotie Eboh, D.D.S', 'Lovett Dental Sugar Land', null, 'Dentist', '(281) 759-5900', '3402 S Texas 6 C', 'Houston', 'TX', '77082', 'Yes', 'Mon - Fri: 9:00am - 6:00pm
Sat: 9:00am - 5:00pm', null, 'Verda', null, null, null, 450, false),
  ('Vu Tran, D.D.S', 'Splendid Dental Care', null, 'Dentist', '(832) 365-4821', '2156 Spring Stuebner Rd Unit 510', 'Spring', 'TX', '77389', 'Yes', 'Mon - Fri: 8:00am - 7:00pm
Sat: 8:00am - 2:00pm', null, 'Verda', null, null, null, 451, false),
  ('Huynh Dung N DDS', 'Lovett Dental Jersey Village', '1265593628', 'Dentist', '(281) 890-5002', '12711 FM 1960 Rd', 'Houston', 'TX', '77065', 'Yes', 'Mon - Fri: 9:00am - 5:00pm', null, 'Verda', null, null, null, 452, false)
  ;
end $$;

-- ---------------------------------------------------------------------
-- Kiểm chứng — cả bốn cột phải ra 'ok'.
-- ---------------------------------------------------------------------
select
  case when (select count(*) from provider_directory) = 458
       then 'ok' else 'FAIL: số bản ghi không phải 458' end            as so_ban_ghi,
  case when (select count(*) from provider_directory
             where doctors is null and facility is null) = 0
       then 'ok' else 'FAIL: có dòng không tên' end                    as deu_co_ten,
  case when (select count(*) from provider_directory
             where phone is not null
               and phone !~ '^\(\d{3}\) \d{3}-\d{4}') = 0
       then 'ok' else 'FAIL: điện thoại chưa chuẩn' end                as dien_thoai,
  case when (select count(*) from provider_directory
             where state is not null and length(state) <> 2) = 0
       then 'ok' else 'FAIL: bang chưa về mã 2 chữ' end                as bang;

-- Số liệu để đối chiếu với màn hình sau khi deploy.
select
  count(*) as tong,
  count(*) filter (where needs_review) as can_nguoi_xem,
  count(*) filter (where obamacare is not null) as co_aca,
  count(*) filter (where medicare is not null) as co_medicare
from provider_directory;
