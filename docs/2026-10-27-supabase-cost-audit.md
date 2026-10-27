# Supabase — chi phí $40/tháng và lỗ hổng (bản cuối, 27/10/2026)

Bản này gộp phần kiểm tra chi phí của Codex với phần kiểm tra database và bảo mật của Claude. Mọi số liệu đều lấy bằng truy vấn chỉ-đọc ngày 26–27/10. **EPS chưa thay đổi gì.**

> Bản đưa lên repo đã lược chi tiết của mục S1 (đang mở). Bản đầy đủ giữ ở máy local.

> **Cập nhật 27/10/2026 — đã xử lý xong 2 project ngoài EPS.**
> - **Đã xoá LeetCode Portal** (`nlgjizqtpdriydyjxdfe`).
>   - Kiểm trước khi xoá: 0 dòng, chưa ghi lần nào, đăng nhập cuối 15/08, không có file và không có Edge Function.
>   - Schema vẫn còn trong `~/Project/Leetcode/supabase/migrations`: 2 file, khớp 2 migration đã chạy.
> - **Đã chuyển MathIGCSE sang org Free "BaoVoThuong Free"** (`dtjocqivackpawgmjxab`).
>   - Trước khi chuyển: backup JSON 17 bảng ra `~/Project/Edu/mathbridge-supabase-backup-2026-10-27`.
>   - Kiểm sau khi chuyển: đủ 36.473 dòng, 3 tài khoản, 1.996 file. Key không đổi. REST, Auth và Storage đều trả 200.
> - **Org Pro giờ chỉ còn EPS.**
>   - Hoá đơn 9/11 khoảng $37, do còn compute đầu kỳ của 2 project kia.
>   - Từ hoá đơn 9/12 còn **$25/tháng**.
> - **Lưu ý khi MathIGCSE ở gói Free:**
>   - 7 ngày không ai dùng thì project tự pause (có email báo trước). Muốn chạy lại thì vào Dashboard bấm Resume project.
>   - Không có backup hằng ngày.

## 1. Kết luận

- **Hoá đơn `KKUGPM-00008` (9/10/2026) là $39.66**, gồm $25 gói Pro và $14.66 compute. Các khoản usage khác (egress, Realtime, storage, MAU) đều **$0** vì nằm trong hạn mức.
- **$14.66 compute là tiền máy của 2 project không phải EPS:** `LeetCode Portal` ($9.46) và `MathIGCSE` ($5.74, tạo 21/9 nên chưa chạy đủ kỳ). Compute của EPS ($9.46) được credit $10 của gói Pro trả hết.
- **Giữ nguyên thì hoá đơn tăng lên khoảng $44 từ kỳ tới**, vì MathIGCSE chạy đủ kỳ. Đưa 2 project kia ra khỏi org Pro thì còn **$25/tháng**: tiết kiệm khoảng $19/tháng (~43%), **không đụng gì tới EPS** vì mỗi project có máy riêng.
- **EPS dùng rất ít so với hạn mức:** egress 22%, Realtime 2.5%, database 131 MB trên 8 GB. Vì vậy **không cần và không nên** sửa code hay đổi compute của EPS để giảm tiền.
- **Về lỗ hổng:** Supabase không có chỗ nào mở cho người ngoài, vì RLS bật trên cả 107/107 bảng. Có 4 việc cần làm:
  - Nguồn dữ liệu ngoài Supabase cần đóng chia sẻ link (S1, đang mở).
  - Hàm `ai_run_select` chạy SQL tuỳ ý với quyền owner.
  - Một hàm của MathIGCSE bị tạo nhầm trong DB của EPS.
  - Khoảng 30 bảng backup/legacy giữ bản sao dữ liệu khách.

## 2. Hoá đơn tách theo project

Kỳ usage là 9/9–8/10/2026. Riêng phí gói Pro trả trước cho kỳ 9/10–8/11.

| Khoản | EPS Portal | LeetCode Portal | MathIGCSE | Hạn mức Pro | Phải trả |
| --- | ---: | ---: | ---: | ---: | ---: |
| Compute Micro ($0.01344/giờ) | 704 giờ · $9.46 | 704 giờ · $9.46 | 427 giờ · $5.74 | credit $10 cho cả org | **$14.66** |
| Egress | 54.24 GB | — | 0.54 GB | 250 GB | $0 |
| Cached egress | 0.39 GB | — | 0.01 GB | 250 GB | $0 |
| Storage | 170.8 GB-giờ (~0.24 GB) | — | 51.6 GB-giờ | 100 GB | $0 |
| Realtime messages (cả org) | 125,253 | | | 5,000,000 | $0 |
| Realtime peak connections (cả org) | 24 | | | 500 | $0 |
| MAU (cả org) | 4 | | | 100,000 | $0 |
| Gói Pro, trả trước 9/10–8/11 | | | | | **$25.00** |
| **Tổng** | | | | | **$39.66** |

