# Enrollment: tạo hồ sơ kèm file rồi sửa ngay → mất phần vừa sửa

Ngày: 2026-09-30. Áp dụng cho cả 3 màn Enrollment (ACA / Medicare / Medicaid) —
cùng dùng `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`.

## Báo cáo

Cheryl (`cheryl.tocs@epsins.co`, role `agent`) tạo deal trong Health Obamacare
Enrollment, hệ thống hiện dòng bảo reload, reload xong thì "mất deal".

## Bằng chứng (đọc DB production, chỉ SELECT)

- Hồ sơ **không mất**. Hôm nay Cheryl tạo 3 hồ sơ ACA, cả 3 còn trong DB, không
  archive: `aca-1292` (15:47 UTC), `aca-1293` (15:51), `aca-1294` (15:59).
- Chạy lại đúng bộ lọc phạm vi của Cheryl (`applyEnrollmentScope`,
  `src/lib/enrollment/scope.ts:112`) → trả về cả 4 hồ sơ của cô ấy. Phạm vi có
  tính `created_by_email`, nên reload vẫn thấy hồ sơ.
- Dòng thời gian `aca-1294` (record `7d130901…`):
  `created` + `attachment_added` 15:59 → `field_changed` 16:00 → `stage_changed` 16:01.
  Tức là: tạo **kèm file**, rồi sửa ngay sau đó.
- Không có thay đổi cấu hình nào (table_column, table_column_option,
  enrollment_options, enrollment_option_sets, task_agents, agent_members) trong
  14:30–17:00 UTC → banner "Table configuration changed" khó là nguyên nhân lần này.

## Nguyên nhân (đã lần theo code)

1. **Tạo hồ sơ** — `createRecord` (`EnrollmentClient.tsx:1644`) chèn bản ghi server
   trả về vào danh sách, mang `updated_at = T0`:
   ```ts
   updateRecords((current) => [data.record!, ...current]);          // :1671
   ...
   const failedFiles = await uploadEnrollmentFiles(data.record.id, pendingFiles); // :1674
   ```
2. **Upload file lúc tạo** đi qua `POST /api/enrollment/[id]/attachments`, route này
   gọi `enrollment_touch_activity` (`src/app/api/enrollment/[id]/attachments/route.ts:279`),
   hàm SQL này **đẩy `updated_at` lên T1** (`supabase/schema.sql:5432`):
   ```sql
   v_updated_at := greatest(clock_timestamp(), v_updated_at + interval '1 microsecond');
   update enrollment_records set updated_at = v_updated_at, ...
   ```
   Route trả `record: null` và ghi chú "parent record is reconciled by the room
   broadcast/cache reload" (`route.ts:329-338`).
3. **Nhưng tab của chính người tạo bỏ qua mọi tín hiệu do nó tự phát:**
   ```ts
   // src/lib/enrollment/live-sync.ts:26
   if (invalidation.origin === "document" && invalidation.sourceId === ownSourceId) return null;
   // :36
   if (sourceId === ownSourceId) return null;
   ```
   `uploadEnrollmentFiles` cũng chỉ trả tên file lỗi, không đọc lại hồ sơ
   (`EnrollmentClient.tsx:1619-1642`). → dòng trong danh sách **kẹt ở T0**.
   Mở drawer không làm mới dòng này (không có chỗ nào set lại `recordRowsRef` từ detail).
4. **Sửa lần đầu** — `patchRecord` gửi `expected_updated_at: state.confirmed.updated_at`
   (= T0, `EnrollmentClient.tsx:1576`). Server so với T1 → **409**
   (`src/app/api/enrollment/[id]/route.ts:156-161`).
5. **Client xử lý 409 bằng cách BỎ lượt sửa** (`EnrollmentClient.tsx:1587-1594`):
   ```ts
   if (response.status === 409) {
     const canonical = await fetchCanonicalRecord(id);
     if (canonical) {
       state.confirmed = canonical;
       setError("Enrollment record changed elsewhere; canonical data was reloaded.");
   ```
   Dòng quay về bản server (không có phần vừa sửa), kèm câu có chữ "reloaded".
   Người dùng đọc thành "hãy reload", reload trang, và phần vừa sửa không còn → "mất deal".
   Sửa lại lần hai thì được (vì `confirmed` đã là T1) — khớp `field_changed 16:00`,
   `stage_changed 16:01` của `aca-1294`.

Chỉ xảy ra khi **tạo hồ sơ có đính kèm file ở form tạo mới**. Upload trong drawer đi
qua `CommentThread` → `onReload={reloadDetailAndParent}` (`EnrollmentClient.tsx:4031`)
nên có tải lại hồ sơ cha, không dính. Comment đã có `applyParentUpdatedAt` (`:1752`).

