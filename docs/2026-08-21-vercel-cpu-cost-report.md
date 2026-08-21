# Báo cáo: Cảnh báo vượt quota Vercel & phương án xử lý

**Ngày:** 21/08/2026
**Hệ thống:** Agent Portal (`agent-portal-vercel`)
**Người thực hiện:** Bảo
**Trạng thái:** Đã xử lý tình huống khẩn — còn phần tối ưu code chờ duyệt

---

## 1. Bối cảnh

Agent Portal là ứng dụng nội bộ (Next.js 16 + Supabase) đang chạy trên nền tảng **Vercel**, khu vực Singapore (`sin1`). Khoảng **50 agent** dùng hàng ngày cho: nhập liệu khách hàng, task board CS, đối soát statement P&C/Health, và quản lý enrollment ACA/Medicare.

Trước ngày 21/08, hệ thống chạy trên gói **Hobby (miễn phí)** của Vercel.

## 2. Sự việc

Ngày 21/08/2026, Vercel gửi email cảnh báo:

> *Your free team baovothuongs-projects has used 75% of the included free tier usage for Fluid Active CPU (4 hours). If you exceed the included free usage, your projects will be automatically paused.*

**Rủi ro:** nếu vượt quota, Vercel **tự động tạm dừng toàn bộ project**. Toàn bộ 50 agent sẽ mất truy cập vào portal cho đến khi nâng cấp gói. Đây là rủi ro gián đoạn vận hành, không phải rủi ro chi phí.

**Hành động ngay:** đã nâng cấp lên gói **Pro** trong cùng ngày để loại bỏ nguy cơ bị pause.

### "Fluid Active CPU" là gì

Vercel tính phí theo **thời gian CPU thực sự chạy** của các hàm phía server (render trang, API, cron). Đặc điểm quan trọng: **không tính** thời gian ngồi chờ I/O — chờ Supabase trả dữ liệu, chờ Google Sheets API. Chỉ tính lúc code thật sự đang tính toán.

Nghĩa là: 14 phút Active CPU **không phải** 14 phút chờ database. Đó là 14 phút CPU quay thật.

---

## 3. Số liệu đo được

Nguồn: Vercel Dashboard → Usage → Fluid Active CPU.

### Phân bổ theo project

| Project | Active CPU | Tỷ lệ |
|---|---:|---:|
| `agent-portal-vercel` | 2m 08s | 99.7% |
| `dsa-study-hub` | 0s | 0.3% |

Toàn bộ mức tiêu thụ đến từ Agent Portal.

### Phân bổ theo loại (19–20/08, 2 ngày)

| Loại | Active CPU | Tỷ lệ |
|---|---:|---:|
| `function` (API routes, render trang) | 31m 33s | 68.9% |
| `middleware` (lớp xác thực chạy trước mọi request) | **14m 15s** | **31.1%** |
| **Tổng** | **45m 48s** | |

### Đối chiếu với hạn mức

| Chỉ số | Giá trị |
|---|---|
| Mức dùng trung bình | ~40 phút CPU/ngày |
| Quy đổi tháng | **~20 giờ/tháng** |
| Hạn mức gói Hobby | **4 giờ/tháng** |
| Mức vượt | **~5 lần** |

**Kết luận:** gói miễn phí không còn khả thi cho hệ thống này ở quy mô hiện tại, kể cả khi tối ưu hết mức. Việc nâng cấp là bắt buộc, không phải lựa chọn.

### Điểm bất thường cần lưu ý

Middleware chiếm **31%** tổng CPU. Về nguyên tắc, middleware chỉ nên kiểm tra cookie đăng nhập rồi cho request đi tiếp — đây phải là phần nhẹ nhất hệ thống. Con số 14 phút cho thấy nó đang làm việc nặng hơn thiết kế rất nhiều. Phần 4 giải thích tại sao.

---

## 4. Nguyên nhân kỹ thuật

Sau khi rà soát mã nguồn, xác định được 3 nguyên nhân. Cả ba đều nằm ở lớp xác thực.

### 4.1. Hàm mã hóa mật khẩu chạy mỗi lần khởi động

**Vị trí:** `src/auth.ts` dòng 17–20