- Mỗi hoá đơn gộp phí gói của kỳ hiện tại với compute và usage của kỳ trước. Vì vậy thay đổi hôm nay chỉ hiện ra ở hoá đơn sau.
- Compute tính theo giờ cho **mỗi project đang chạy**, dù có request hay không. Gói trả phí không chạy được máy Nano; nhỏ nhất là Micro, khoảng $10/tháng.
- Credit $10 chỉ trả cho **một** project Micro trong org.

## 3. Tiết kiệm: 2 project ngoài EPS

### Hiện trạng

Số liệu lấy ngày 27/10, chỉ là các chỉ số tổng (không đọc nội dung dữ liệu).

| | LeetCode Portal | MathIGCSE |
| --- | --- | --- |
| Ref / region | `nlgjizqtpdriydyjxdfe` · Singapore | `igfgyazwxbwmcqllcfse` · Singapore |
| Ngày tạo | 11/08/2026 | 21/09/2026 |
| Compute | Micro | Micro |
| Database | 13 MB; 11 bảng, **0 dòng, chưa từng có lượt ghi** | 43 MB; 17 bảng, khoảng 36.500 dòng |
| Storage | 0 | 119 MB |
| Tài khoản Auth | 4 | 3 |
| Egress kỳ trước | ~0 | 0.54 GB |

- **LeetCode Portal đang trống**: mỗi tháng trả khoảng $10 cho một máy không chứa dữ liệu nào.
- **MathIGCSE nhỏ và ít dùng.** Nó nằm gọn trong hạn mức gói Free: 500 MB database, 1 GB storage, 5 GB egress, 50k MAU, 2 triệu Realtime message, 200 peak connection.

### Phương án

| Phương án | Hoá đơn/tháng ước tính |
| --- | ---: |
| Giữ cả 3 project trên Pro | khoảng $44 |
| Chỉ chuyển hoặc xoá LeetCode | khoảng $35 |
| **Chuyển hoặc xoá cả LeetCode lẫn MathIGCSE (đề xuất, đã làm 27/10)** | **$25** |

Các con số trên chưa gồm thuế và add-on.

### Cách làm

**Chuyển sang một org gói Free** (giữ lại project, không tốn tiền):

1. Dashboard → **New organization** → chọn gói **Free**.
2. Mở project → Settings → General → **Transfer project** → chọn org Free vừa tạo.
3. Điều kiện để chuyển:
   - Bạn là owner của org nguồn và là member của org đích.
   - Project không gắn GitHub integration và không có log drain.
   - Gói Free cho tối đa **2 project đang chạy**, tính trên mọi org bạn làm owner/admin. Project đã pause không bị tính.
4. Chuyển từ Pro sang Free có thể **mất kết nối 1–2 phút**.
5. Trên gói Free:
   - Máy là Nano, yếu hơn Micro.
   - Project **tự pause sau 7 ngày ít hoạt động**.
   - Resume lại được từ Dashboard trong vòng **1 năm**.
6. Org nguồn vẫn bị tính usage cho tới lúc chuyển, khoản đó nằm trong hoá đơn kế tiếp.

**Hoặc xoá project** (hợp với LeetCode vì nó đang trống): ngừng tính tiền ngay, nhưng **không khôi phục được**.

**Ảnh hưởng tới EPS: không có.** Compute tính riêng cho từng project. EPS vẫn ở org Pro, vẫn chạy Micro, và credit $10 vẫn trả compute của nó.

**Khi nào thấy tiền giảm:** compute tính theo giờ và trả sau. Ví dụ chuyển cả hai project ngày 28/10:
- Hoá đơn 9/11 khoảng $37, gồm $25 cộng compute 9/10–8/11 là EPS $9.68 + khoảng $6.1 × 2 − $10.
- Từ hoá đơn 9/12 còn **$25**.

## 4. EPS Portal — giữ nguyên

| Chỉ số (26–27/10) | Giá trị | Hạn mức / ghi chú |
| --- | --- | --- |
| Compute | Micro (60 connections, shared_buffers 224 MB) | Mức nhỏ nhất của gói trả phí; credit trả hết |
| Database | 131 MB | 8 GB disk |
| Storage | `task-attachments` 665 MB (1.300 file); `avatars` 129 kB | 100 GB. Tăng nhanh từ khi cho đính kèm 50 MB (24/10) |
| Tải DB | ~380 truy vấn/phút, ~0,5 giây xử lý mỗi phút (đo 17:26–17:33 UTC ngày 26/10) | Dưới 1% một nhân CPU. Cộng dồn từ 30/04: trung bình ~3,6 phút xử lý mỗi ngày |
| Egress | 54 GB/kỳ | 22% của 250 GB |
| Realtime | 125k message; 24 peak connection | 2,5% / 5% |