## Rủi ro liên quan (cùng triệu chứng "reload rồi mất")

- **Banner cấu hình** (`EnrollmentClient.tsx:1788-1795`): "Table configuration
  changed. Reload before editing enrollments." hiện với MỌI người khi admin đổi bất
  kỳ cột / option / option set / agent / assistant nào (các route gọi
  `broadcastTableConfigChanged` / `broadcastTableConfigInvalidation`). Banner không
  chặn lưu, nhưng nếu đang điền form New enrollment mà bấm Reload thì mất sạch
  form chưa lưu. Không phải nguyên nhân lần này, nhưng cùng loại hậu quả.

## Plan fix

### Task 1 — Đồng bộ lại hồ sơ vừa tạo sau khi upload file (sửa gốc)

`EnrollmentClient.tsx`, trong `createRecord`, sau `uploadEnrollmentFiles`:

```ts
if (pendingFiles.length > 0) {
  const failedFiles = await uploadEnrollmentFiles(data.record.id, pendingFiles);
  // Upload đẩy updated_at lên (enrollment_touch_activity) mà tab này bỏ qua
  // tín hiệu của chính nó — đọc lại bản thật, nếu không lượt sửa đầu sẽ 409.
  const canonical = await fetchCanonicalRecord(data.record.id);
  if (canonical) {
    recordRowsRef.current.set(canonical.id, canonical);
    updateRecords((rows) => rows.map((row) => (row.id === canonical.id ? canonical : row)));
  }
  ...
}
```
Không cần đổi SQL hay route. (Phương án khác: route attachments trả `updated_at`
sau touch — cần đổi `enrollment_touch_activity` trả về timestamp → có rollout SQL;
không đáng cho lỗi này.)

### Task 2 — 409 do "chỉ đổi mốc giờ" thì tự gửi lại, không bỏ lượt sửa

Lưới an toàn cho mọi nguồn đẩy `updated_at` khác (touch từ file, reaction...). Thêm
hàm thuần vào `src/lib/enrollment/optimistic-patch.ts` (có test):

```ts
/** Gửi lại được khi KHÔNG trường nào trong patch bị người khác đổi. */
export function canRetryAfterConflict(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,   // state.confirmed lúc gửi
  canonical: Record<string, unknown>, // bản server sau 409
): boolean
```
So từng trường người dùng sửa; `custom_values` so từng khoá con. Cần xét thêm các
cột server tự cập nhật: đổi `stage_id` còn có thể đổi `closed_at` và xoá trạng
thái QC; đổi QC cần stage chưa thay đổi; đổi `carrier_ids` còn ghi `carrier_id`.
Nếu thiếu một trường trên một trong hai snapshot thì không tự retry vì không đủ
dữ liệu để kết luận. Trong `patchRecord`, khi 409: nếu `canRetryAfterConflict`
cho phép → gửi lại MỘT lần với `canonical.updated_at`; nếu vẫn 409 hoặc có trường
liên quan bị đổi → giữ dữ liệu mới nhất và báo người dùng thao tác chưa được lưu.

### Task 3 — Đổi câu báo lỗi cho khỏi xúi reload

`EnrollmentClient.tsx:1592`: thay "canonical data was reloaded" bằng câu nói rõ lượt
sửa chưa lưu và KHÔNG cần reload, ví dụ: "Someone else changed this record, so your
last change was not saved. The latest data is shown — please make the change again."

### Task 4 — Banner cấu hình không làm mất form đang điền

`EnrollmentClient.tsx:1788`: khi `creating === true` (form New enrollment đang mở),
đổi câu thành "Table configuration changed. Finish or cancel this enrollment, then
reload." và ẩn nút Reload cho tới khi đóng form. Ngoài ra thêm
`beforeunload` cảnh báo khi form tạo có dữ liệu chưa lưu.

## Kiểm chứng

- Test thuần cho `canRetryAfterConflict` (trường không trùng → true; trường trùng →
  false; `custom_values` khoá khác nhau → true; cùng khoá → false; cột phụ của
  stage/QC/Carrier thay đổi → không retry).
- Kiểm tay trên cả ACA, Medicare, Medicaid: tạo hồ sơ **kèm 1 file**, đổi stage ngay
  → phải lưu được, không có banner lỗi, reload vẫn còn stage mới.
- Hai tab cùng người: tab A sửa field X, tab B (còn mốc cũ) sửa field Y → B tự gửi
  lại thành công; sửa CÙNG field X → B vẫn báo xung đột.
- Ghi `changelog.md`. Không có rollout SQL.