```ts
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "invalid-password-placeholder",
  10
);
```

Dòng này nằm ở cấp module — nghĩa là nó chạy **mỗi lần file được nạp vào bộ nhớ**, chứ không phải chỉ khi có người đăng nhập. Và file `src/proxy.ts` (middleware) lại import trực tiếp từ file này, nên middleware phải trả phí đó ở mỗi lần khởi động lạnh.

**Chi phí đo được:** benchmark trên máy dev cho kết quả **112–129ms CPU thuần** mỗi lần chạy. Trên hạ tầng chia sẻ của Vercel, con số này thường cao hơn 2–3 lần.

Đây là CPU bỏ ra để tính một chuỗi ký tự mà hơn 99% request không bao giờ dùng đến.

*Lưu ý về ý định thiết kế:* đoạn code này có mục đích chính đáng — chống kỹ thuật dò tài khoản qua đo thời gian phản hồi (timing attack). Vấn đề chỉ là **vị trí đặt**, không phải bản thân logic. Khi sửa sẽ giữ nguyên tính năng bảo mật này.

### 4.2. Truy vấn phân quyền chạy lại ở mọi request

**Vị trí:** `src/auth.ts` dòng 136–147

```ts
if (token.email) {
  const access = await getUserAccessByEmail(token.email);
  ...
}
```

Đoạn này không có điều kiện lọc. Hàm `jwt` của thư viện xác thực (NextAuth v5) chạy **mỗi lần hệ thống kiểm tra phiên đăng nhập** — tức là mỗi lần agent chuyển trang, mỗi lần gọi API, mỗi lần render component phía server.

Và truy vấn được gọi (`src/lib/rbac/access.ts` dòng 52–58) là một câu lồng 3 tầng bảng:

```
user_roles( roles( id, name, is_active, role_permissions(permission_key) ) )
```

Thời gian chờ database được Vercel tính rẻ, nhưng việc **phân tích kết quả JSON trả về và làm phẳng dữ liệu** là CPU thật, và nó buộc middleware phải giải mã rồi mã hóa lại token ở mỗi lượt.

**Quy mô ảnh hưởng:** 50 agent × mỗi thao tác chuyển trang = một truy vấn phân quyền lồng 3 tầng.

### 4.3. Middleware dùng chung cấu hình nặng với server

**Vị trí:** `src/proxy.ts` dòng 1

```ts
export { auth as proxy } from "@/auth";
```

Thư viện NextAuth v5 khuyến nghị tách làm hai file: một file cấu hình nhẹ dành riêng cho middleware (chỉ kiểm tra đăng nhập, không đụng database), và một file đầy đủ cho phía server.

Hiện tại dự án dùng chung một file. Hệ quả là middleware phải mang theo cả thư viện mã hóa `bcryptjs`, thư viện `@supabase/supabase-js` và toàn bộ module phân quyền. Gói cài đặt lớn → khởi động chậm → tốn CPU.

---

## 5. Phân tích chi phí

### Cơ chế tính tiền gói Pro

Điểm dễ hiểu nhầm: **$20 không phải là một túi tiền tiêu dần rồi hết.** Đó là phí nền tảng cố định hàng tháng, và bản thân nó **đã bao gồm $20 tín dụng sử dụng**, được cấp lại vào đầu mỗi tháng.

| Khoản | Nội dung |
|---|---|
| Phí nền tảng Pro | $20/tháng |
| Bao gồm | 1 chỗ ngồi (seat) triển khai |
| Bao gồm | **$20 tín dụng usage/tháng**, reset đầu tháng |
| Bao gồm | 1 TB băng thông + 10 triệu Edge Requests |
| Vượt tín dụng | Chuyển sang tính theo mức dùng thực tế |

Khác với Hobby, gói Pro **không bị tạm dừng** khi vượt hạn mức — chỉ phát sinh thêm phí.

**Lưu ý quan trọng về tín dụng:** phần tín dụng không dùng hết **sẽ hết hạn cuối tháng, không cộng dồn** sang tháng sau. Nghĩa là hóa đơn tối thiểu luôn là $20, bất kể dùng nhiều hay ít:

| Mức usage thực tế | Hóa đơn tháng đó |
|---|---|
| $3.20 | **$20** |
| $12.00 | **$20** |
| $19.99 | **$20** |
| $25.00 | **$25** |

Cách hiểu đúng: $20 là **phí thuê bao dịch vụ**, không phải số dư nạp trước. Tín dụng $20 là phần kèm theo, đóng vai trò trần sử dụng miễn phí chứ không phải ví tiền.

### Đơn giá khu vực Singapore (sin1)

| Tài nguyên | Đơn giá |
|---|---|
| Active CPU | **$0.160 / giờ** |
| Provisioned Memory | $0.0133 / GB-giờ |
| Invocations | $0.60 / triệu lượt |

### Tính toán ở mức dùng hiện tại

```
40 phút CPU/ngày × 30 ngày = 20 giờ CPU/tháng
20 giờ × $0.160/giờ        = $3.20/tháng
```

**$3.20 trên tín dụng $20 — tương đương 16%.**

### Trả lời câu hỏi "$20 dùng được bao lâu"

Tín dụng được cấp lại mỗi tháng nên không có chuyện "hết hạn". Ngưỡng tới hạn như sau:

| Mốc | Mức Active CPU |
|---|---|
| Đang dùng | 20 giờ/tháng (40 phút/ngày) |
| Tín dụng $20 chịu được | **~125 giờ/tháng** (~4 giờ/ngày) |
| Khoảng dư | **gấp ~6 lần** mức hiện tại |

Nói cách khác: lưu lượng phải tăng khoảng **6 lần** so với hiện nay thì mới bắt đầu phát sinh phí vượt — và khi đó cũng chỉ là vài đô la, không phải bị ngắt dịch vụ.

---

## 6. Những điểm chưa xác minh

Cần nêu rõ để tránh kết luận vội:

1. **Provisioned Memory chưa được đo.** Khoản này tính phí theo **toàn bộ thời gian instance sống, bao gồm cả lúc chờ I/O** — khác với Active CPU. Agent Portal gọi Supabase và Google Sheets rất nhiều nên thời gian chờ lớn. **Rất có thể khoản này tốn hơn Active CPU.** Con số $3.20 ở trên chỉ là phần CPU.

2. **Chưa biết route nào nặng nhất** trong 31m 33s của nhóm `function`. Cần vào Observability lọc theo CPU time. Dự đoán ban đầu: chức năng xuất Excel (statement P&C/Health) và logic đối soát — đây là các tác vụ tính toán thuần, đúng loại tốn CPU.

3. **Chưa xác minh middleware đang chạy trên runtime nào** (Node hay Edge). Nếu là Node thì chi phí khởi động lạnh cao hơn, càng củng cố hai đề xuất 4.1 và 4.3.

4. **Chưa đo Invocations, Edge Requests và băng thông** — cả ba đều có hạn mức riêng.

---

## 7. Khuyến nghị

### 7.1. Giữ gói Pro — bắt buộc

Hai lý do độc lập, mỗi lý do đều đủ để quyết định:

- **Kỹ thuật:** mức dùng thực tế vượt hạn mức miễn phí ~5 lần. Tối ưu tốt nhất cũng không đưa được về dưới 4 giờ/tháng.
- **Pháp lý:** điều khoản dịch vụ của Vercel quy định gói Hobby dành cho **mục đích phi thương mại**. Portal nội bộ phục vụ hoạt động kinh doanh không thuộc phạm vi này. Duy trì trên gói miễn phí là rủi ro bị khóa tài khoản.

### 7.2. Tối ưu code — nên làm, nhưng không phải vì tiền

Cần nói thẳng: **hiện tại tối ưu code không tiết kiệm được đồng nào.**

Lý do: mức usage ($3.20 CPU) đang nằm sâu dưới trần tín dụng $20, mà tín dụng thì không cộng dồn. Giảm CPU từ $3.20 xuống $1.70 thì hóa đơn vẫn đúng $20. Khoản tiết kiệm chỉ bắt đầu có thật khi tổng usage vượt $20/tháng — còn rất xa.

Vì vậy **không nên trình bày việc sửa code như một biện pháp cắt giảm chi phí.**

