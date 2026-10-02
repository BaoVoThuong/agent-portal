# Enrollment — Checklist go-live + danh sách bug (review code 2026-10-02)

Phạm vi: Health ACA, Health Medicare và Health Medicaid Enrollment. Cả ba dùng chung
`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, các route `src/app/api/enrollment/**`,
`src/lib/enrollment/**` và cron `src/app/api/cron/check-enrollment-due/route.ts`.

Code tại thời điểm review là `f5b8a90`, trùng với `vercel/main`. Bản này đã có bản sửa lỗi Cheryl
(tạo hồ sơ rồi sửa ngay thì 409) và việc gửi thông báo stage cho task manager.

Số liệu production đọc lúc review (chỉ SELECT):

| | ACA | Medicare | Medicaid | Tổng |
|---|---|---|---|---|
| Hồ sơ đang hoạt động | 150 | 47 | 4 | 201 |

- Có 267 comment, 181 file đính kèm, 1.004 dòng activity.
- 171/201 hồ sơ **chưa có Responsible**, 178/201 hồ sơ **chưa có Due date**.
- 9 người đang có quyền `task.manage`.
- `enrollment_notifications` loại `record_created` có **0 dòng**, kể từ trước tới giờ.

Mức ưu tiên:
- **P0**: phải xong trước go-live.
- **P1**: nên sửa trước go-live. Mỗi lỗi nhỏ, rủi ro thấp.
- **P2**: sửa sau go-live, hoặc theo dõi.

---

## A. Việc vận hành phải làm trước go-live (P0)

- [x] **A1. Xác nhận rollout `supabase/rollouts/2026-09-30-enrollment-created-notifications.sql` đã chạy trên production.**
  - 2026-10-02: đã chạy trên production. Đã kiểm bằng `aca-1327` (tạo lúc 05:31 UTC): 8 task manager nhận
    `record_created`. Đủ 9 người trừ người tạo.
  - Kiểm tra bằng:
    `select pg_get_constraintdef(oid) from pg_constraint where conname = 'enrollment_notifications_type_check';`
    Kết quả phải có `'record_created'`.
  - Vì sao là P0: lúc tạo hồ sơ, route gộp thông báo `assigned` (Caller/Responsible) và `record_created`
    (9 task manager) vào **một lệnh insert** (`src/app/api/enrollment/route.ts:353-363`).
    Nếu CHECK cũ còn, Postgres từ chối cả lô. Kết quả: tạo hồ sơ xong **không ai nhận thông báo nào**,
    kể cả người được giao.
  - Hiện chưa có hồ sơ nào được tạo kể từ khi code mới lên. Vì vậy chưa có bằng chứng về lỗi, nhưng cũng
    chưa có bằng chứng nó chạy được.
- [ ] **A2. Chốt dữ liệu bắt buộc.** 85% hồ sơ thiếu Responsible, 89% thiếu Due date. Hậu quả:
  - Thông báo due soon / overdue / reminder chỉ gửi cho Caller và Responsible
    (`check-enrollment-due/route.ts:203-221`), nên phần lớn hồ sơ quá hạn **không báo cho ai**.
  - Bộ lọc "Needs attention" gắn cờ gần như toàn bộ hồ sơ.
  - Cần quyết định: bật `required` cho Responsible và Due trong /config, hay bổ sung dữ liệu trước ngày go-live.
- [ ] **A3. Rà người có quyền `task.import`.** Import có thể ghi đè **bất kỳ** hồ sơ nào trong program
  theo ID, không xét phạm vi agent và không ghi activity (xem B3). Chỉ nên để quản lý giữ quyền này.
- [ ] **A4. Không đổi cờ Terminal/QC của stage đang có hồ sơ trong tuần go-live.** Xem C6.
- [ ] **A5. Báo trước cho đội** (đã sửa trong code, nhưng người dùng nên biết):
  - Gặp thông báo vàng "Table configuration changed" thì lưu hoặc huỷ form đang mở rồi mới Reload.
  - Gặp toast "Someone else changed this record…" thì **không cần reload trang**, chỉ cần làm lại thao tác vừa rồi.

## B. Bug nên sửa trước go-live (P1)

### B1. Đổi stage từ ô Stage khi hồ sơ đang đóng → giao diện nhảy rồi bật lại, hiện lỗi đỏ
- Ở đâu: ô Stage trong bảng (`EnrollmentClient.tsx:2678-2683`) và trong drawer (`:4301`). Cả hai cho chọn
  mọi stage, rồi gửi `{ stage_id }` **không có `reopen_reason`**.
- Server bắt buộc lý do khi rời stage terminal, nên trả 400
  "Reopen reason is required when leaving a terminal stage." (`api/enrollment/[id]/route.ts:247-255`).
- Ảnh hưởng cả 3 program. Các stage terminal là:
  - ACA: 10-ID card done, 11-ID card unavailable, 12-Terminated.
  - Medicare: 9-ID card done, 11-Terminated.
  - Medicaid: Approved, Denied, Cancelled, Expired.
- Cách sửa: khi stage hiện tại là terminal mà stage mới không terminal, mở hộp "Reopen reason" (đã có
  sẵn cho nút Reopen, `:4095-4109`) rồi gửi kèm lý do. Hoặc trong bảng thì khoá ô Stage và ghi chú
  "Reopen trong chi tiết".

### B2. Tạo hồ sơ xong không chỉ ra hồ sơ vừa tạo → người dùng tưởng "mất deal"
- `createRecord` (`EnrollmentClient.tsx:1663-1722`) chỉ chèn dòng mới vào danh sách rồi đóng form.
  Hồ sơ mới có thể không hiện ra vì hai lý do:
  - **Bị bộ lọc đã lưu che đi.** Bộ lọc được lưu trong localStorage và tự khôi phục sau reload
    (`:802-838`). Ví dụ: đang lọc Stage, Year, Created date, Attention…
  - **Nằm lẫn giữa danh sách.** Sắp xếp mặc định là "attention desc" (`:851-854`) và giữ thứ tự cố định
    (`applyFrozenOrder`). Hồ sơ đã điền đủ có điểm 0, nên rơi xuống dưới mọi hồ sơ cần chú ý.
- Cùng triệu chứng với báo cáo của Cheryl. Reload trang vẫn không thấy, vì bộ lọc vẫn còn.
- Cách sửa: tạo xong thì **mở luôn drawer của hồ sơ mới** (`openRecordById(data.record.id)`). Nếu hồ sơ
  không khớp bộ lọc, hiện toast "ACA-1327 created — hidden by current filters" kèm nút "Clear filters".

### B3. Import ghi thẳng vào bảng, bỏ qua toàn bộ quy tắc nghiệp vụ
`src/app/api/enrollment/import/route.ts`:
- **Đường cập nhật** (`:236-258`) dùng `.update()` thẳng, không qua `patch_enrollment_atomic`:
  - Đổi Stage sang terminal **không set `closed_at`** và không xoá trạng thái QC.
  - Không cập nhật `stage_entered_at`, không ghi `enrollment_stage_cycles` hay `stage_history`.
    Overview và thời gian ở stage sai.
  - Không ghi activity: dòng thời gian không biết ai đổi gì.
  - Đổi Due date **không reset** `due_soon_notified_at` / `overdue_notified_at`, nên cron không bao giờ
    báo lại theo hạn mới.
  - Không lọc `archived_at`, nên sửa được cả hồ sơ đã archive.
- **Đường tạo mới** (`:260-265`): Stage terminal **không set `closed_at`**, khác với màn hình tạo
  (`api/enrollment/route.ts:311-318`). Hồ sơ đã xong bị coi là đang mở và vẫn nhận cảnh báo overdue.
- **Hiệu năng**: mỗi dòng gọi tuần tự `fetchWriteValidationContext` (RPC) và `validateEnrollmentOwnership`
  (đọc **toàn bộ** `portal_account` và `task_agents`), cộng một lần đọc `custom_values`. File 1.000 dòng
  thành vài nghìn truy vấn nối tiếp, rất dễ quá thời gian chạy của Vercel function.
- Cách sửa:
  - Tối thiểu cho go-live: khi tạo có stage terminal thì set `closed_at`; khi đổi `due_date` thì reset
    các cờ thông báo; lọc `archived_at`; tải ownership và write-context **một lần** cho cả file.
  - Đầy đủ: cập nhật qua `patch_enrollment_atomic`, để có cả activity và stage cycles.
  - Nếu không kịp sửa: **không dùng Import để đổi Stage/Due** trong tuần go-live.

### B4. Hai câu báo lỗi còn xúi người dùng reload
- Archive bị 409: "Enrollment record changed elsewhere; it was restored with canonical data."
  (`EnrollmentClient.tsx:1761-1765`). Đổi thành câu nói rõ chưa archive được và chỉ cần bấm lại.
  Upload file hay reaction cũng đẩy `updated_at` lên, nên archive bị 409 oan khá dễ.
- `submitReopen` (`:4100-4109`) luôn trả `true`, vì `patchRecord` tự nuốt lỗi. Reopen thất bại thì hộp lý do
  vẫn đóng như thể đã thành công. Sửa: `patchRecord` trả ok/failed, và chỉ đóng hộp khi ok.

### B5. Banner "Table configuration changed" bật lên quá nhiều
- Mọi thao tác sửa option (đổi màu, đổi thứ tự, thêm, archive) đều gọi `broadcastTableConfigInvalidation()`
  (`api/enrollment/option-sets/[id]/route.ts:115-118, 179-182`). **Mọi người** đang mở Enrollment đều thấy
  banner vàng bảo reload (`EnrollmentClient.tsx:1481-1491, 1822-1837`).
- Danh sách option vốn đã tự nạp lại qua tín hiệu "full" (`:1385`), nên banner là thừa với thay đổi option.
  Nó chỉ khiến người dùng reload giữa lúc đang làm.
- Cách sửa: chỉ phát tín hiệu cấu hình bảng khi **cột** thay đổi. Thay đổi option thì chỉ cần
  `broadcastEnrollmentChanged()`.

## C. Logic thông báo và nghiệp vụ (P1/P2, cần chốt với bên vận hành)

- **C1. Agent không nhận thông báo Enrollment nào.**
  - Các nhóm người nhận hiện tại:
    - Tạo hồ sơ: Caller/Responsible nhận `assigned`, task manager nhận `record_created`.
    - Comment: Caller/Responsible và những người đã comment.
    - Due/overdue: Caller/Responsible.
    - QC: Caller/Responsible và admin.
  - Người có `agent_email` của hồ sơ không có mặt ở nhóm nào. Cần chốt có thêm agent hay không.
- **C2. Overdue reminder bị lỡ ngày.** Cron chạy mỗi ngày lúc 03:00 UTC, nhưng chỉ nhắc khi lần nhắc trước
  đã cách ≥ 24 giờ (`check-enrollment-due/route.ts:43,84`). Lần chạy hôm sau sớm hơn vài mili-giây là bỏ qua
  một ngày. Sửa: so theo ngày, hoặc dùng cutoff 23 giờ.
- **C3. Cron tính ngày theo UTC** (`:41-42,223-225`). 03:00 UTC là 22:00 giờ Texas của hôm trước, nên hồ sơ
  hạn hôm nay (giờ Texas) bị gắn overdue sớm khoảng 2 giờ. Due soon cũng lệch một ngày. Sửa: tính `today`
  theo `America/Chicago`.
- **C4. Thông báo "stage_changed" dò theo tên stage** (`api/enrollment/[id]/route.ts:93-97`, gồm
  "5-ready to enroll", "11-terminated", "12-terminated"):
  - **Medicaid không có stage nào khớp**, nên không bao giờ có thông báo này.
  - ACA "12-Terminated" có `triggers_qc = true`, nên rơi vào nhánh `qc_needed` và không gửi
    `stage_changed` (`:544-597`).
  - Cần chốt danh sách stage quan trọng cho từng program. Tốt nhất là thêm một cờ trên option thay vì
    dò theo tên.
- **C5. Cron ghi `updated_by_email = 'system'`** (`check-enrollment-due/route.ts:108-166`). Cột
  "Updated by" hiện "system" và che mất người sửa thật gần nhất. Cron cũng không kiểm lỗi update/insert,
  và vẫn gửi thông báo khi điều kiện `.is(..., null)` không khớp. Chạy cron hai lần (tay + lịch) là gửi trùng.
- **C6. Admin đổi cờ Terminal của stage không cập nhật hồ sơ đang ở stage đó**
  (`option-sets/[id]/route.ts:89-90`). Hồ sơ vẫn giữ `closed_at` cũ, nên mở/đóng sai và Overview sai.
- **C7. Xoá file đính kèm không ghi activity** (`api/enrollment/[id]/attachments/[aid]/route.ts`), trong khi
  thêm file thì có ghi `attachment_added`.

## D. Tải dữ liệu chưa tối ưu (P2, theo dõi khi ACA vào mùa OE)

- **D1. Mỗi lần nạp danh sách là nạp toàn bộ program, kèm nội dung MỌI comment.**
  - `fetchEnrollmentRecords` (`src/lib/enrollment/queries.ts:156-230`) gồm: toàn bộ hồ sơ, rồi
    `enrollment_comments.body` của tất cả hồ sơ (để tìm kiếm), rồi từng dòng attachment để đếm.
    Chia theo nhóm 50 id, mỗi nhóm 2 request.
  - Một lần GET khoảng: auth + 3 truy vấn scope + 1 records + 2×⌈N/50⌉ truy vấn con.
  - Mỗi tab đang mở gọi lại toàn bộ khi:
    - mỗi 60 giây (15 giây khi realtime rớt, `EnrollmentClient.tsx:1471-1479`);
    - mỗi lần focus hoặc chuyển tab về (`:1441-1469`);
    - **mỗi lần bất kỳ ai sửa bất kỳ hồ sơ nào** trong program (`:1371-1426`).
  - 20 tab mở cùng lúc thì một lượt sửa thành 20 lượt nạp toàn bộ danh sách.
  - Hướng sửa:
    - (a) đếm comment/attachment và gộp text tìm kiếm bằng một view/RPC duy nhất;
    - (b) tín hiệu realtime mang theo `recordId`, tab nhận chỉ nạp lại **một** hồ sơ qua `GET /api/enrollment/[id]`;
    - (c) khi realtime đang "live" thì giãn poll ra 5 phút.
- **D2. Giới hạn cứng 1.000 dòng** (max-rows mặc định của PostgREST):
  - Program nào vượt 1.000 hồ sơ đang mở thì `assertEnrollmentRecordsComplete` ném lỗi. `page.tsx` không
    bắt lỗi này nên **cả trang Enrollment sập**. ACA hiện có 150 hồ sơ, an toàn.
  - Cron đọc mọi hồ sơ của **cả 3 program** không phân trang (`check-enrollment-due/route.ts:54-59`). Quá
    1.000 dòng là **cắt lặng lẽ**, phần dư không được nhắc hạn. Tổng hiện tại là 201.
  - Cần phân trang trước khi chạm khoảng 800 dòng.
- **D3. PATCH khoảng 8 vòng truy vấn nối tiếp** (`api/enrollment/[id]/route.ts`):
  auth → scope và đọc hồ sơ → `isAgentOwnerOrAssistant` → options → RPC write-context →
  ownership (đọc cả hai bảng) → RPC patch → thông báo (stage quan trọng thêm 4 truy vấn task manager)
  → đọc lại hồ sơ (3 truy vấn).
  - Các bước không phụ thuộc nhau có thể chạy song song (`isAgentOwner`, options, write-context). Phần đọc
    lại cuối có thể dùng dòng RPC trả về cộng count có sẵn.
- **D4. Drawer đang mở** tự nạp lại chi tiết mỗi 60 giây (`EnrollmentClient.tsx:3996-4003`). Mỗi lần ký lại
  URL cho mọi file, gọi RPC reactions và đọc 250 dòng activity, kể cả khi realtime vẫn đang "live".
- **D5. Cron**: `Promise.all` không giới hạn song song, và mỗi hồ sơ QC-stale lại gọi `fetchAdminEmails()` một lần.
- **D6. `page.tsx`** gọi `fetchAssistantAgentsForCs` hai lần (một lần trong scope, một lần riêng).

## E. Nghi vấn — chưa gây lỗi, nhưng nên biết

- **E1.** Tạo hồ sơ không có khoá chống trùng (comment và file thì có `client_request_id`). Nếu mạng rớt sau khi
  server đã ghi mà người dùng bấm Create lần nữa, sẽ ra **hồ sơ trùng**.
- **E2.** PATCH kiểm tra "option đã archive" **trước** khi kiểm tra "có đổi không"
  (`api/enrollment/[id]/route.ts:204`). Gửi lại đúng giá trị cũ là một option đã archive thì bị 400.
  Carrier đã có ngoại lệ; Stage, Platform, Consent, Payment và ACA thì chưa. Hiện có 0 hồ sơ nằm trên
  stage đã archive.
- **E3.** Admin đặt một cột hệ thống là Required **nhưng** ẩn mặc định. Form tạo sẽ đòi trường đó mà không
  hiện ô nhập (`EnrollmentClient.tsx:4758-4759, 4816`), nên không tạo được hồ sơ.
- **E4.** Export bỏ các cột `hidden_default`, kể cả khi người dùng đã tự bật hiện cột đó
  (`api/enrollment/export/route.ts:121-123`).
- **E5.** Sửa hoặc xoá comment và xoá file chỉ phát tín hiệu realtime cho drawer, không cho danh sách. Tab khác
  thấy số comment/file và `updated_at` cũ tới lần poll sau (tối đa 60 giây). Từ `6da7ee0`, PATCH đã tự
  gửi lại khi bị 409, nên không mất dữ liệu.
- **E6.** So email phân biệt hoa/thường ở `isAgentOwnerOrAssistant` (`src/lib/tasks/membership.ts:127`) và ở
  bộ lọc mention khi tạo comment. Hiện mọi email trong DB đều viết thường, nên lỗi chưa xảy ra.
- **E7.** PATCH có `custom_values` luôn ghi `field_changed`, kể cả khi giá trị không đổi.

## F. Kịch bản kiểm tay trước go-live

Làm trên **cả 3 program**, trừ khi ghi riêng. Dùng ít nhất 3 tài khoản:
- một quản lý;
- một agent, có assistant;
- một CS thường.

**Tạo và sửa**
- [ ] Tạo hồ sơ đủ trường, kèm 1 file. Hồ sơ hiện ra, sửa Stage ngay, không có lỗi, reload vẫn còn.
  *(lỗi Cheryl, đã sửa ở `6da7ee0`)*
- [ ] Tạo hồ sơ khi đang bật bộ lọc. Có biết hồ sơ mới nằm đâu không? *(B2)*
- [ ] ACA và Medicare: chọn nhiều Carrier. Danh sách hiện "hãng đầu +N"; lọc theo Carrier; Export ra
  "A, B"; Import lại giữ đủ hãng.
- [ ] Medicaid: form tạo, drawer và bảng **không** có Caller, Carrier, PCP, Platform, Consent, Payment hay
  ACA status. Stage mặc định đúng stage đầu theo thứ tự trong /config.
- [ ] Medicare: nhãn Assignee/PCP đúng; không có Caller.

**Stage, QC, đóng/mở lại**
- [ ] Chuyển sang stage terminal có QC (ACA 10-ID card done, Medicare 9-ID card done, Medicaid Approved).
  Hồ sơ đóng, hiện "QC needed", Caller/Responsible và admin nhận `qc_needed`.
- [ ] Agent owner bấm QC check được. Caller hoặc Responsible **không** bấm được.
- [ ] Mở lại bằng nút Reopen trong drawer (nhập lý do): được. Mở lại bằng ô Stage: *(B1)*.

**Hai người cùng sửa**
- [ ] Tab A sửa field X, tab B (chưa tải lại) sửa field Y. B lưu được, không có thông báo lỗi.
- [ ] Hai tab cùng sửa field X. Tab sau nhận câu "Someone else changed this record…", dữ liệu hiện bản
  mới nhất, không cần reload.
- [ ] Archive khi tab khác vừa thêm file. *(B4)*

**Phạm vi và quyền**
- [ ] Agent A không thấy hồ sơ của agent B. Mở link `?record=<id của B>` cũng không hiện gì.
- [ ] Assistant thấy hồ sơ của agent mình phụ trách. CS thường thấy toàn bộ và mặc định lọc "của tôi".
- [ ] Caller đổi được Stage nhưng không sửa được Client name/FUB. Người tạo sửa được nội dung.
  Chỉ owner (agent hoặc assistant) và quản lý mới archive được.

**Comment, file, thông báo**
- [ ] Comment có @mention: người được nhắc nhận `mentioned`, những người khác trong luồng nhận `commented`.
- [ ] File 3MB lên được. File 5MB báo "File is too large (max 4MB)…".
- [ ] Tạo hồ sơ thì 9 task manager nhận `record_created` *(cần A1)*, Caller/Responsible nhận `assigned`.
- [ ] Chuyển sang stage quan trọng ("5-Ready to Enroll", "11/12-Terminated"): task manager và
  Caller/Responsible nhận thông báo *(Medicaid: xem C4)*.
- [ ] Đặt Due date = ngày mai. Sáng hôm sau (sau 03:00 UTC) có `due_soon`.

**Export / Import / cấu hình**
- [ ] Export đúng các cột đang hiện, đúng các dòng đang lọc. Import lại file đó thì số dòng cập nhật đúng,
  không tạo trùng.
- [ ] Import một file có đổi Stage/Due. *(B3: kiểm tra `closed_at`, activity và thông báo)*
- [ ] Admin đổi màu một option khi người khác đang mở form tạo hồ sơ. *(B5: form không mất)*

## G. Thứ tự đề xuất

1. **A1 → A5**: vận hành, không cần code.
2. **B1, B2, B4**: sửa nhỏ, chỉ ở client, mỗi lỗi chưa tới nửa ngày.
3. **B5, B3 bản tối thiểu**: ở server. Không kịp B3 thì cấm Import đổi Stage/Due.
4. **C1–C4**: chốt với vận hành rồi mới sửa.
5. **D, E**: sau go-live. Theo dõi D2 khi ACA vào mùa OE.