Các cơ chế đang giữ tải thấp (Codex đã kiểm, Claude xác nhận lại trong code):

- Chuông poll mỗi 120 giây khi Realtime khỏe, mỗi 30 giây khi mất Realtime (`NotificationBell.tsx`).
- Link file đã ký được dùng lại trong 45 phút (`reuse-signed-urls.ts`).
- File đính kèm tới 50 MB tải thẳng lên Storage, không đi qua Vercel.
- Sync Google Sheet sạch: 0 dòng staging, 0 lượt sync treo. Lần chạy gần nhất (26/10 lúc 02:00 UTC) ghi 17.163 dòng Health và 4.421 dòng P&C.

## 5. Lỗ hổng bảo mật

### Những gì đang ổn

- RLS bật trên **107/107** bảng `public` và không có policy nào. Anon key (công khai trong trình duyệt) không đọc hay ghi được dòng nào.
- anon và authenticated không gọi được hàm SECURITY DEFINER nào.
- Bucket `task-attachments` là private: dùng link ký, tối đa 50 MB, 10 loại file. `avatars` public có chủ ý: tối đa 512 KB, 3 loại ảnh.
- Realtime chỉ dùng Broadcast, nội dung tin chỉ có id. Topic của chuông được băm HMAC theo từng user.
- Database không có pg_cron hay pg_net, và `public` không có view hay materialized view nào.

### Cần xử lý (xếp theo mức độ)

> **Cập nhật 27/10:**
> - **S2, S3, S4: xong.**
>   - Đã chạy rollout `supabase/rollouts/2026-10-27-drop-legacy-objects.sql` (file giữ local).
>   - CSV của 33 bảng nằm ở `~/Project/Web/_db-backups/eps-legacy-tables-2026-10-27`.
>   - Sau khi chạy: `public` còn 84 bảng, tất cả bật RLS.
> - **S1: đang mở.** `datasync/lib/google-sheet.js` đã có chốt: Google trả thứ không phải CSV thì sync báo lỗi, không ghi đè bảng.
> - **S5: chưa làm** (tuỳ chọn).

| # | Vấn đề | Rủi ro | Đề xuất | Ảnh hưởng hiệu năng |
| --- | --- | --- | --- | --- |
| S1 | Nguồn dữ liệu ngoài Supabase cần đóng chia sẻ link. Chi tiết giữ ở bản local cho tới khi sửa xong. | — | — | — |
| S2 | Hàm `public.ai_run_select(p_sql text)`: SECURITY DEFINER, owner là `postgres`. Hàm chạy **bất kỳ câu SQL nào** được truyền vào, chỉ chặn ghi và giới hạn 8 giây. Hàm không có trong repo lẫn git history, và đã được gọi 8 lần qua service_role (bản AI chat cũ). | Hiện chỉ service_role gọi được. Nhưng nếu sau này có code đưa chữ người dùng nhập vào hàm này, hoặc lộ service key, thì đọc được mọi bảng mà `postgres` đọc được, vượt qua RLS. | `drop function public.ai_run_select(text);` | Không |
| S3 | Hàm `public.create_adaptive_test(uuid, integer, integer, integer)` là của MathIGCSE nhưng bị tạo nhầm trong DB của EPS: các bảng nó dùng không tồn tại ở EPS. anon gọi được hàm này, nhưng gọi sẽ lỗi. | Thấp. Nhưng nó cho thấy đã từng có lần chạy SQL nhầm project. | `drop function public.create_adaptive_test(uuid, integer, integer, integer);`. Luôn nhìn tên project trước khi chạy SQL Editor. Đưa 2 project kia sang org khác cũng giảm khả năng nhầm. | Không |
| S4 | Bản sao dữ liệu không ai bảo trì, tổng khoảng 3,3 MB: (a) 20 bảng `_bk_20260817_*` (Task) và `_bk_20261004_*` (Lead) do rollout tạo; (b) schema `access_backup` gồm 10 bảng (account, role, quyền); (c) 3 bảng không có trong repo: `health_client_submission` (bảng đăng ký Health cũ, có tên khách và policy ID), `pc_month_base_policy`, `role_permissions_lead_timeoff_backup`. | Bản sao dữ liệu khách và nhân sự nằm ngoài mọi quy trình. Không tốn tiền. | Xuất CSV để lưu trữ, rồi xoá khi chắc chắn không cần rollback nữa. | Không |
| S5 | Quyền mặc định của Supabase: anon và authenticated có mọi quyền trên 103 bảng, và EXECUTE trên 52 hàm trong `public`. | Hiện không khai thác được: RLS chặn mọi dòng, và API không cho chạy TRUNCATE. | Tuỳ chọn: thu hồi quyền của anon/authenticated trong `public`, vì trình duyệt chỉ dùng Realtime còn server dùng service_role. Sau khi thu hồi phải thử lại Realtime và upload file. | Không |
| — | Advisor của Supabase báo 11 cảnh báo `function_search_path_mutable` và 1 cảnh báo `extension_in_public` (pg_trgm). | Thấp. | **Giữ nguyên.** Thêm `SET search_path` làm các hàm `parse_health_*` mất inline nên chạy chậm hơn (đã quyết định ngày 12/10). Dời pg_trgm phải dựng lại các index trigram. | — |