Lý do thật sự đáng làm:

| Lý do | Giải thích |
|---|---|
| **Tốc độ sử dụng** | Mỗi lần agent chuyển trang đều kích hoạt một truy vấn phân quyền lồng 3 tầng qua middleware. Đây là độ trễ mà 50 người cảm nhận được mỗi ngày, không phải con số trên hóa đơn. |
| **Dư địa tăng trưởng** | Nếu số agent tăng, chi phí và độ trễ tăng tuyến tính theo. Sửa bây giờ rẻ hơn sửa sau. |
| **Đúng chuẩn thư viện** | Cách tách file ở mục 4.3 là khuyến nghị chính thức của NextAuth v5. Đang làm sai chuẩn. |

### 7.3. Thứ tự triển khai đề xuất

Sắp theo rủi ro tăng dần:

| Bước | Nội dung | Rủi ro | Ghi chú |
|---|---|---|---|
| 1 | Chuyển `bcrypt.hashSync` thành khởi tạo lười (lazy) | **Thấp** | Không đổi hành vi, giữ nguyên tính năng chống timing attack |
| 2 | Tách `auth.config.ts` nhẹ cho middleware | **Trung bình** | Theo đúng tài liệu NextAuth v5, cần test kỹ luồng đăng nhập |
| 3 | Cache kết quả phân quyền trong token, đặt thời hạn 5–10 phút | **Cao** | Đụng trực tiếp logic phân quyền. Đánh đổi: thay đổi quyền của user sẽ có độ trễ tối đa 5–10 phút mới có hiệu lực |

**Đề xuất:** làm bước 1 và 2 trước, đo lại số liệu sau 3–5 ngày, rồi mới quyết định có làm bước 3 hay không. Bước 3 có đánh đổi về nghiệp vụ nên cần thống nhất trước khi triển khai.

### 7.4. Việc cần làm ngay (không cần duyệt)

- [ ] Đo **Provisioned Memory** để có bức tranh chi phí đầy đủ
- [ ] Vào Observability xác định route tốn CPU nhất trong nhóm `function`
- [ ] Bật cảnh báo chi tiêu (spend management) ở ngưỡng phù hợp — mặc định Vercel đặt ở $200/kỳ, nên hạ xuống thấp hơn nhiều

---

## 8. Tóm tắt cho người duyệt

| Câu hỏi | Trả lời |
|---|---|
| Có nguy cơ gián đoạn dịch vụ không? | **Không còn.** Đã nâng cấp Pro trong ngày, loại bỏ nguy cơ bị pause. |
| Chi phí hàng tháng là bao nhiêu? | **$20** phí nền tảng. Phần Active CPU (~$3.20) nằm trọn trong tín dụng $20 đã bao gồm. |
| Có phát sinh thêm không? | Ở mức dùng hiện tại thì không. Cần tăng ~6 lần lưu lượng mới bắt đầu vượt. |
| Có bắt buộc phải nâng cấp không? | **Có** — vượt hạn mức miễn phí 5 lần, đồng thời gói miễn phí không cho phép dùng cho mục đích thương mại. |
| Có cần sửa code không? | Nên, nhưng **không tiết kiệm được tiền** ở mức dùng hiện tại (hóa đơn là $20 dù usage $3 hay $12). Giá trị thật nằm ở tốc độ sử dụng cho 50 agent và dư địa mở rộng. |
| Còn ẩn số nào không? | Có — chưa đo Provisioned Memory, khoản này có thể lớn hơn Active CPU. Sẽ bổ sung sau khi đo. |

---

## Phụ lục: Nguồn tham chiếu

- Bảng giá Vercel: https://vercel.com/docs/pricing
- Giá Fluid compute theo khu vực: https://vercel.com/docs/functions/usage-and-pricing
- Chi tiết gói Pro và cơ chế tín dụng: https://vercel.com/docs/plans/pro-plan
- Giá khu vực Singapore (sin1): https://vercel.com/docs/pricing/regional-pricing/sin1

Số liệu sử dụng lấy từ Vercel Dashboard → Usage → Fluid Active CPU, kỳ 19–21/08/2026.
