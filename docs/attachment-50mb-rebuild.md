# Upload 50 MiB: bản xây lại trên nhánh dev

**Trạng thái 2026-10-22:** mã và migration chỉ ở `dev/attachment-50mb-rebuild`. Chưa áp dụng migration này, chưa đổi bucket, chưa triển khai production. `main` đang ở commit rollback `c82a07d`, giới hạn 4 MiB. Đọc production cho thấy bucket `task-attachments` hiện giới hạn 4,194,304 byte.

## Sự cố và bài học

1. Vercel Function giới hạn request body 4.5 MB. Nâng hằng số ở API multipart không thể làm web nhận 50 MiB. File phải đi thẳng từ browser tới Storage.
2. Lượt trước dùng `uploadToSignedUrl` một lần cho cả file. Có trường hợp Storage ghi object nhưng promise trong browser không kết thúc. `finalize` không chạy; DB không có attachment row. Ảnh blob tạm nhìn đúng tới khi tải lại rồi mất.
3. Retry/poll/sessionStorage đều lệ thuộc mã đang chạy trong tab. Tab cũ hoặc tab đã đóng không thể hoàn tất liên kết. Lần trước server không lưu comment ID theo object, nên các object mồ côi cũ không thể gắn lại một cách chắc chắn.
4. Comment chỉ có file từng bị tự xóa khi upload trả lỗi không rõ. Nếu object đến muộn, không còn comment để gắn ảnh.
5. Cấu hình bucket được cập nhật trong request theo hằng số của từng bản deploy. Bản cũ giới hạn 4 MiB có thể chạy song song và hạ bucket khi bản mới cần 50 MiB.

## Thiết kế trên nhánh

`prepare` kiểm quyền và giới hạn, rồi ghi `attachment_upload_intents` trước khi cấp token signed cho một path duy nhất. Intent chứa loại record, record ID, comment ID, người gửi, tên file, kích thước, request ID và path. Bảng chỉ service role đọc/ghi. Retry cùng request ID phải khớp nguyên intent; không thể chuyển file sang comment khác.

Browser dùng Supabase TUS endpoint trực tiếp, chunk đúng 6 MiB, không `x-upsert`, có retry và resume theo fingerprint chứa cả path. Token chỉ cấp quyền upload path đã định, không lộ service key. Server đọc kích thước thực tế và 512 byte đầu từ Storage, so kích thước thực tế với File đã chọn, rồi mới ghi metadata. Task và Lead dùng RPC có khóa/giới hạn; Enrollment dùng khóa unique hiện có. `finalize` vẫn idempotent.

Trong lúc gửi, comment hiển thị phần trăm byte đã chuyển. Khi Storage báo đủ bytes nhưng metadata chưa xong, trạng thái đổi sang xác nhận attachment. Điều này tách hai công đoạn mà lần trước bị gộp thành một chữ "Uploading" vô thời hạn.

Mỗi detail read đã qua kiểm quyền sẽ kiểm tra tối đa 12 intent chưa hoàn tất. Nếu object đã tồn tại, server tự xác minh và ghi metadata theo người gửi/comment từ intent, không phụ thuộc tab/browser hiện tại. Nếu object chưa có, dời lần kiểm tiếp theo 15 giây. Từ chối chắc chắn được ghi thành trạng thái lỗi và ngừng retry tự động; nút retry trong tab còn giữ File có thể mở lại cùng intent. Sau reload, trình duyệt không còn bytes của File nên người dùng phải chọn và gửi lại tệp chưa lên xong. Comment hiển thị trạng thái chờ/lỗi và không bị tự xóa.

Bucket chỉ được **đọc để xác nhận cấu hình** trong request. Nếu giới hạn hoặc MIME chưa đúng, prepare trả lỗi rõ ràng. Thay đổi cấu hình Storage là bước rollout có kiểm soát, không phải side effect của traffic.

## Kiểm thử cần hoàn thành trên môi trường staging riêng

Không dùng Supabase production làm nơi thử file 50 MiB. Dựng Vercel preview trỏ tới Supabase staging, áp dụng cả rollout `2026-10-21-attachment-limits-atomic.sql` nếu staging chưa có, sau đó `2026-10-22-attachment-upload-intents.sql`. Cấu hình Storage global limit ít nhất 50 MiB và bucket `task-attachments` là private, giới hạn ít nhất 52,428,800 byte, giữ đủ MIME trong `ATTACHMENT_ALLOWED_MIME_TYPES`.

| Trường hợp | Kết quả cần thấy |
|---|---|
| Task comment ảnh nhỏ, PDF 6 MiB, PDF 49–50 MiB | Upload thành công; reload và tài khoản khác mở cùng task đều thấy file |
| 50 MiB + 1 byte, sai đuôi/chữ ký, MIME không được phép | Từ chối rõ; không có attachment row trỏ vào object sai |
| Mất mạng giữa chunk, nối lại, bấm gửi lại | Cùng request ID/path; một attachment row, file tải được |
| Tắt tab sau khi Storage đã nhận đủ bytes nhưng trước `finalize` | Detail read hoặc tài khoản khác mở trang tự gắn đúng file vào đúng comment |
| Tắt tab giữa upload, Storage chưa có object | Comment còn lại với trạng thái chưa hoàn tất; không hiển thị blob tạm là file đã lưu |
| Hai file 50 MiB đồng thời và chạm trần tổng/số file | RPC từ chối lượt vượt trần, không vượt giới hạn DB |
| Task, Lead, Enrollment, cả file top-level và file trong comment | Cùng một kết quả sau reload; download link dùng được |

Đã chạy unit tests, TypeScript, ESLint và production build trên nhánh. Chưa thể khẳng định tương thích TUS với Storage thật hoặc kiểm tra 50 MiB end-to-end trước khi có staging cách ly.

## Thứ tự triển khai sau khi staging đạt

1. Đưa một thay đổi nhỏ lên `main` để bản 4 MiB ngừng sửa bucket trong request. Chờ log không còn request từ deployment cũ có hành vi hạ bucket. Đây là điều kiện bắt buộc để tránh hai bản giành cấu hình.
2. Áp dụng migration intent trên production. Không chạy nguyên `supabase/schema.sql`.
3. Tăng Storage global limit nếu cần, sau đó đặt bucket 50 MiB và kiểm lại bằng `getBucket`/SQL đọc. Giữ bucket private và MIME như hiện tại.
4. Triển khai nhánh 50 MiB. Kiểm thử canary một Task/Lead/Enrollment, xác nhận đủ ba nơi: Storage object, intent `completed_at`, attachment row; reload từ trình duyệt khác. Theo dõi lỗi `prepare`, TUS, `finalize`, và intent chưa hoàn tất.
5. Nếu cần rollback, ngừng nhận upload mới trước; hoàn tất các intent đã có object bằng bản mới, rồi rollback mã. Chỉ hạ bucket sau khi các upload đang chạy kết thúc. Giữ bảng intent để điều tra, không xóa object/row hàng loạt.

Tài liệu giới hạn: [Vercel Function 4.5 MB](https://vercel.com/docs/functions/limitations), [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [signed upload token](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