## 6. Không nên làm

Các việc dưới đây không giảm tiền, hoặc làm chậm và kém ổn định:

- **Không chuyển EPS sang gói Free:**
  - Egress 54 GB, vượt hạn mức Free 5 GB.
  - Storage 665 MB, sát hạn mức 1 GB.
  - Có thể bị tự pause.
- **Không hạ hay nâng compute của EPS.** Micro là mức nhỏ nhất của gói trả phí và đã được credit trả. Database dùng chưa tới 1% CPU.
- **Không kéo dài chu kỳ poll, tắt Realtime hay giảm sync để tiết kiệm.** Các khoản này không bị tính tiền vì nằm trong hạn mức; làm vậy chỉ khiến dữ liệu chậm hơn.
- **Không bật Spend Cap để hạ tiền.** Spend Cap không chặn compute. Khi chạm quota, một số dịch vụ còn có thể bị hạn chế.
- **Không sửa 11 cảnh báo `search_path` và không dời pg_trgm**, vì lý do ở dòng cuối mục 5.

## 7. Theo dõi hằng tháng

Xem trang Usage trên Dashboard. Ngưỡng dưới đây đặt sớm, khoảng 60% hạn mức.

| Hạng mục | Ngưỡng cần điều tra | Làm gì |
| --- | --- | --- |
| Egress | Trên 150 GB/kỳ | Xem chi tiết theo service. Ưu tiên kiểm tra file đính kèm và các response lớn |
| Storage | Trên 50 GB | Tìm file lớn hoặc cũ, đặt chính sách dọn |
| Realtime | Trên 3 triệu message, hoặc trên 300 peak connection | Gộp các tín hiệu trùng nhau |
| Disk | Trên 6 GB | Phân tích database và WAL trước khi dọn. Xoá dòng không làm disk đã cấp nhỏ lại |
| Logs Ingest | Supabase **bắt đầu tính phí từ đầu 2027**: $0,50/GB sau 20 GB/tháng của gói Pro | Xem mục Logs trên trang Usage trước tháng 1/2027 |
| Add-on | Hoá đơn có thêm IPv4, PITR, custom domain, read replica, branching… | Đối chiếu xem từng project có thật sự cần không |

## 8. Trình tự thực hiện

1. ~~Xoá LeetCode Portal~~ — **xong 27/10**.
2. ~~Chuyển MathIGCSE sang org Free~~ — **xong 27/10**.
3. Kiểm hoá đơn 9/11 (dự kiến khoảng $37) và hoá đơn 9/12 (dự kiến $25).
4. ~~Bảo mật EPS: S2, S3, S4~~ — **xong 27/10**. S5 là tuỳ chọn, chưa làm.
5. S1: đang mở (chi tiết ở bản local).
6. Hằng tháng xem trang Usage theo bảng ở mục 7.

## 9. Giới hạn của lần kiểm tra

- Chưa xem trang Usage và Upcoming Invoice trên Dashboard; chỉ có hoá đơn 9/10. Số tiền của các kỳ sau là ước tính.
- Số liệu của 2 project ngoài EPS chỉ là chỉ số tổng (dung lượng, số dòng, số user). Chưa đọc nội dung và chưa biết ai đang dùng chúng.
- Tải DB của EPS đo trong một khung 6 phút, vào giờ làm việc bên Mỹ, cộng với số cộng dồn từ 30/04.

## Nguồn

Tài liệu Supabase:
- [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute)
- [Monthly invoice](https://supabase.com/docs/guides/platform/your-monthly-invoice)
- [Project transfer](https://supabase.com/docs/guides/platform/project-transfer)
- [Project pausing](https://supabase.com/docs/guides/platform/project-pausing)
- [Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Realtime messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Disk size](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size)
- [Logs ingest](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest)
- [Cost control](https://supabase.com/docs/guides/platform/cost-control)
- [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)
