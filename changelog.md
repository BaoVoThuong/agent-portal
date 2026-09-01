# Changelog

Ghi lại **mọi thay đổi LOGIC** của agent-portal: business rule, quyền/RBAC, luồng dữ liệu,
điều kiện, tính toán, schema. **Không** ghi: đổi UI thuần (màu/spacing/copy), rename biến,
format code, thay đổi test đơn thuần.

Mới nhất ở trên cùng. Mỗi thay đổi logic → thêm 1 entry ngay trong lượt code đó.

## 2026-09-01 — Một lead có thể thuộc nhiều product

- **Loại**: schema + logic. Cần chạy `supabase/rollouts/2026-09-03-lead-multi-product.sql`.

### Luật (do user chốt)
> "nó là 1 lead nếu có ai nhận thì cho cả 2 product và chỉ tính cho bên bấm distribute, bên còn lại kh ảnh hưởng queue"

- Vẫn là **một lead, một người nhận**; người đó nhận cho cả hai product.
- Lead nằm trong pool của **mọi** product nó mang.
- Bấm Distribute ở product nào thì **chỉ vòng xoay của product đó** nhúc nhích; con trỏ product còn lại **không bị đụng**.
- Gán xong lead rời khỏi pool của cả hai — vì nó chỉ có một chủ.

### Di trú không đập vỡ 33 chỗ đang đọc `lead.product`
`products text[]` là nguồn sự thật; cột `product` cũ được **trigger** giữ đồng bộ bằng phần tử đầu (thứ tự chuẩn hoá `pc` trước `health`, nên nó không đổi chỉ vì mảng được ghi khác thứ tự). Đổi schema **cùng lúc** với đổi toàn bộ đường đọc là hai rủi ro cộng vào nhau; trigger tách chúng ra. Ghi kiểu cũ (chỉ set `product`) vẫn hợp lệ — trigger suy ngược ra mảng.

### Hoà với thay đổi song song của phiên khác
Giữa lúc làm, một phiên khác đổi `product` thành **nullable** ("chưa phân loại"). Hai mô hình chồng nhau, nên `CHECK` **cho phép mảng rỗng** thay vì bắt buộc ≥1 product: lead chưa phân loại không khớp pool nào nên không bị chia — đúng nghĩa "chưa biết", không phải trạng thái lỗi cần chặn. Import không chọn product thì báo rõ *"Pick a product to auto-assign these leads"* thay vì tự đoán.

### Đã sửa
- `leads.products text[]` + `CHECK` + **index GIN** (đường đọc nóng nhất là "pool của product X").
- RPC đổi đúng một mệnh đề: `l.product = p_product` → `p_product = any(l.products)`. Phần con trỏ **không đụng gì** — nó vốn chỉ ghi `lead_assignment_weights` của `p_product`.
- Truy vấn danh sách lọc bằng `contains("products", [...])` để dùng index; `filterLeads` lọc theo **thành viên mảng**. So bằng cột `product` sẽ **giấu lead đa product khỏi bộ lọc còn lại** — nó có `product = "pc"` nên biến mất khỏi lọc Health.
- Ô Product trong bảng: từ dropdown chọn-một thành **hai nút bật/tắt**, hiện mọi product của lead, nét đứt = chưa mang.
- Overview nạp thêm `products` để tính đúng theo từng lead.

### Kiểm chứng trên PostgreSQL 16 thật
Lead mang `{pc,health}`: hiện trong pool P&C **và** Health · chia từ P&C thì nó **biến khỏi pool Health luôn** · và sau khi chia 3 lead P&C, con trỏ Health vẫn **nguyên 25/-25** — đúng "bên còn lại không ảnh hưởng queue". Rollout chạy lại là no-op, 4 cột `ok`.

- `npm run test:run` 131 files / **962 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Chia pool: tick agent phản hồi tức thì, đổi tab không chờ, có cache

- **Loại**: fix (hiệu năng cảm nhận).

### Tick một agent: 3 vòng mạng và khoá cả bảng → 1 vòng, không khoá
- **Trước**: mỗi cú tick chạy `GET cả danh sách` → `PUT cả danh sách` → `GET lại`, và `savingAgents` **khoá toàn bộ bảng** suốt thời gian đó. Bật năm agent là ngồi chờ năm lượt.
- **Nay**: endpoint mới `PATCH /api/leads/assignment-weights` sửa **đúng một dòng**. Ô tick đổi **ngay** (optimistic), request chạy nền, hỏng thì trả lại kèm lý do. Chỉ **đúng dòng đang lưu** bị khoá, các dòng khác tick tiếp được.
- PATCH **không xoá dòng** khi tắt và không đụng `weight`/`current_weight` — nghỉ phép quay lại vẫn đúng tỉ lệ, đúng vị trí vòng xoay.

### Đổi tab: hết chờ
- Chỉ có hai product, nên nạp **cả hai** (trọng số + pool) **song song ngay lúc mở**. Đổi tab sau đó không tốn request nào. Trước đây mỗi lần bấm tab là một vòng mạng nữa và bảng trắng trong lúc chờ.
- **Draft giữ riêng từng product**: sửa dở bên P&C, sang xem Health, quay lại vẫn còn nguyên.

### Cache
- Cache ở tầng module, sống suốt phiên. Dialog vốn luôn mounted nên state đã sống qua đóng/mở; cache lo phần state không lo được — điều hướng sang trang khác rồi quay lại, hay bất kỳ lần remount nào: mở ra thấy ngay số cũ thay vì bảng trắng, rồi dữ liệu mới đè lên khi request về.
- **Không đặt thời hạn**: mọi đường ghi trong màn này đều cập nhật cache ngay sau khi ghi, và mỗi lần mở đều làm mới nền. Cache tự hết hạn chỉ thêm một trạng thái nữa để sai.

### Sửa kèm
- **Khoá cuộn nền bị rơi mất** khi dựng lại effect ở bước trước — modal này đang không khoá nữa. Đã khôi phục (lint bắt được: `useBodyScrollLock` khai báo mà không dùng).
- Dãy xem trước đổi tên thành **"Lead waiting queue"** và **bỏ dòng đếm** ("Ann 2 · Jennifer 2 · …") — thứ tự đã nói đủ, dòng đếm chỉ lặp lại cùng thông tin.

- **Kiểm chứng**: 131 files / 958 tests; typecheck, lint, build sạch.

## 2026-09-01 — Danh sách agent trong Agent config không cuộn được

- **Loại**: fix (do chính đợt sửa scroll hôm nay gây ra).
- **Nguyên nhân, hai tầng cộng lại:**
  1. Thân modal là một khối **block** có `overflow-y-auto`, không phải flex column. Nên `flex-1 min-h-0` trên khung danh sách **vô tác dụng** — nó cao đúng bằng nội dung, và `overflow-y-auto` của nó **không bao giờ kích hoạt**.
  2. Một phần tử `overflow-y-auto` **không hề tràn** vẫn là một scroll container. Cái `overscroll-contain` tao vừa quét vào nó **chặn cuộn lan** sang thân modal. Kết quả: cuộn trên danh sách thì nó không cuộn được, mà thân cũng không được phép cuộn thay.
- **Sửa**: thân modal thành `flex flex-col` + `overflow-hidden`, mọi con trực tiếp đặt `shrink-0` trừ khung danh sách. Giờ khung danh sách mới thật sự bị chặn chiều cao và **nó** là vùng cuộn duy nhất — header bảng đứng yên, footer đứng yên.
- **Gỡ `overscroll-contain` khỏi 10 file đã quét mù.** Khoá cuộn nền (`useBodyScrollLock`) **đã đủ** cho vấn đề gốc; `overscroll-contain` chỉ là lớp phòng thủ thêm, mà thêm mù thì đúng một cái bẫy này đang nằm ở 7 file khác có `overflow-y-auto` lồng nhau — và repo không test được `.tsx` để biết chỗ nào dính. Chỉ giữ lại ở hai vùng danh sách của dialog Chia pool, nơi đã chắc chắn bị chặn chiều cao thật.

- **Kiểm chứng**: 131 files / 958 tests; typecheck, lint, build sạch.

## 2026-09-01 — Chia pool: dọn lại mô hình, một điều khiển một ý nghĩa

- **Loại**: fix (mô hình sai, sinh ra ba lỗi người dùng gặp).

### Gốc của cả ba lỗi: **ba thứ cùng nói "người này không nhận lead"**
Dòng có tồn tại không · `is_active` · `weight > 0`. Ba cờ, hai màn hình đọc theo hai kiểu khác nhau — nên chúng nói ngược nhau.

### Lỗi 1 — Tab P&C mà nút ghi "Distribute 4" cho 4 lead Health
Nút dùng con số **tổng** của cả pool, và `POST /api/leads/distribute` chia **mọi product** bất kể đang đứng ở tab nào. Bấm ở tab P&C là chia thật số lead Health.
**Sửa**: `fetchPool` nhận product; GET và POST đều nhận `product`; nút lấy số của **đúng tab** và chỉ chia product đó. Phần tóm tắt đầu dialog vẫn hiện tổng cả pool.

### Lỗi 2 — Agent config bảo 13 người phụ trách Health, tab Health bảo không ai nhận
Roster đếm theo "**có dòng**", còn tab Health tính theo "**đang nhận**". 13 dòng seed của Health có `is_active = false` nên hiện thành **đã tick** mà thực tế không ai nhận.
**Sửa**: roster chỉ đếm dòng `is_active` và `weight > 0`. Hai màn hình đọc cùng một định nghĩa.

### Lỗi 3 (tự tìm ra) — nghỉ phép là mất tỉ lệ
Bỏ tick ở Agent config **xoá hẳn dòng**; tick lại tạo dòng mới `weight = 1`. Người nghỉ hai tuần quay lại mất cả trọng số lẫn vị trí trong vòng xoay.
**Sửa**: bỏ tick chỉ đặt `is_active = false`, **không xoá dòng** — trọng số và con trỏ giữ nguyên, bật lại là về đúng chỗ cũ.

### Mô hình sau khi dọn
| Thứ cần quyết | Điều khiển duy nhất | Lưu ở |
|---|---|---|
| Ai nhận lead của product này | Tick trong **Agent config** | `is_active` |
| Nhận bao nhiêu | Ô trọng số trong **tab product** | `weight` |

- **Bỏ hẳn cột "Receiving"** khỏi tab product: nó là cờ thứ hai cho cùng một câu hỏi mà tick ở Agent config đã trả lời.
- **Tab product chỉ liệt kê người đang bật.** Trọng số 0 nghĩa là "tạm không chia phần nào", vẫn thuộc product.
- **Nút Distribute nói trước vì sao không bấm được** (chưa lưu / không ai nhận / không còn lead), thay vì cho bấm rồi trả về `assigned 0`. Một nút bấm được mà chắc chắn không làm gì là một cái bẫy.
- Dịch nốt chuỗi `"Chưa có agent nào đang nhận lead Health."` bị lọt tiếng Việt trong `auto-assign.ts`.

- **Kiểm chứng**: `npm run test:run` 131 files / 958 tests; typecheck, lint, build sạch.

## 2026-09-01 — Mở modal thì trang nền không cuộn theo nữa (toàn app)

- **Loại**: fix (UX), áp cho **tất cả** modal của app.
- **Triệu chứng**: cuộn hết nội dung trong modal thì trang phía sau ăn tiếp phần cuộn còn lại (scroll chaining). Đóng modal ra là thấy mình đang ở một chỗ khác trên trang.
- **Hook dùng chung** `src/app/(authed)/_shared/useBodyScrollLock.ts`, áp cho **17 file có overlay** — tính cả những modal không thuộc Lead: Task, Enrollment, Config, Account Manager, Role Manager, Customer Registration, Provider Finder.
- **Đếm số modal đang mở, không chỉ set/restore**: modal lồng nhau là chuyện bình thường ở đây (hộp xác nhận trong Config, xem trước ảnh trong TaskDetailDrawer). Hai bản **tự viết sẵn có** trong `AttachmentPreviewDialog` và `CommentThread` lưu `overflow` cũ rồi khôi phục khi đóng — nên **đóng cái bên trong là mở khoá nền trong khi cái bên ngoài còn mở**. Đã thay bằng hook.
- **Bù bề rộng thanh cuộn**: không bù thì cả trang nhích ngang một nhịp đúng lúc modal mở, rồi nhích lại khi đóng.
- **Thêm `overscroll-contain`** cho mọi vùng cuộn bên trong modal (10 file): khoá nền đã đủ cho trường hợp thường, nhưng cái này chặn cả việc cuộn lan sang vùng cuộn cha khi có nhiều lớp lồng nhau.

- **Kiểm chứng**: 17/17 file có overlay đều đã khoá. `npm run test:run` 131 files / 958 tests; typecheck, lint, build sạch.

## 2026-09-01 — Dãy round-robin cập nhật theo tỉ lệ đang gõ

- **Loại**: fix (UI nói dối / thiếu phản hồi).
- **Trước**: sửa trọng số thì dãy biến mất, thay bằng dòng "Save to see the order". Người ta gõ 70/30 rồi phải lưu mới biết nó ra dãy gì — mà lưu là đã ghi vào DB rồi.
- **Nay**: dãy dựng **ngay tại client** từ trọng số đang gõ, dùng **chính hàm `pickWeighted`** mà RPC bên DB làm theo. Gõ tới đâu thấy tới đó.
- **Con trỏ lấy từ bản đã lưu, không reset về 0.** Đây là phần dễ làm sai nhất: lượt chia trước **chưa bao giờ dừng đúng ranh giới một chu kỳ** — lead không chia đều tuyệt đối bao giờ — nên bắt đầu lại từ 0 sẽ vẽ một dãy **khác** với dãy mà việc chia thật sẽ chạy. API trả thêm `current_weight` để màn hình dựng đúng từ tình trạng hiện tại.
- **Chưa lưu thì ghi rõ "Preview only — save to make this the real order."** thay vì giấu dãy đi: người ta cần thấy hệ quả *trước* khi quyết định lưu.
- **Test hồi quy** `rr-cursor.test.ts`: cùng tỉ lệ 70/30, con trỏ giữa chu kỳ cho dãy khác con trỏ 0 — và người kế tiếp là người đang bị nợ, không phải người có trọng số cao nhất.

## 2026-09-01 — Agent config lấy nhầm bảng: 6 thay vì 17 agent

- **Loại**: fix (chọn sai nguồn dữ liệu).
- **Sai ở đâu**: màn Config → Assistant membership có **hai view**. View **"Agents"** đọc bảng **`task_agents`**; view **"Assistant membership"** đọc `agent_members` (các **cặp** agent↔assistant). Tao lấy phía `agent_email` của `agent_members`, tức chỉ ra những agent **tình cờ có assistant** — **6 trên 17** trên production. Một agent chưa có assistant vẫn là agent.
- **Sửa**: đọc `task_agents` qua **chính hàm `fetchTaskAgents()`** mà màn Config dùng, thay vì tự viết truy vấn. Một roster, hai màn hình, không có bản sao thứ hai — và nó vốn đã lọc sẵn tài khoản còn hoạt động cùng tên hiển thị.
- **Kiểm trên dữ liệu thật**: `task_agents` **17 dòng, cả 17 đang hoạt động**; `agent_members` phía agent chỉ 6. Không có agent nào có assistant mà lại nằm ngoài `task_agents`, nên đổi sang `task_agents` là tập cha, không mất ai.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Chia pool: ba tab, tách "ai" khỏi "bao nhiêu"

- **Loại**: feature (cấu trúc lại màn Chia pool).
- **Ba tab**: `P&C` · `Health` · **`Agent config`**.
  - Hai tab product chỉ còn trả lời **"mỗi người nhận bao nhiêu"** — trọng số, tỉ lệ, tạm dừng.
  - Tab **Agent config** trả lời **"ai phụ trách product nào"** — mỗi agent một dòng, hai ô tick P&C / Health.
- **Vì sao tách**: trước đó cả hai câu hỏi nằm chung một bảng, nên phải có nút "Add agent" trong từng tab và cùng một người phải thêm hai lần cho hai product. Tách ra thì phân công làm một lần, tỉ lệ chỉnh riêng.
- **Danh sách agent lấy từ phía AGENT của Assistant membership** (`agent_members.agent_email`), **không lấy assistant**: assistant hỗ trợ công việc của agent nhưng không phải người mà một lead thuộc về. Sáu agent, đọc từ chính bảng mà `/config` ghi — không có bảng thứ hai.
- **Lọc bỏ agent không còn tài khoản**: một dòng sót lại của người đã đi sẽ nằm mãi trong picker mà không có cách nào biết.
- **Tick là lưu ngay**, không phải bấm Lưu sau: "người này có làm Health không" là một việc dứt khoát, không phải một con số cần cân đi cân lại. Tick xong tab tỉ lệ tương ứng nạp lại luôn để thấy người mới.
- Bỏ nút "Add agent" và nút thùng rác khỏi hai tab product — việc đó giờ thuộc Agent config.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Chia pool: ô "Add agent" dùng picker chung, chọn là thêm

- **Loại**: fix (UI).
- **Vấn đề**: nó là `<select>` thuần liệt kê **toàn bộ 43 tài khoản** đang hoạt động — không gõ tìm được, phải cuộn; chỉ hiện tên nên hai người trùng tên không phân biệt được; và nó là picker duy nhất trong app không giống những cái còn lại.
- **Sửa**: dùng `TaskSelect` như mọi chỗ khác — có ô tìm kiếm, và **email nằm trong `keywords`** nên gõ email cũng ra.
- **Bỏ nút "Add" đi kèm**: chọn **là** thêm. Một select đã chọn xong mà vẫn phải bấm thêm một nút nữa là bước thừa, và là đúng chỗ người ta quên bấm rồi tưởng đã thêm rồi.
- Chặn thêm trùng một người hai lần.

## 2026-09-01 — Modal Chia pool: to hơn, bảng agent gọn hơn, và hiện thứ tự nhận

- **Loại**: UI + một chút API.

### Hiện thứ tự nhận, không chỉ con số
- Trước đó chỉ có `"A 7 · B 3"`. Nó nói được **tỉ lệ** nhưng không nói được **ai nhận lead ngay sau đây** — mà đó mới là câu người đang đứng trước nút Distribute hỏi.
- API trả thêm `sequence`: dãy 10 lượt kế tiếp **theo đúng thứ tự** (`pickWeighted(...).picks`, chính hàm mà việc chia thật dùng). UI vẽ thành dải chip đánh số 1→10, chip đầu viền đậm là người nhận kế tiếp.
- **Đang sửa dở thì không vẽ dãy.** Dãy hiện có là của tỉ lệ **đã lưu**; vẽ nó cạnh mấy con số vừa gõ mà chưa lưu là nói dối. Lúc đó hiện một dòng nhắc lưu.

### Bảng agent
- Mỗi dòng: **avatar + tên + email** (dùng `Initials` chung với bảng lead), ô trọng số, **thanh tỉ lệ + số %**, ô tick, nút xoá. Thanh cho thấy chênh lệch giữa các dòng nhanh hơn con số.
- Người đang tạm dừng (bỏ tick hoặc trọng số 0) làm mờ cả dòng, nên nhìn lướt là biết ai đang không nhận.
- Đổi từ `<table>` sang grid: các cột thẳng hàng giữa header và các dòng mà không cần `table-fixed`, và dòng cao thoáng hơn.
- Vùng danh sách dùng `flex-1` nên **ăn hết chỗ trống còn lại** của modal thay vì cố định 256px.

### Kích thước
- Modal `h-[calc(100vh-4rem)] max-h-[860px] max-w-3xl` — cao hơn và rộng hơn trước (`680px` / `max-w-2xl`), vẫn **cố định** nên footer không nhảy khi thêm/xoá agent hay khi hiện lỗi.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Modal Chia pool: tiếng Anh và kích thước cố định

- **Loại**: fix (UI).
- **Tiếng Anh**: toàn bộ chữ trên màn hình của modal Chia pool, cộng những đoạn tao thêm vào dialog Import (ô tự chia, dòng xem trước, kết quả, cảnh báo cắt danh sách sự kiện). Phần còn lại của app vốn là tiếng Anh; chỗ tao viết bị lệch. Comment trong code vẫn giữ tiếng Việt, đồng bộ với các file khác của module.
- **Modal cao cố định** `h-[680px]`: thêm/xoá agent, hiện lỗi, hay đổi product đều không được làm modal co giãn dưới tay người đang bấm — nút "Chia" nhảy chỗ ngay lúc sắp bấm là cách làm người ta bấm nhầm. Vẫn giữ `max-h` để màn hình thấp không tràn.
- **Vùng danh sách agent cao cố định** `h-64`, tự cuộn, header dính: danh sách 2 người hay 13 người thì phần còn lại của modal vẫn nằm nguyên chỗ cũ.

## 2026-09-01 — Chia pool: danh sách agent lúc hiện lúc không

- **Loại**: fix (bug tải dữ liệu). Bốn lỗi cùng nằm trong một effect.

1. **Không có trạng thái loading.** Trong lúc fetch, `draft` là `[]` nên bảng render "Chưa có agent nào cho X" — **trông y hệt dữ liệu rỗng thật**. Đây chính là triệu chứng "lúc hiện lúc không": mạng nhanh thì kịp thấy, mạng chậm thì đọc thành "không có ai".
2. **Ba fetch chạy tuần tự trong một effect** (pool → roster → weights). Bảng agent phải đợi **cả pool lẫn roster** xong mới hiện, dù nó không cần cái nào trong hai. Tách thành hai effect: pool + roster nạp **một lần khi mở**, weights nạp theo product.
3. **Không có hàng rào chống response về trễ.** Đổi product khi request cũ còn bay thì response cũ về sau ghi đè response mới — bảng hiện tỉ lệ của product vừa rời khỏi. Thêm số thứ tự request.
4. **Roster hỏng im lặng.** `if (rosterResponse.ok)` — hỏng thì `roster` rỗng, `notListed` rỗng, và **cả ô "Thêm agent" biến mất không dấu vết**, trông y hệt "đã thêm hết mọi người rồi". Nay báo rõ.

- **Trạng thái loading là suy ra, không lưu**: payload từ API vốn mang theo `product` của chính nó, nên "chưa có payload của product đang xem" **chính là** đang tải. Một cờ `loading` riêng vừa phải set đồng bộ trong effect (React Compiler chặn), vừa là thêm một thứ nữa có thể lệch khỏi sự thật.
- **Fetch inline với `.then()`** theo đúng pattern `LeadAddDialog`/`LeadImportDialog`: React Compiler chặn việc gọi một hàm có `setState` thẳng trong thân effect, kể cả khi `setState` nằm sau `await`.
- Khoá nút **Lưu** và **Chia** khi đang tải, để không thao tác trên dữ liệu chưa về.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Ai nhận lead do danh sách Chia pool quyết, không do RBAC

- **Loại**: fix (sai mô hình).
- **Sai ở đâu**: bản đầu tao đối chiếu danh sách chia với `canBeAssignedLead()` (tài khoản còn hoạt động + có `lead.work`/`lead.manage`). Nghĩa là admin bật một người trong Chia pool nhưng **Role Manager mới là nơi quyết định thật** — người đó vẫn bị loại, kèm một dòng đỏ bảo đi chỗ khác mà sửa. Đúng ra chỉ được có một nơi quyết.
- **Nay**: danh sách trong **Chia pool là nguồn duy nhất**. Ai nhận lead = dòng nào đang tick **"Đang nhận"** và có trọng số > 0. Không có phiếu thứ hai từ bảng quyền.
- **Bỏ hẳn**: hàm `resolveEligibleAssignees`, cột `eligible` trong API, và dòng cảnh báo đỏ trong dialog.
- **Ô "Thêm agent" mở ra mọi tài khoản đang hoạt động** qua route mới `/api/leads/assignment-roster`, thay vì `fetchLeadAssignees()` (vốn lọc theo quyền lead). Lấy danh sách từ bảng quyền là lại đẩy quyết định về Role Manager — đúng cái vừa bỏ.
- **Hệ quả cần biết**: gán lead cho một tài khoản không có quyền lead thì họ **không mở được `/leads`** để làm việc trên lead đó. Cơ chế chia không còn chặn việc này nữa — đó là lựa chọn có chủ đích, và người cấu hình chịu trách nhiệm.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Chia pool: xoá được agent khỏi danh sách

- **Loại**: fix (thiếu chức năng).
- Dialog cho **thêm** agent nhưng không cho **xoá** — API `PUT` vốn đã hiểu "dòng nào không có trong danh sách gửi lên thì bỏ", nhưng UI không có cách nào diễn đạt điều đó. Thêm nút thùng rác mỗi dòng.
- **Tách rõ hai việc dễ lẫn**, có ghi ngay trên bảng: bỏ tick **Đang nhận** là *tạm dừng* — dòng còn đó, con trỏ vòng xoay của người đó giữ nguyên, bật lại là chạy tiếp; **thùng rác** là bỏ hẳn khỏi danh sách. Đổi tên cột `Nhận` thành `Đang nhận` cho khớp nghĩa.

## 2026-09-01 — UI chia pool: đặt tỉ lệ ngay tại chỗ chia

- **Loại**: feature (UI cho cơ chế tự chia đã có).
- **Đặt ở đâu và vì sao**: không làm tab riêng trong Lead Config mà gộp vào đúng nút **"Chia pool"**. Con số tỉ lệ chỉ có nghĩa khi đứng cạnh đám lead nó sắp điều đi: mở dialog là thấy còn bao nhiêu lead chưa gán, chỉnh tỉ lệ, xem phân bổ đổi theo, rồi mới chia.
- **Thay `window.confirm` bằng dialog thật.** Trước đó nút này chỉ hỏi một câu rồi chạy — không sửa được gì, không thấy gì.
- **Có gì trong dialog**: số lead đang ở pool tách theo product · chuyển P&C ↔ Health · bật/tắt "tự chia khi import" · bảng agent với trọng số, **tỉ lệ % tính lại theo từng ký tự gõ vào** · thêm agent từ roster · xem trước "trong 10 lead kế tiếp" · nút đặt lại vòng xoay · nút chia.
- **Agent không nhận được lead vẫn hiện, kèm cảnh báo đỏ** thay vì bị ẩn: một dòng biến mất im lặng làm tỉ lệ trên màn hình không cộng lại thành cái admin vừa gõ.
- **Chưa lưu thì không cho chia.** Chia khi đang có sửa dở sẽ dùng tỉ lệ *đã lưu*, không phải tỉ lệ đang hiện trên màn hình — tức là làm ngược lại điều người ta vừa đọc.
- **Đặt lại vòng xoay hỏi trước**: nó bỏ phần dư của chu kỳ hiện tại và đổi người kế tiếp, không lùi được.
- **Thêm agent lấy từ roster** (`assignees`), nên P&C — vốn không có ai do role `P&C Agent` rỗng — cấu hình được mà không cần chạy SQL tay.

- **Kiểm chứng**: `npm run test:run` 130 files / 957 tests; typecheck, lint, build sạch.

## 2026-09-01 — Tự chia lead theo tỉ lệ (weighted round-robin)

- **Loại**: feature. Plan: `docs/superpowers/plans/2026-09-01-lead-auto-assign.md`.
- **Cái gì**: lead import vào để trống người nhận, rồi được chia cho agent **theo tỉ lệ cấu hình được**, **xen kẽ**, và **tách theo product**.

### Thuật toán: vì sao là smooth weighted round-robin
Yêu cầu "xen kẽ" loại bỏ hai cách hiển nhiên hơn:
- **Chia khối** (70 lead đầu cho A, 30 sau cho B): A nhận hết lead buổi sáng, B nhận hết buổi chiều — hai loại đó không cùng chất lượng.
- **Random theo trọng số**: đúng tỉ lệ về lâu dài, nhưng một lượt import 10 lead vẫn có thể ra 10 A. "Về lâu dài" không an ủi được người tháng này không nhận được gì.

Smooth WRR (thuật toán nginx dùng cho upstream) cho cả hai. A=70/B=30 ra `A B A A A B A A B A` — đúng 7/3 và rải đều; sau đúng một chu kỳ trạng thái về 0 nên tỉ lệ không trôi.

### Hai thứ bắt buộc phải nằm trong DB
- **Con trỏ `current_weight`**: nếu mỗi lượt import khởi tạo lại từ 0 thì **mười lần import mỗi lần một lead sẽ cùng rơi vào người đầu tiên**. Lưu lại thì import 3 rồi 7 cho ra đúng phân bố như một lần import 10. Có test riêng cho đúng điều này.
- **Khoá hàng (`for update`)**: không khoá thì hai lượt import song song cùng đọc một `current_weight` và **tỉ lệ hỏng im lặng** — không có lỗi nào để nhìn thấy, chỉ có phân bổ sai.

### Quyết định thiết kế đáng nói
- **Trọng số là số nguyên, không phải phần trăm.** Lưu phần trăm thì tổng phải luôn bằng 100, nên thêm agent thứ ba là buộc phải sửa hai dòng kia. Phần trăm là **tính ra**.
- **Danh sách và tỉ lệ là dữ liệu admin khai, không suy từ role.** Đã kiểm production: `Health Agent` 13 người nhưng **`P&C Agent` RỖNG** — suy từ role là chia lead P&C cho không ai. Rollout chỉ seed Health làm gợi ý, và seed với `is_active = false`.
- **Điều kiện được nhận vẫn ở TS.** RPC nhận danh sách đã lọc bằng `canBeAssignedLead()`. Module này đã trôi lệch bốn lần vì chép luật sang chỗ khác; không chép lần thứ năm sang SQL.
- **Không ai hợp lệ thì lead ở lại pool, không làm hỏng import.** Làm fail cả lượt 2.000 dòng vì thiếu cấu hình tỉ lệ là hỏng việc lớn vì việc nhỏ. Kết quả import nói rõ **vì sao** còn lead ở pool.
- **Gán và ghi lịch sử trong cùng một transaction** — khác `/api/leads/assign` hiện tại (update trước, insert history sau, hỏng thì chỉ `console.error`). Đây cũng là chỗ sửa **C5** cho đường tự chia.
- **Mặc định TẮT, và cần hai lớp bật**: cờ toàn cục cộng ô tick trong dialog import, kèm **xem trước** ("trong 10 lead kế tiếp: A 7, B 3") ngay cạnh ô tick.
- **Import dùng chính id vừa chèn**, không truy vấn lại "lead chưa gán của event này" — truy vấn như thế sẽ nuốt cả lead cũ mà lượt trước cố ý để lại pool.
- **Sửa tỉ lệ không reset con trỏ**: upsert cố tình không đụng `current_weight`, nếu không đổi một trọng số sẽ trao mấy lead kế tiếp cho người đang lùi xa nhất. Reset là endpoint riêng.
- **Nút "Chia pool"** cho lead đang tồn: tối đa 500 mỗi lượt, cũ trước, hỏi xác nhận kèm số thật ("chia 137 lead: P&C 40, Health 97?").

### Kiểm chứng
- `round-robin.test.ts` 9 test, gồm dãy `abaaabaaba` và ca "con trỏ nhớ qua nhiều lượt".
- **Kiểm RPC trên PostgreSQL 16 thật**: cùng cấu hình 70/30 ra **đúng dãy `abaaabaaba`** như bên Node — SQL và TS khớp nhau; hai lượt 10 lead cho tổng 14/6; danh sách hợp lệ rỗng trả 0 dòng và lead ở lại pool không lỗi; chạy lại rollout là no-op.
- `npm run test:run` 130 files / **957 tests**; typecheck, lint, build sạch.

### Cần chạy
`supabase/rollouts/2026-09-02-lead-auto-assign.sql` — 4 cột `ok`.

## 2026-09-01 — Audit Event Leads: sự kiện, tải dữ liệu, và cơ chế refresh

- **Loại**: fix (bug) + hiệu năng tải dữ liệu.

### Bug trong xử lý sự kiện

- **E1 — Tạo sự kiện trùng tên nổ 500.** `POST /api/leads/events` insert thẳng, mà unique index nằm trên `lower(btrim(name))`, nên trùng tên trả về lỗi 23505 thô dưới dạng 500. Trong khi đó ở màn **tạo lead**, đúng cái tên ấy lại resolve về sự kiện đã có. Một khái niệm, hai hành vi. Nay route dùng chung `resolveEventByName()`; trùng tên trả về sự kiện đang có kèm `wasCreated: false`.
- **E2 — `%` và `_` trong tên sự kiện thành ký tự đại diện.** `resolveEventByName` dùng `ilike(name)` không escape, nên một sự kiện tên `"50% Off Fair"` khớp nửa bảng và lead có thể bị nối vào **sai sự kiện**. Thêm `escapeLikePattern()` + trim đầu đuôi cho khớp với biểu thức của unique index — không trim thì một tên có dấu cách thừa **không bao giờ** tạo được: tìm thì trượt, insert thì đụng index, retry lại trượt.
- **E3 — Sự kiện thứ 201 trở đi biến mất im lặng.** GET cắt cứng ở 200 mà không báo. Nay lấy dư một dòng để biết còn nữa, trả về cờ `truncated`, và dialog Import nói rõ — kèm hướng dẫn gõ đúng tên để nối vào sự kiện cũ thay vì tạo trùng.
- **Tạo sự kiện không còn bắt mọi tab tải lại danh sách lead.** Một sự kiện mới không đổi dòng lead nào; chỉ phát tín hiệu khi thật sự tạo mới.

### Tải dữ liệu

- **L1 — Hai truy vấn lặp lại mỗi trang.** Ngưỡng cảnh báo và danh sách status kết thúc được đọc **bên trong** `fetchLeadsPage`, mà `fetchAllLeads` gọi hàm đó một lần cho mỗi trang. Danh sách 1.000 lead lọc theo cảnh báo tốn **5 lần đọc ngưỡng + 5 lần đọc status** cho cùng một câu trả lời. Gom về `fetchLeadAlertContext()`, đọc một lần cho cả lượt phân trang.
- **L2 — `count: "exact"` chạy lại mỗi trang.** Nó là một `COUNT(*)` trên toàn bộ tập đã lọc; 5 trang là trả lời cùng một câu hỏi 5 lần. Nay chỉ trang đầu xin đếm.
- **L5 — Nạp cột không dùng.** GET sự kiện trả `location`, `notes`, `created_at` trong khi hai dialog chỉ dùng `id`, `name`, `event_date`.

### Cơ chế chưa hợp lý

- **L3 — Một người sửa lead, cả công ty tải lại.** `LEADS_TOPIC` là **một kênh toàn cục**: một agent ghi một cuộc gọi → mọi tab đang mở của cả 43 người cùng gọi lại `/api/leads` và kéo **toàn bộ** danh sách của họ. Một lần gán hàng loạt 20 lead phát 20 tín hiệu, tức 20 lần tải cho mỗi tab.
  - Gộp cả chùm thành **một** lần refresh (400 ms).
  - **Bỏ qua hẳn khi tab đang ẩn** — tab nền vẽ lại thứ không ai nhìn vẫn phải trả tiền truy vấn; nó ghi nhận là đã lỡ và bắt kịp khi được focus lại.
- **L4 — Poll 60 giây tải lại tất cả, mãi mãi.** Realtime mới là tín hiệu chính, poll chỉ là lưới cho trường hợp rớt socket. Giãn về **5 phút**.

- **Kiểm chứng**: `npm run test:run` 128 files / **945 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Gộp 4 chip cảnh báo thành một bộ lọc phủ 100% lead

- **Loại**: feature (thay UI lọc) — theo yêu cầu: một filter thôi, và filter đó phải có đủ 100% lead.
- **Trước**: 4 chip rời (Never called / Overdue / Stale / Max tries). Chúng chỉ đếm lead **có vấn đề**, nên cộng lại không ra tổng: lead đang ổn, lead chưa giao, lead đã đóng không nằm ở đâu cả.
- **Nay**: một dropdown **Lead health**, 7 nhóm **rời nhau**, mỗi lead thuộc **đúng một** nhóm nên các con số cộng lại bằng đúng tổng danh sách:
  - cần nhấc máy: `Never called` · `Overdue follow-up` · `Stale` · `Max attempts`
  - không ai có lỗi: `On track` · `In the pool` (chưa giao) · `Closed (won/lost)`
- **Vì sao phải có quy tắc ưu tiên**: một lead có thể trip nhiều cờ cùng lúc (vừa `stale` vừa `exhausted`). Cờ là câu trả lời cho "đang sai cái gì" và có thể nhiều; nhóm trả lời "lead này đang đứng ở đâu" và bắt buộc **đơn trị**, nếu không thì đếm sẽ trùng và tổng vượt quá 100%. Ưu tiên lấy cờ **hành động được nhất**: never_contacted → follow_up_overdue → stale → exhausted.
- **`classifyLeadHealth` lặp lại đúng thứ tự thoát sớm của `resolveLeadAlerts`** (closed → unassigned → cờ → on_track), nên một lead không bao giờ bị xếp nhóm "cần gọi" trong khi badge của chính nó nói ngược lại.
- **Badge trên bảng giữ nguyên**: vẫn hiện **mọi** cờ của dòng đó. Chỉ bộ lọc là đơn trị.
- **Nhóm rỗng thì ẩn — trừ nhóm đang được chọn**: nếu ẩn nó đi thì ô select rơi về "All leads" trong khi bộ lọc vẫn đang chạy và danh sách vẫn rỗng, tức màn hình nói dối về trạng thái của chính nó.
- **Test phủ đúng điều đang hứa**: một test duyệt mọi lead qua `classifyLeadHealth` rồi khẳng định **tổng các nhóm bằng số dòng**. `filterLeads` cũng fail closed như trước: không có map nhóm thì không dòng nào khớp.

- **Kiểm chứng**: `npm run test:run` 127 files / **942 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Cảnh báo lead lên bảng (O1 + O2)

- **Loại**: feature — khoảng trống lớn nhất trong audit, và không đụng DB.
- **Vấn đề**: `resolveLeadAlerts` viết xong, test xong, nhưng **chỉ được gọi từ Overview** — mà Overview là manager-only. Agent mở `/leads` không thấy lead nào của mình quá hạn, chưa gọi bao giờ, hay đã thử đủ số lần. Module này sinh ra vì "có agent nhận leads nhưng có agent lại không call": cơ chế phát hiện đã có, nhưng **người duy nhất hành động được thì không nhìn thấy nó**.
- **Badge cạnh tên lead**: mỗi dòng hiện cờ của nó — `Never called` / `Overdue` / `Stale` / `Max tries`. Giữ nguyên hai bậc màu của `ALERT_SEVERITY`: đỏ = agent chưa làm phần việc của mình, vàng = đã làm và lead khó. Gộp một màu là đổ lỗi cho người gọi bốn lần không ai nghe máy giống hệt người chưa bấm số bao giờ.
- **Chip đếm trên toolbar**, bấm để lọc: agent thấy ngay "3 lead chưa gọi" của **chính mình**. Đây là câu trả lời cho O2 mà không cần mở Overview cho agent — chip đếm trên đúng những dòng người đó đã được phép thấy, nên không cần thêm quyền nào.
- **Tính ở client, không thêm request nào**: `resolveLeadAlerts` là hàm thuần đọc bốn cột đã lưu sẵn cộng ngưỡng cộng thời điểm hiện tại. Trang server nạp sẵn hai dòng ngưỡng; badge tự đúng khi đồng hồ chạy mà không cần refresh. Đây cũng chính là lý do module này không cần cron quét lead quá hạn.
- **Lọc theo cảnh báo là lọc cục bộ**, khác `?alert=` trên URL (đó là hỏi server một trang khác, và là đường Overview link sang). `filterLeads` nhận thêm map alert và **fail closed**: không có map thì không dòng nào khớp, thay vì âm thầm bỏ qua bộ lọc và hiện tất cả.
- **Dọn kèm**: gom `fetchLeadAlertSettings()` về `queries.ts`. Ba nơi cần "nạp hai dòng ngưỡng, điền mặc định khi thiếu" và mỗi nơi đang mọc một bản sao của bộ mặc định.

- **Kiểm chứng**: `npm run test:run` 126 files / **935 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Sửa đợt 2 theo audit Lead (B5, B6, C10)

- **Loại**: fix (state phía client). Ba lỗi người dùng gặp hằng ngày, cùng nằm trong `LeadsClient`.
- **Ba quy tắc tách thành hàm thuần** ở `src/lib/leads/list-state.ts` kèm 9 test. Vitest ở repo này chạy `environment: "node"` và chỉ nhận `src/**/*.test.ts`, nên logic đáng ghim **phải** nằm ngoài `.tsx` mới test được — để trong component là không có lưới nào cả.

### B5 — Đang chọn nhiều lead thì cứ 60 giây bị bỏ chọn
- `reload()` gọi `setSelected(new Set())`, mà `reload()` chạy theo **đồng hồ 60 giây** và theo **mọi tín hiệu realtime của người khác**. Manager tick 20 lead, dừng đọc một dòng, quay ra mất sạch. Tái hiện 100%.
- **Sửa**: bỏ khỏi `reload()`. Xoá lựa chọn là việc của `assignSelected()` sau khi **chính mình** gán xong — chỗ đó vốn đã gọi sẵn, nên hành vi đúng không mất.
- **Vẫn phải bỏ những dòng đã biến mất** (`retainSelection`): lead bị archive hoặc gán ra ngoài phạm vi mà còn nằm trong `selected` thì lần bấm Assign sau thất bại một phần, không có gì trên màn hình giải thích vì sao.

### B6 — Sửa một cột tuỳ biến làm các cột tuỳ biến khác nháy về "—"
- `custom_values` gửi lên là **một phần** (đúng một khoá đang sửa), nhưng optimistic update spread thẳng nên **thay nguyên** object. Mọi cột tuỳ biến khác của dòng đó về `—` cho tới khi server trả lời.
- **Sửa**: `mergeLeadPatch()` merge `custom_values` thay vì thay thế. Tự lành sau response nên không mất dữ liệu, nhưng trên mạng chậm thì nhìn thấy rõ và đọc như mất dữ liệu.

### C10 — State URL và drawer bị cũ
- **Drawer giữ bản sao cũ**: `find(...) ?? current` làm modal tiếp tục mở trên một lead đã archive hoặc đã ra ngoài phạm vi của người xem. Nó trông vẫn sửa được, và chỉ đến lần lưu sau mới lòi ra 403/404. `syncSelectedLead()` trả `null` khi dòng biến mất → drawer tự đóng.
- **Tab không theo Back/Forward**: `view` đọc search params **đúng một lần lúc khởi tạo**, nên nút Back đổi thanh địa chỉ mà tab đứng yên. Nay `view` **suy ra** từ `searchParams` mỗi lần render, `changeView`/`selectAlert` chỉ đẩy URL. Kèm luôn: `?view=overview` của người không phải manager rơi về list thay vì render một tab họ không có quyền.

- **Kiểm chứng**: `npm run test:run` 126 files / **932 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Sửa đợt 1 theo audit Lead (P0 + B1/B3/B4)

- **Loại**: fix (integrity + phân loại dữ liệu) — theo `docs/superpowers/plans/2026-09-01-lead-audit.md`, gồm cả phần review bổ sung của Codex.
- **Lưu ý**: đợt này xây tiếp trên WIP chưa commit của phiên khác (`LeadChoiceField.tsx` tách từ `LeadChoiceCell`, modal sửa được tại chỗ). Không đè, chỉ bổ sung.

### C2 ⛔ Add/Import từ màn "All products" âm thầm ghi thành Health
- Hai dialog nhận `productFilter ?? "health"`. Trên màn gộp thì `productFilter` luôn null → mọi lead tạo/import từ đó bị xếp vào Health, kể cả khi chiến dịch là P&C. **Lỗi phân loại dữ liệu**, không phải lỗi UI.
- **Sửa**: `resolveDialogProduct(productFilter, chosen)` trả `null` khi chưa biết; dialog **bắt buộc chọn** product, chặn cả ở nút lẫn trong hàm submit. Khi URL đã lọc product thì giữ nguyên badge như cũ.

### C1 ⛔ `flattenAccess` vứt bỏ `portal_account.role`
- Hàm tính `legacyRole` từ cột `role` rồi **chỉ dùng cho nhánh inactive**; account active luôn lấy `getLegacyRoleFromRoleNames(roleNames)`. Một dòng sửa thẳng trong DB sẽ âm thầm không được coi là admin ở đâu cả.
- **Đo blast radius trước khi sửa**: 3 tài khoản `role='admin'`, **cả 3 đều có role RBAC Admin** → hai nguồn đang khớp 100%, và `/api/admin/users` vốn ghi cột đó **từ** role RBAC. Nên đây là bẫy tiềm ẩn, **không phải nguyên nhân** của bất kỳ lỗi "admin không sửa được" nào. Sửa thành OR: không đổi hành vi hôm nay, bỏ được bẫy.

### C3 ⛔ Dropdown tuỳ biến có hai hợp đồng
- Add dialog gửi `option.label`; inline edit và `EditableCustomCell` nói `option.id`. Lead tạo bằng dialog sẽ hiện ô dropdown rỗng.
- **Kiểm dữ liệu thật: chưa hỏng** — scope lead hiện chưa có cột dropdown tuỳ biến nào (chỉ `secondary_phone` dạng text). Nhưng chỉ cách một thao tác "thêm cột" ở Lead Config.
- **Sửa**: dialog gửi `option.id` (chuẩn chung với Task/Enrollment); PATCH truyền thêm `optionIdByLabel` để giá trị cũ dạng label **tự chuyển sang id** thay vì bị từ chối; bảng đọc theo id trước, label sau.

### C4 ⛔ PATCH yếu hơn Create
- **Phone**: PATCH lưu thô, Create dùng `normalizePhone`. Một inline edit ghi `(714) 555-0123` cạnh một bản tạo `7145550123` — mà cả bộ chống trùng lẫn tìm kiếm theo chữ số đều so chuỗi thô. Nay PATCH dùng chung `normalizePhone`.
- **Required**: PATCH không chạy kiểm bắt buộc, nên inline edit xoá trắng được một cột admin đánh dấu Required. Nay dùng `findMissingRequiredFieldsFromContext(..., { partial: true })` — chế độ này vốn được viết sẵn cho PATCH.
- **custom_values**: chuyển sang `fetchWriteValidationContext` + `validateCustomValues` — đúng RPC mà Task và Enrollment dùng, nên Create / Import / inline edit không còn ba hợp đồng khác nhau cho cùng một cột. Bỏ luôn khả năng ghi một **system key** vào `custom_values` (dữ liệu bóng).
- **status/follow-up**: trước đây chỉ kiểm khi request có gửi `status_id`, nên một request chỉ chứa `next_follow_up_at` treo được ngày hẹn lên lead status Open — mà `resolveLeadAlerts` đọc ngày đó bất kể status, tức lead sẽ báo quá hạn cho một cuộc gọi không ai hứa. Nay tách thành `checkFollowUpInvariant()` chạy khi **một trong hai** phía đổi, và vẫn xoá ngày còn treo khi rời khỏi status "call back".

### B2 + O5 — một luật người nhận duy nhất
- `POST /api/leads` vẫn tự dựng `targetActor` thiếu cờ `isAdmin` (bản sao thứ hai của lỗi đã sửa ở assign route sáng nay). Nay dùng `canBeAssignedLead()`.
- **Test chặn tái diễn**: quét mọi `src/app/api/leads/**/route.ts`, fail nếu file nào gọi `buildLeadActor(targetAccess.permissions...)`. Test này **đã fail đúng chỗ** trước khi sửa.

### B1 + B4 — Overview trắng, và ngưỡng cảnh báo sai product
- `toLeadProduct(null)` → `"pc"`, mà **30/30 lead đang hoạt động đều là health** → tab Overview trả 0 dòng cho mọi manager. Thêm `parseOverviewProduct()` (không fallback) và cho truy vấn chỉ lọc product khi có giá trị.
- Ngưỡng cảnh báo nay là **map theo product**; `summarizeLeads` chọn theo `lead.product` của từng dòng qua `settingsForLead()`. Trước đó một danh sách trộn product bị đo bằng đúng một bộ ngưỡng.

### B3 — một định nghĩa "quá hạn follow-up"
- SQL không diễn đạt được vế "đã liên hệ sau giờ đã hẹn", nên danh sách `?alert=follow_up_overdue` hiện cả lead mà engine coi là ổn.
- **Sửa**: SQL còn là bộ lọc **thô và là tập cha** (dùng ngưỡng lỏng nhất trong các product đang xem — lấy ngưỡng chặt hơn sẽ âm thầm giấu mất lead), rồi `resolveLeadAlerts` chốt lại ở Node. `total` tính lại theo kết quả đã lọc, vì con số PostgREST trả về thuộc về truy vấn lỏng hơn và "X of Y" không được nói dối.

- **Kiểm chứng**: `npm run test:run` 125 files / **921 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Xoá quyền chết `lead.export`, cho manager ghi tương tác

- **Loại**: chore (xoá quyền chết) + fix (nới quyền ghi)

### `lead.export` — xoá
- Quyền này chưa bao giờ có code đọc: `grep` chỉ ra đúng hai chỗ, khai báo hằng số và test của chính hằng số đó. Module Lead không có tính năng export. Giữ nó trong Role Manager là mời người ta cấp rồi tưởng đã bật được thứ gì.
- **Gỡ khỏi 5 chỗ**: `PERMISSIONS`, `PERMISSION_DEFINITIONS`, `permissions.test.ts`, `supabase/schema.sql` (cả dòng seed lẫn dòng cấp cho Admin), và `2026-08-31-lead-final.sql` (seed + lệnh cấp + cột kiểm chứng `= 3` thành `= 2`).
- **Gỡ khỏi rollout là bắt buộc chứ không phải dọn dẹp**: file đó **chưa chạy**, để nguyên thì chạy nó sẽ tạo lại đúng cái quyền vừa xoá.
- Lệnh xoá khỏi DB gộp vào `2026-09-01-lead-role-grants.sql` (mục 4) để số file phải chạy vẫn là 2, kèm cột kiểm chứng `export_dropped`.

### `canLogInteraction` — manager ghi được trên mọi lead
- **Trước**: kể cả admin cũng không ghi được tương tác lên lead không phải của mình.
- **Sau**: thêm nhánh `if (actor.isManager) return true`, ngang tầm `canEditLead`.
- **Lo ngại ban đầu không đứng vững**: `contact_attempt_count` và `last_contacted_at` là của **LEAD**, không phải của người — chúng trả lời "đã có ai gọi người này chưa", đúng thứ engine cảnh báo cần. Và mỗi dòng `lead_interactions` đều lưu `actor_email` nên ai thật sự gọi không bao giờ mất. Manager gọi thay agent đang nghỉ là việc bình thường; cấm nó chỉ đẩy cuộc gọi ra ngoài hệ thống.
- **Không phải sửa RPC**: `log_lead_interaction_atomic` chưa bao giờ kiểm chủ lead — nó nhận `p_actor_email` rồi ghi thẳng. Cổng duy nhất là hàm TS.
- **Giữ `canLog` tách khỏi `canEdit`** dù hai cái hiện cho cùng kết quả: ghi lại một cuộc trò chuyện và sửa một ô dữ liệu là hai việc khác nhau, và RPC áp thêm ràng buộc lên việc ghi. Thêm một test quét mọi tổ hợp actor × lead khẳng định hai cái đang bằng nhau — lệch là fail chứ không âm thầm.
- **Dọn kèm**: `LeadDetailDrawer` không còn cần `currentEmail` (nó chỉ dùng để thu hẹp scope của manager), đã gỡ khỏi cả chuỗi truyền props từ `page.tsx` xuống.

- **Kiểm chứng**: rollout grants chạy lại trên PostgreSQL 16 với bản sao hiện trạng — 4 cột `ok`, chạy lần hai no-op, bảng `permissions` còn đúng `lead.manage` + `lead.work`. `npm run test:run` 125 files / **902 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Lead RBAC: fix bug phân quyền + gộp luật về một nơi

- **Loại**: fix (bug phân quyền) + chore (chống trôi lệch)
- **Plan**: `docs/superpowers/plans/2026-09-01-lead-rbac.md` — ma trận "ai thấy gì, ai sửa gì".

### Bug: account-role admin quản lý được lead nhưng không NHẬN được lead
- **Nguyên nhân**: hôm nay `buildLeadActor` được thêm cờ `isAdmin`, nhưng route assign kiểm người nhận thì gọi `buildLeadActor(targetAccess.permissions, parsed.toEmail)` — **không truyền cờ đó**. Một admin chưa được cấp `lead.work` thành manager ở mọi màn hình nhưng bị route assign từ chối với "That person cannot be assigned leads."
- **Sửa**: tách thành `canBeAssignedLead(target)` trong `src/lib/leads/assign-target.ts`, đọc cờ admin y hệt mọi chỗ khác. 5 test, gồm đúng ca gây lỗi.
- **Lưu ý về hình dạng dữ liệu**: `UserAccess` trả `legacyRole`, không phải `role` — hàm nhận thẳng kiểu đó thay vì bắt route tự map, để không có lớp chuyển đổi nào để làm sai.

### Gộp luật năng lực về một nơi
- **Vấn đề**: `LeadTable.tsx` tự viết lại luật "lead này sửa được không" — bản chép tay thứ hai của cùng một quy tắc. Module này đã trôi lệch vì copy helper ít nhất ba lần (scope table config, find-or-create event, truy vấn từ vựng).
- **Sửa**: `src/lib/leads/capabilities.ts` với `resolveLeadCapabilities(actor, lead, flags)` → `{ canView, canEdit, canLog, canAssign }`. Hai route per-lead và cả client cùng gọi. Đúng cách Task làm với `resolveTaskCapabilities`.
- **Client không dựng được `LeadActor`** (nó chỉ có danh sách owner đã giải sẵn từ server), nên có thêm `leadIsInScope(lead, ownerEmails)` **đặt cạnh** resolver, kèm test khẳng định hai đường cho **cùng kết quả**. Lệch nhau là fail, không phải âm thầm.

### Rollout cấp quyền (CHƯA CHẠY — cần chạy tay)
- `supabase/rollouts/2026-09-01-lead-role-grants.sql`: chỉ `Admin` giữ `lead.manage`; **mọi role còn lại** nhận `lead.work`. Cấp theo "trừ Admin" chứ không liệt kê tên role, để role thêm sau này không âm thầm bị bỏ sót.
- Cũng **thu lại** `lead.manage` ở role nào bị cấp nhầm, và cấp thêm `lead.work` cho `Admin` — vì `fetchLeadAssignees()` đọc thẳng `role_permissions`, thiếu dòng đó thì một admin không xuất hiện trong dropdown gán của chính mình.
- **Đã kiểm trên PostgreSQL 16 thật** với bản sao hiện trạng production (chỉ Admin có quyền) cộng một role bị cấp nhầm `lead.manage`: chạy lần 1 ra 3 cột `ok`, `Sub Admin` bị thu `lead.manage` và nhận `lead.work`, chạy lần 2 là no-op.
- **Đã kiểm dữ liệu thật**: 11 tài khoản assistant đều có role và đang hoạt động (10 × `Task CS`, 1 × `Admin Health Task`), 6 tài khoản agent cũng vậy. Sau khi chạy rollout **không ai bị kẹt ngoài cổng** vì thiếu role.
- **Trước khi chạy**: đúng 3 người dùng được module và dropdown gán chỉ có 3 lựa chọn.

### Còn treo
- `lead.export` vẫn là **quyền chết** — chỉ xuất hiện ở khai báo hằng số và test hằng số, không route nào đọc, module Lead không có tính năng export. Bỏ hay làm thật là hai đường ngược nhau nên chưa tự quyết (Task 3 trong plan).
- `canLogInteraction` vẫn không cho admin ghi tương tác lên lead không phải của mình — cố ý, vì bộ đếm liên hệ thuộc về agent được gán (QĐ4 trong plan).

- **Kiểm chứng**: `npm run test:run` 125 files / **901 tests** (thêm 5 test assign-target, 9 test capabilities); typecheck, lint, build sạch.

## 2026-09-01 — Sửa giá trị ngay trên bảng Lead + RBAC theo assistant membership

- **Loại**: feature + fix (RBAC)

### Sửa tại chỗ trong bảng
- **Cái gì**: ô trong bảng Lead nay sửa được trực tiếp như bên Task: Phone, Email, Event, Follow up, Product, Status, Assigned to, và **mọi cột tuỳ biến** (text/number/date/checkbox/dropdown/link/person).
- **Dùng lại `EditableCustomCell`** ở `_shared/` — đúng component Task đang dùng cho cột tuỳ biến. Không viết bản thứ hai.
- **Name vẫn là link mở lead**, không sửa tại chỗ — giống cột summary bên Task: tiêu đề dòng là chỗ để mở bản ghi.
- **Không sửa được**: Key, Attempts, Last contact, Imported, Interaction history. Bốn cột đếm liên hệ chỉ do `log_lead_interaction_atomic` ghi; sửa tay là phá đúng cái mà engine cảnh báo đọc.
- **Endpoint mới `PATCH /api/leads/[id]`** — trước đây **không hề có** route sửa lead. Nhận đúng 6 cột cộng `event_name` và `custom_values`; **key lạ thì từ chối** chứ không bỏ qua, vì bỏ qua sẽ làm một cái gõ nhầm trông như đã lưu thành công.
- **Status inline giữ đúng ràng buộc của RPC**: chọn một status `scheduled` mà lead chưa có ngày follow-up thì bị từ chối kèm lời nhắc mở lead ra ghi; chọn status không phải `scheduled` thì **xoá** follow-up đang treo — nếu không, một lead đã Won vẫn nằm trong cảnh báo "quá hạn gọi lại" cho một cuộc gọi không ai còn nợ.
- **Assign inline đi qua `/api/leads/assign`** để vẫn ghi lịch sử giao việc, không ghi thẳng cột.
- **Optimistic + rollback**: ô đổi ngay, hỏng thì trả lại giá trị cũ **và** hiện lý do. Revert im lặng trông như app tự ý vứt cái người ta vừa gõ.

### Sửa kèm — cột Event đang hiện UUID
- `leads.event_id` là uuid trỏ sang `lead_events`, nhưng bảng render thẳng `lead.event_id`. Nghĩa là **cột Event hiện UUID thô**, và bộ lọc Event tao làm hôm qua liệt kê UUID làm lựa chọn, sort Event thì sort theo UUID.
- Sửa: nhúng `lead_events(name)` vào truy vấn danh sách, thêm `event_name` vào `LeadRow`; bảng, sort và filter đều dùng tên. `LeadFilters.eventId` đổi thành `eventName`.

### RBAC — trả lời thẳng: trước đó **chưa có**
- **Trạng thái cũ**: manager (`lead.manage`) thấy và sửa tất cả; worker chỉ thấy và sửa lead gán **đúng email mình**. Assistant membership **không được nhắc tới ở đâu** trong module Lead, và account-role admin không có đường nào ngoài việc được cấp `lead.manage`.
- **Nay**: một lead thuộc về agent được gán, và **assistant của agent đó** làm việc trên lead của họ — đúng cặp agent/assistant mà Task đang dùng, đọc từ **cùng bảng `agent_members`**, qua chính `isAgentOwnerOrAssistant` và `fetchAssistantAgentsForCs` của Task. Không tạo bảng thứ hai, không chép lại truy vấn: một sơ đồ tổ chức, hai module đọc.
- **Account-role admin** (`role = 'admin'` hoặc role RBAC Admin/Super Admin) nay là lead manager mà không cần cấp riêng `lead.manage`. Cổng route vẫn đòi một trong hai quyền lead, nên đây là mở rộng *làm được gì sau khi vào*, không phải mở rộng *ai được vào*.
- **Danh sách cũng theo scope đó**: `buildLeadListFilter.assignedTo` (một email, `.eq`) đổi thành `ownerEmails` (danh sách, `.in`) — một assistant thấy hàng của agent mình. `null` = manager, không lọc; mảng rỗng sẽ có nghĩa là "không dòng nào", nên hai thứ không thể dùng chung một biểu diễn.
- **Fail-closed**: `fetchAssistantAgentsForCs` cố tình *throw* khi query hỏng (Task đã học bài này: nuốt lỗi ở đây từng biến một assistant thành người thấy toàn bộ task công ty). Lead dùng lại nguyên hành vi đó. Và cờ membership **chỉ nới ra**: người không có quyền lead nào thì cờ bật cũng vẫn bị chặn — có test.
- **Client đọc cùng một kết quả**: server giải `ownerEmails` một lần rồi truyền xuống, bảng và modal dùng nó để quyết ô nào sửa được. Vẽ một ô sửa được mà API sẽ từ chối còn tệ hơn để read-only: lưu hỏng *sau khi* giá trị đã trông như đã đổi.
- **Ghi tương tác**: assistant ghi được trên lead của agent mình. Quyền sở hữu không đổi, nên bộ đếm liên hệ vẫn thuộc về agent được gán.

- **Kiểm chứng**: `npm run test:run` 123 files / **887 tests** (thêm 7 test `buildLeadPatch`, 6 test RBAC/assistant, 3 test scope danh sách); typecheck, lint, build sạch.

## 2026-09-01 — Sidebar: vào /leads/config là mất đường quay lại danh sách

- **Loại**: fix (bug điều hướng)
- **Triệu chứng**: đứng ở `/leads/config` thì không bấm lại được vào Event Leads.
- **Nguyên nhân**: `isActiveItem` coi một mục là active khi `pathname === activePath` **hoặc** `pathname.startsWith(activePath + "/")`. Ở `/leads/config`, điều kiện thứ hai làm **Event Leads** (`activePath: "/leads"`) cũng thành active. Mà mục active được render bằng `<span>` chứ không phải `<Link>` — nên nó thành chữ chết. Sidebar mất luôn đường về danh sách.
- **Vì sao chỉ Lead dính**: đây là cặp menu duy nhất có một route **lồng dưới** route của mục khác. `/tasks` và `/config` là hai tiền tố rời; hai mục Enrollment cùng `activePath: "/enrollment"` và phân biệt bằng `activeQuery`.
- **Sửa**: mục nào khớp **cụ thể hơn** thì thắng. Trước khi coi một mục là active, kiểm xem có mục lá nào khác có `activePath` dài hơn mà cũng khớp `pathname` không; có thì mục hiện tại nhường. Quy tắc chung, không cần bôi riêng cho Lead.
- **Test hồi quy**: `src/app/(authed)/_components/sidebar-active.test.ts` — 4 test, gồm ca "đứng ở /leads/config thì Event Leads vẫn phải là link". Viết dưới dạng hàm thuần vì suite chạy môi trường node, không có DOM để render `.tsx`.
- **Kiểm chứng**: `npm run test:run` 122 files / **872 tests**; typecheck, lint, build sạch.

## 2026-09-01 — Gộp hai bộ status của Lead thành một

- **Loại**: schema + fix (bug hiển thị)
- **Vì sao**: `lead_statuses` tách theo product, nhưng cả hai bộ được seed **đúng bảy nhãn giống hệt nhau** và chưa bao giờ có gì làm chúng khác đi. Một status là một giai đoạn của cuộc gọi điện — nó không đổi vì hợp đồng phía sau là Health hay P&C.
- **Bug đi kèm**: ô chọn status trong khung ghi tương tác render **toàn bộ** `statuses` chứ không lọc theo product của lead, nên mỗi lead hiện 14 lựa chọn với hai "New", hai "Working"... Bộ lọc Status ngoài danh sách cũng phải gắn hậu tố `(P&C)` / `(Health)` để phân biệt hai dòng trùng chữ. Gộp lại là hết cả hai.
- **Migration** (mục **2b** trong `2026-08-31-lead-final.sql`): gom các nhãn trùng về dòng có `position` nhỏ nhất, trỏ lại `leads.status_id` **và** `lead_interactions.status_id`, xoá dòng thừa, rồi `drop column product`. Chỉ gom các dòng đang active — status đã archive nằm ngoài unique index từng phần và vẫn còn lead cũ trỏ vào, nên để nguyên. FK là `ON DELETE RESTRICT` nên nếu sót một tham chiếu thì lỗi nổ ngay chứ không âm thầm mồ côi.
- **Nếu admin đã đổi tên riêng một bên** (ví dụ đổi "New" của P&C thành "New PC") thì hai nhãn khác nhau, không gom — cả hai cùng tồn tại trong một danh sách. Đúng: lúc đó chúng thật sự là hai status khác nhau.
- **Đã kiểm trên PostgreSQL 16 thật**, ba kịch bản: (1) DB trắng → 9 cột verify đều `ok`; (2) DB dựng lại từ schema + rollout **cũ** rồi chạy rollout mới → 14 status còn 7, lead Health đang ở "Working" và interaction P&C đang ở "Won" đều trỏ đúng sang dòng còn lại, status đã archive vẫn nguyên; (3) chạy lại lần hai → no-op. Sau đó `lead-sample-data.sql` (có gọi RPC ghi tương tác) chạy sạch, ra 30 lead đúng status.
- **RPC cũng phải sửa**: `log_lead_interaction_atomic` có `and st.product = lead_value.product` khi kiểm status — bỏ đi, nếu không mọi lần ghi tương tác đều `LEAD_STATUS_NOT_FOUND`. Chỗ này chỉ lộ ra khi chạy sample data trên DB đã gộp, không phải từ đọc code.
- **Code**: bỏ `product` khỏi type `LeadStatus`, khỏi mọi câu `select`, khỏi `validateStatusInput`, khỏi hai truy vấn status trong route tạo lead và route overview. Config còn **một** nhóm `Status` thay vì `Status (P&C)` + `Status (Health)`.
- **Tương thích ngược**: `validateStatusInput` giờ **bỏ qua** field `product` thừa thay vì báo lỗi, để client cũ gửi kèm vẫn chạy. Test cũ khẳng định ngược lại đã được thay kèm ghi chú.
- **Cần chạy lại `supabase/rollouts/2026-08-31-lead-final.sql`**.
- **Kiểm chứng**: typecheck, lint, `npm run build`, `npm run test:run` 121 files / 868 tests — sạch.

## 2026-09-01 — Modal chi tiết Lead: bổ sung các trường bị thiếu

- **Loại**: fix (thiếu thông tin) + UI
- **Vấn đề**: modal chi tiết chỉ hiện Status, Assigned to, Attempts, Last contact, Follow-up. Số điện thoại và email bị nhồi vào một dòng phụ màu xám, và **9 trường có thật trong `LeadRow` không hiện ở đâu cả**.
- **Đã thêm — cột trái**: Phone và Email thành field có nhãn (bấm được: `tel:` / `mailto:`), và **Event** — modal trước đó không nói lead này đến từ sự kiện nào, trong khi đó là lý do tồn tại của bảng.
- **Đã thêm — rail phải**: **Product** (badge, lấy màu từ config như ngoài bảng), **Assigned by** + **Assigned at** (ai giao và giao lúc nào — module này sinh ra để quy trách nhiệm giao lead, mà trước đó modal chỉ hiện người nhận), **First contact**, **Closed** (chỉ hiện khi lead đã đóng), **Imported by** + **Imported at**, **Last edited by** + **Last edited at**.
- **Chia nhóm bằng đường kẻ**: workflow (product/status/người) — tiến trình liên hệ — lịch sử bản ghi. Mười mấy field xếp thẳng một cột thì không ai đọc.
- **Tên người thay vì email**: modal nhận `nameByEmail` từ danh sách và truyền vào `personLabel(email, nameByEmail)`. Trước đó nó gọi `personLabel(email)` không map nên luôn rơi về bản suy ra từ email, kể cả khi tài khoản đã có tên thật.
- **Kiểm chứng**: typecheck, lint, `npm run build`, `npm run test:run` 121 files / 868 tests — sạch.

## 2026-09-01 — Mọi dropdown value của Lead về chung một chỗ: Lead Table Config → Values

- **Loại**: feature + chore (dọn chỗ ở của dữ liệu cấu hình)
- **Vấn đề**: "dropdown value" của Lead nằm ở ba nơi khác nhau. Status và Interaction type có CRUD đầy đủ nhưng ở màn **Settings**, với `<input type="color">` trần. Product là dropdown nhưng **không có giá trị nào cả**. Còn tab Values của Lead Table Config thì rỗng. Một admin muốn đổi màu một badge không có cách nào đoán ra phải mở màn nào.
- **Cái gì**: tab **Values** của Lead Table Config nay có đủ 4 nhóm — `Status (P&C)`, `Status (Health)`, `Interaction type`, `Product` — dùng đúng bảng, đúng ô chọn màu và đúng luồng archive như CS/Enrollment.
- **Settings không còn editor thứ hai**: hai UI cùng ghi một bảng chính là cách hai danh sách trôi khỏi nhau. Chỗ cũ giờ là một dòng trỏ sang Lead Table Config.
- **Status giữ trường `kind`** (Open/Scheduled/Won/Lost) và **Interaction type giữ `counts_as_contact`** ngay trong bảng — chúng không phải trang trí: Won/Lost tắt engine nhắc việc, và `counts_as_contact` quyết định một lần ghi nhật ký có xoá cảnh báo "chưa liên hệ" hay không.
- **Product: màu sửa được, tập giá trị thì không**. Rollout seed hai `table_column_option` cho cột `product` ("P&C" #4c9aff, "Health" #36b37e) và ô Product trong bảng lead nay là badge lấy màu từ đó. Nhưng tập giá trị bị ghim bởi CHECK `leads.product`, nên màn Config **khoá label và không cho thêm/archive**: label chính là khoá mà ô badge join vào để tìm màu, đổi tên là badge âm thầm rơi về màu băm; thêm giá trị thứ ba thì không lead nào khớp được. Đây đúng cách Enrollment đang bảo vệ Stage/Consent.
- **Sửa kèm — cột Product hiện "—" ở mọi dòng**: `leadColumnValue` không có nhánh cho key `product` nên rơi vào `default:` đọc `custom_values.product` (không tồn tại). Nay render `P&C` / `Health`.
- **Một hàm đọc từ vựng duy nhất**: `fetchLeadVocabulary()` trong `src/lib/leads/queries.ts`. Trước đó ba nơi (trang list, route API, giờ thêm trang config) mỗi nơi tự chép danh sách cột và thứ tự sắp — đúng kiểu trôi lệch mà module này đã dính vài lần.
- **DB**: `2026-08-31-lead-final.sql` thêm mục **8b** seed hai giá trị Product (idempotent, không ghi đè lựa chọn của admin) và một cột kiểm chứng `product_values`. **Cần chạy lại file này** thì badge Product mới có màu từ config; chưa chạy thì badge vẫn hiện, dùng màu băm dự phòng.
- **Kiểm chứng**: typecheck, lint, `npm run build`, `npm run test:run` 121 files / 868 tests — tất cả sạch.

## 2026-09-01 — Lead: tìm kiếm, bộ lọc và sắp xếp theo header

- **Loại**: feature
- **Cái gì**: danh sách Event Leads nay có ô tìm kiếm, 4 bộ lọc (Assignee / Status / Product / Event) và bấm header cột để sắp xếp — cùng cách làm với Task Management.
- **Lọc và sắp xếp chạy ở client**: `fetchAllLeads` vốn đã phân trang cho tới hết, nên trình duyệt đang giữ **toàn bộ** lead. Gọi lại server chỉ để lọc một tập đã nằm trong bộ nhớ là thêm một vòng mạng cho một câu trả lời đã có sẵn. Đây cũng đúng cách `sortTasks` làm bên Task.
- **Tìm kiếm** (`matchesLeadSearch`): khớp tên, email, và số điện thoại **theo chữ số** — gõ `714-555` tìm được số lưu là `7145550123`, vì số điện thoại là thứ người ta dán vào theo đủ mọi định dạng. Gõ `unassigned` tìm được lead chưa giao. Yêu cầu tối thiểu 3 chữ số để một query chữ không vô tình quét cả bảng số.
- **`""` là sentinel "chưa giao", không phải "không lọc"**: `filterLeads` so `assignedTo !== null` chứ không dùng truthiness. Một `if (filters.assignedTo)` sẽ im lặng bỏ qua lựa chọn "Unassigned" — lỗi này đã bị test bắt trước khi lên UI. Vì `TaskSelect` là single-value nên UI dùng `"__all__"` cho "không lọc", tránh đụng sentinel đó.
- **Status có gắn hậu tố sản phẩm khi trùng tên**: status là per-product, hai sản phẩm cùng có "New". Để trần thì chọn một cái sẽ âm thầm giấu hết lead của sản phẩm kia dưới đúng một chữ. Hậu tố chỉ hiện ở chỗ va chạm thật.
- **Sắp xếp** (`sortLeads`): 12 cột. So sánh theo **chữ hiển thị** (tên người, nhãn status, tên event) chứ không theo id thô — sắp xếp mà không khớp thứ tự mắt đọc thì vô nghĩa. Ô trống luôn **xuống cuối ở cả hai chiều**, giống `sortTasks`: lý do người ta sort theo "Last contact" là để tìm lead *có* liên hệ, không phải để lật một khối trống lên đầu. Hoà thì phá hoà bằng `display_number` nên thứ tự không nhảy giữa các lần render.
- **Cột tuỳ biến không sort được**: chỉ 12 key mà `sortValue()` biết cách so mới thành nút; cột do admin thêm chứa thứ gì tuỳ họ, không có thứ tự nào để hứa.
- **Checkbox "chọn tất cả" theo danh sách đang thấy**: trước đây nó chọn `leads` (toàn bộ dữ liệu). Sau khi có lọc, "tất cả" phải là những dòng trên màn hình, nếu không một cú bấm sẽ giao cả những lead người dùng vừa lọc ra ngoài.
- **Sửa kèm — cột Product hiện "—" ở mọi dòng**: khi gộp hai màn hình, cột `product` được thêm vào cấu hình nhưng `leadColumnValue` không có nhánh nào cho nó, nên rơi vào `default:` đọc `custom_values.product` (không tồn tại). Nay render `P&C` / `Health`.
- **Kiểm chứng**: 18 test mới (`sorting.test.ts` 7, `filtering.test.ts` 11); `npm run test:run` 121 files / **868 tests**; typecheck, lint, `npm run build` sạch.

## 2026-08-31 — Gộp toàn bộ rollout Lead thành một file final
- **Loại**: chore (dọn dẹp), không đổi hành vi
- **Vì sao**: Lead Management đã tích 9 file rollout rời trong 4 ngày. Khó biết file nào đã chạy, dễ chạy sót, và thứ tự giữa chúng có ràng buộc ngầm (file 8 định nghĩa lại hàm mà file 6 tạo ra). Đó là cách sinh lỗi chứ không phải cách quản lý schema.
- **Cái gì**: một file duy nhất `supabase/rollouts/2026-08-31-lead-final.sql` mô tả **trạng thái cuối** của toàn bộ hệ Lead: bảng, index, từ vựng seed, index tên sự kiện, RPC ghi tương tác, `is_table_scope` + hai RPC ghi của table-config, ràng buộc scope, retire hai scope lead cũ, seed 14 cột của scope `lead`, permission, và màu badge. Kèm một khối kiểm chứng 8 cột, tất cả phải đọc `ok`.
- **Idempotent và hội tụ từ mọi trạng thái**: đã kiểm ba kịch bản trên PostgreSQL 16 — (1) DB chưa từng biết Lead, (2) chạy lại lần hai, (3) DB dở dang giống production: scope cũ chưa archive, từ vựng chưa màu, `event` còn là `dropdown`, hai sự kiện trùng tên. Cả ba đều ra 8 cột `ok`, và sau đó `reorder_table_columns_atomic('lead', ...)` chạy được, hai sự kiện trùng gom còn một.
- **Không còn phụ thuộc vào việc mở trang**: trước đây 14 cột của scope `lead` do `ensureTableColumns()` tạo khi ai đó vào `/leads`. Nay file SQL tự seed — một database không nên cần người mở màn hình mới trở nên đúng.
- **Đã xoá 9 file bị thay thế**, liệt kê ngay trong header của file final để còn tra được.
- **Giữ riêng**: `2026-08-27-fix-patch-task-atomic-ambiguity.sql` (nhánh `fix/...`) vì đó là lỗi của Task, không thuộc hệ Lead.
- **Kiểm chứng**: `npm run test:run` 119 files / 850 tests; typecheck + lint sạch; `schema.sql` nạp 0 lỗi.

## 2026-08-31 — "No leads match the current filters" sau khi gộp màn hình
- **Loại**: fix (bug)
- **Cái gì**: `buildLeadListFilter` dùng `toLeadProduct(params.product)`. Helper đó **rơi về `"pc"`** cho mọi giá trị không nhận diện được — đúng cho một URL có nêu product, nhưng sai ở đây, nơi "không nêu product" nghĩa là "cho xem hết". Sau khi gộp thành một màn, trang không truyền product nữa → lọc thành P&C → 30 lead pilot đều là Health → danh sách rỗng.
- **Sửa**: `filter.product` thành `LeadProduct | null`, dùng `isLeadProduct` (không có fallback) thay `toLeadProduct`, và `.eq("product", ...)` chỉ áp khi có giá trị. Truy vấn status kết thúc cũng bỏ lọc theo product vì danh sách giờ trộn cả hai.
- **Test hồi quy**: không truyền product / truyền chuỗi rỗng / truyền giá trị lạ đều phải cho `null`. Test cũ khẳng định ngược lại (`"banana"` → `"pc"`) đã được thay, kèm ghi chú vì sao nó bị thay.
- **Dữ liệu không mất**: 30 lead vẫn nguyên trong DB, không cái nào archived. Đây thuần là lỗi lọc.
- **Kiểm chứng**: `npm run test:run` 119 files / **850 tests**; typecheck + lint sạch.

## 2026-08-31 — Gộp Health Leads + P&C Leads thành một màn Event Leads
- **Loại**: feature
- **Cái gì**: hai màn hình tách theo sản phẩm nay là **một danh sách Event Leads** với **cột Product** dạng badge. Sidebar còn một mục. `?product=` trở thành **bộ lọc** người dùng bỏ được, không còn là hai màn riêng.
- **Dữ liệu không phải di trú**: `leads` vốn luôn là một bảng có cột `product` — chỉ giao diện và scope config bị tách. Đúng phương án đề xuất ban đầu ngày 27/08, khi đó chọn tách; nay gộp lại.
- **Hai scope `lead_pc`/`lead_health` gộp thành `lead`.** Cấu hình cột cũ được **archive chứ không xoá** — đó là dấu vết cách hai màn từng được cấu hình, và không màn nào đọc cột đã archive. `custom_values` độc lập với scope nên giá trị nhập dưới `lead_pc` vẫn đọc lại được dưới scope mới. Ràng buộc CHECK giữ lại giá trị cũ để các dòng đã archive còn hợp lệ; chỉ ứng dụng và `is_table_scope` ngừng chấp nhận chúng.
- **Status vẫn tách theo product** — luồng P&C và Health khác nhau thật. Client chọn đúng danh sách theo product của từng lead.
- **Màu Product cố định, không cấu hình được**: product là dữ kiện hệ thống chứ không phải từ vựng do admin soạn, nên hai giá trị phải trông giống nhau ở mọi cài đặt.
- **Sửa kèm hai chỗ dễ lệch**: hai mảng scope chép tay trong `queries.ts` nay lấy thẳng từ `TABLE_SCOPES` — đó chính là cách `lead_pc`/`lead_health` từng lệch khỏi nguồn gốc. Và khôi phục cột `interactionHistory` mà em vô tình xoá khi gộp.
- **Kiểm chứng**: rollout chạy trên PostgreSQL 16 — 0 cột hoạt động còn trên scope cũ, `is_table_scope('lead')` đúng, hai scope cũ bị từ chối, **đổi thứ tự cột trên scope `lead` chạy được**, chạy lần hai 0 lỗi, `schema.sql` nạp 0 lỗi. `npm run test:run` 119 files / 848 tests.

## 2026-08-31 — Lịch sử tương tác: mỗi loại một badge màu
- **Loại**: fix (UI)
- **Cái gì**: dòng lịch sử trước đây là chữ thuần `[Call] · No answer · email · 2h ago`. Nay loại tương tác và kết quả đều là **badge chữ nhật có nền màu**, lấy màu qua `taskCategoryBadgePalette` — cùng bảng màu và cùng công thức chọn màu chữ dễ đọc mà category của Task đang dùng. Người thực hiện hiện tên thay vì email thô.
- **Màu đặt có chủ đích, không để hash ngẫu nhiên**: cả hai bảng từ vựng vốn seed `color = NULL`, khiến badge rơi vào nhánh dự phòng băm từ uuid — ổn định nhưng tuỳ tiện, hai loại có thể trùng màu và `Note` có khi trông gấp gáp hơn `Call`. Rollout gán: Call xanh dương, Text xanh lá, Email tím, **Note xám** — xám có lý do: đây là loại duy nhất không tính là đã liên hệ, nên không nên trông giống việc đã đẩy lead tiến lên.
- **Không ghi đè lựa chọn của admin**: rollout chỉ điền vào ô còn `NULL`. Đã kiểm bằng cách đặt sẵn `#123456` cho một status rồi chạy — giá trị đó giữ nguyên.
- **Kiểm chứng**: `npm run test:run` 119 files / **849 tests**; typecheck + lint sạch.

## 2026-08-31 — "Invalid column order": hai RPC vẫn chốt cứng 3 scope cũ
- **Loại**: fix (bug)
- **Cái gì**: đổi vị trí cột ở Lead Table Configuration luôn báo `Invalid column order`. Nguyên nhân: `reorder_table_columns_atomic` mở đầu bằng `if p_scope not in ('cs','aca','medicare') then raise COLUMN_ORDER_INVALID`. Thứ tự cột hoàn toàn hợp lệ — **scope mới bị từ chối**, nhưng thông báo lại nói về thứ tự nên rất khó lần ra.
- **Cùng bệnh ở `table_config_write_context`** (`WRITE_CONTEXT_SCOPE_INVALID`). Hàm này gác luồng ghi của tasks và enrollment nên chưa ảnh hưởng lead, nhưng là cùng cái bẫy nên sửa luôn.
- **Sửa tận gốc**: thêm `is_table_scope(text)` — **một** danh sách scope duy nhất, cả hai RPC gọi vào đó. Thêm scope lần sau chỉ sửa một chỗ, thay vì phải lùng mọi hàm tình cờ có tự kiểm tra scope. Đây là lần thứ hai cùng loại lỗi: lần trước là ba ràng buộc CHECK, lần này là hai RPC.
- **Kiểm chứng**: dựng PostgreSQL 16, nạp schema **cũ**, đổi thứ tự cột scope `lead_pc` → tái hiện đúng `COLUMN_ORDER_INVALID`; chạy rollout → đổi được, vị trí thật sự hoán đổi; chạy lần hai 0 lỗi; `schema.sql` nạp 0 lỗi. `npm run test:run` 119 files / 847 tests.

## 2026-08-31 — Ô ghi tương tác bị khoá nói rõ lý do thay vì trông như hỏng
- **Loại**: fix (UX)
- **Cái gì**: khi người xem không phải người đang giữ lead, `InteractionLog` trước đây vẫn vẽ đủ form nhưng `disabled` cả hai dropdown, kèm một dòng chữ xám nhỏ ở góc. Nhìn y hệt màn hình hỏng — và đã bị báo là hỏng. Nay thay hẳn form bằng câu giải thích: ai đang giữ lead, và làm gì tiếp (manager chuyển tay từ danh sách Leads; hoặc lead chưa giao thì giao trước).
- **Luật không đổi**: chỉ người đang giữ lead mới ghi được tương tác. Nhật ký là lời khai của người đã gọi; nó nuôi `contact_attempt_count` và mọi đồng hồ cảnh báo, nên người khác ghi hộ sẽ làm sai căn cứ đánh giá.
- **Kiểm chứng**: `npm run test:run` 119 files / 847 tests; typecheck + lint sạch.

## 2026-08-31 — Đồng bộ giao diện Lead với Task Management
- **Loại**: fix (UI)
- **Cái gì**:
  - **Modal chi tiết lead dùng đúng khung của `TaskDetailDrawer`**: hộp thoại giữa màn hình (`max-w-4xl`, `max-h-[760px]`), hai cột `[minmax(0,1fr)_280px]` — nội dung bên trái, thông tin phụ ở rail phải nền `#f7f8fa` — thay cho panel trượt phải `max-w-2xl` trước đó. Mỗi cột tự cuộn trên màn rộng, đúng lý do Task làm vậy: giữ ô soạn tương tác luôn đứng đáy dù lịch sử dài bao nhiêu. Nhấp nền để đóng, `role="dialog"`, `aria-modal`.
  - **Người phụ trách hiện avatar chữ cái + tên** (`Initials` dùng chung của board Task, màu nền băm từ email nên mỗi người một màu cố định) thay vì email thô. Áp cho bảng Leads, modal chi tiết và bảng Agent trong Overview.
  - **Status là badge có màu nền**, lấy màu qua `taskCategoryBadgePalette` — cùng bảng màu và cùng công thức chọn màu chữ dễ đọc mà category của Task đang dùng. Màu do admin đặt trong `lead_statuses.color`.
  - **Key đổi từ `#1` thành `LD1`**, có helper `leadDisplayKey` riêng, đặt cạnh `taskDisplayKey` (`CS-123`) và `enrollmentDisplayKey` (`ACA-123`). Lưu ý: không có dấu gạch nối, theo đúng dạng đã yêu cầu.
- **Kiểm chứng**: `npm run test:run` 119 files / **847 tests**; typecheck + lint sạch.

## 2026-08-31 — Event gõ tự do (tự tạo sự kiện), Status khoá ở New khi tạo lead
- **Loại**: feature, fix
- **Cái gì**:
  - **Event thành ô gõ tự do, hệ thống tự tìm hoặc tạo sự kiện.** Trước đây phải tạo sự kiện trước rồi mới chọn từ danh sách. Nay gõ tên: trùng tên (không phân biệt hoa thường và khoảng trắng thừa) thì khớp vào sự kiện cũ, tên mới thì tự tạo. Ô nhập có `datalist` gợi ý các sự kiện đã có.
  - **`leads.event_id` vẫn là khoá ngoại.** Đó là thứ giữ cho báo cáo theo sự kiện ở Overview còn đúng: lead nhóm theo *một dòng*, không theo chuỗi chữ đã gõ. Nếu để text thuần thì "Health Fair" và "health fair " thành hai sự kiện khác nhau trong báo cáo.
  - **Index duy nhất `lead_events (lower(btrim(name)))`** — đây là thứ làm "tìm-hoặc-tạo" an toàn. Thiếu nó, hai người đặt tên cùng lúc sẽ tạo hai dòng và báo cáo tách một sự kiện làm đôi. Rollout gom luôn các bản trùng có sẵn về dòng sớm nhất rồi mới tạo index.
  - **Cột `event` trả về kiểu `text`**, huỷ bỏ `2026-08-31-lead-event-column-type.sql` (từng đổi sang `dropdown`). Giờ người dùng thật sự gõ vào đó nên `text` mới đúng.
  - **Status khoá ở "New" khi tạo lead**, không cho chọn. Chọn theo `kind === "open"` đầu tiên theo position chứ không theo nhãn "New", vì admin đổi tên được. Cùng nguyên tắc sếp đã chốt cho Enrollment ("stage cố định khi tạo, đổi thì sau"). Lý do: status phải dịch chuyển khi có người ghi nhận tương tác — cho phép đặt "Won" ngay lúc tạo sẽ sinh ra lead đã đóng mà không có cuộc gọi nào phía sau, làm hỏng cả bộ đếm lẫn đồng hồ cảnh báo.
- **Kiểm chứng**: rollout chạy trên PostgreSQL 16 — `schema.sql` nạp 0 lỗi, cột về `text`, index tạo được, **lead trỏ vào bản trùng được gom đúng về sự kiện gốc**, chạy lần hai 0 lỗi. `npm run test:run` 118 files / **845 tests**; typecheck + lint sạch.

## 2026-08-31 — Assign to thành dropdown agent, Event khai đúng kiểu
- **Loại**: fix
- **Cái gì**:
  - **Modal tạo lead: "Assign to" từ ô nhập email tự do thành dropdown danh sách agent**, giống cách Task Management chọn người. Danh sách lấy từ `fetchLeadAssignees()` (tài khoản đang hoạt động có `lead.work`/`lead.manage`) và chỉ nạp cho manager. Trước đó thanh giao lead hàng loạt đã là dropdown, nhưng modal tạo thì vẫn là `<input type="email">` — hai chỗ làm cùng một việc theo hai kiểu.
  - **Cột Event khai `text` nhưng render `<select>`.** `leads.event_id` là khoá ngoại tới `lead_events` nên bắt buộc chọn từ danh sách, không gõ tay được — khai `text` khiến Config Table nói sai về bản chất trường đó. Đổi thành `dropdown`, đúng tiền lệ của Enrollment: `stage`, `carrier`, `platform` đều khai `dropdown` dù lựa chọn đến từ `enrollment_options` chứ không phải `table_column_option`.
- **Audit 12 cột lead**: đã soát kiểu khai báo với control thật sự render. `event` là chỗ lệch duy nhất; `assignee` khai `person` và giờ đã là dropdown người, `status` khai `dropdown` render select, các cột `date`/`number` đều chỉ hiển thị.
- **Rollout `2026-08-31-lead-event-column-type.sql`**: `ensureTableColumns()` không ghi đè cột đã tồn tại, nên sửa mặc định trong code không đổi được cột đang chạy.
- **Kiểm chứng**: rollout chạy trên PostgreSQL 16 — `UPDATE 2`, cả hai scope thành `dropdown`, chạy lần hai 0 lỗi. `npm run test:run` 118 files / 842 tests; typecheck + lint sạch.

## 2026-08-31 — Thêm Secondary Phone và bật "In detail" cho cột lead
- **Loại**: feature, fix
- **Cái gì**:
  - **Secondary Phone** thành cột mặc định của cả `lead_pc` và `lead_health`. Cố ý để `is_system = false`: giá trị nằm trong `leads.custom_values` như mọi cột admin tự thêm, admin đổi tên hay archive được, và **modal tạo lead chỉ hiển thị cột không phải hệ thống** (`LeadAddDialog.tsx:117`). Khoá phải là `secondary_phone` — đúng `slugifyColumnKey("Secondary Phone")` — vì đó là khoá importer ghi và mọi màn hình đọc lại.
  - **`col()` nhận thêm tham số `showInDetail`.** Trước đó nó chốt cứng `show_in_detail: false` cho mọi cột của mọi scope, nên toàn bộ cột lead ra đời với cờ tắt. Nay 7 cột có ý nghĩa trong ô chi tiết (name, phone, email, assignee, status, followUp, event) mặc định bật.
  - **Drawer chi tiết lead giờ mới thật sự đọc cờ đó.** Trước đây nó không nhận prop `columns` nên `show_in_detail` là cờ vô nghĩa với lead — bật hay tắt cũng không đổi gì. Nay nhận `columns` + `columnOptions` và render các cột không phải hệ thống có cờ bật, dùng chung cách đọc `custom_values` với bảng danh sách.
  - **Rollout `2026-08-31-lead-detail-columns.sql`**: `ensureTableColumns()` chỉ **chèn** cột thiếu, không ghi đè cờ của cột đã tồn tại — nên 11 cột lead đã tạo trước đó sẽ mãi ở `false` nếu chỉ sửa mặc định trong code.
- **Kiểm chứng**: rollout chạy trên PostgreSQL 16 — cập nhật đúng 7 cột, chèn `secondary_phone` cho cả hai scope, chạy lần hai 0 lỗi. `npm run test:run` 118 files / 842 tests; typecheck + lint sạch.

## 2026-08-31 — Tách màn cấu hình bảng Lead ra riêng, sắp lại sidebar
- **Loại**: fix, feature
- **Cái gì**:
  - **Trang riêng `/leads/config`**. `ConfigClient` nhận thêm ba prop: `title`, `scopes`, `tabs`. `/config` giữ `cs`/`aca`/`medicare` và cả bốn tab; `/leads/config` chỉ có `lead_pc`/`lead_health` và hai tab Columns + Dropdown Values — lead không có Category, Assistant Membership hay SLA Times. Yêu cầu quyền `lead.manage`, không phải `task.manage`.
  - **Sửa luôn lỗi khoá chéo**: `columnsReady` trước đây quét **mọi** scope trong hệ thống, nên một scope mới chưa được tạo dữ liệu sẽ khoá ô soạn cột của **tất cả** scope khác. Đúng cái đã xảy ra: thêm scope Lead làm màn Health Table Configuration hiện "Table columns are using a migration fallback. Editing is disabled". Nay mỗi trang chỉ xét scope của chính nó.
  - **Sidebar theo thứ tự**: Task Management → Lead Management → Account Management. Nhóm "Management" đổi tên thành "Account Management". Thêm mục "Lead Table Configuration" vào nhóm Lead.
  - `emptyEnrollmentOptionData()` chuyển từ trong `/config/page.tsx` ra `config/empty-option-data.ts` để hai trang dùng chung thay vì chép lại.
- **Kiểm chứng**: `npm run test:run` 118 files / 842 tests; typecheck + lint sạch.

## 2026-08-31 — Import lead lưu cột phụ theo đúng khoá của Config Table
- **Loại**: fix (correctness)
- **Cái gì**: `parseLeadRows` lưu các cột Excel không được map vào `custom_values` theo **nguyên văn header** (`"Secondary Phone"`), trong khi cột do Config Table tạo luôn có khoá đã chuẩn hoá (`secondary_phone`) và mọi màn hình đọc `custom_values[column.key]`. Hệ quả: giá trị import vào nằm trong DB nhưng bảng hiện `—`. Nay dùng chung `slugifyColumnKey` với Config Table.
- **Vì sao gặp**: cần thêm trường "Secondary Phone". Không cần code cho bản thân trường đó — Config Table đã hỗ trợ scope `lead_pc`/`lead_health` nên admin tự thêm cột được. Nhưng nếu không sửa chỗ này thì cột thêm xong vẫn trống sau khi import.
- **Kiểm chứng**: `npm run test:run` 118 files / **842 tests** (thêm 2 test: header "Secondary Phone" phải thành `secondary_phone`, và cột đã map không được lọt vào custom_values); typecheck + lint sạch.

## 2026-08-31 — Chọn agent bằng dropdown thay vì gõ email, và hiện tên thay vì email
- **Loại**: fix (UX, data-integrity)
- **Cái gì**: thanh giao lead hàng loạt trước đây là ô nhập chữ tự do "Agent email to assign". Nay là dropdown có tìm kiếm (`TaskSelect`), nạp từ `fetchLeadAssignees()` — tài khoản đang hoạt động có `lead.work` hoặc `lead.manage`, đúng cách `fetchTaskAssignees()` bên Task lấy danh sách.
- **Vì sao**: server vốn đã chặn email không hợp lệ (`getUserAccessByEmail` + `isActive` + `isWorker`), nên gõ sai không mất lead — nhưng manager phải nhớ chính xác địa chỉ của ~50 agent rồi mới biết mình gõ sai. Dropdown làm sai sót đó không xảy ra được ngay từ đầu.
- **Chỉ manager mới nạp danh sách**: `page.tsx` gọi `fetchLeadAssignees()` có điều kiện `actor.isManager`. Agent không có nút giao lead nên nạp về là một truy vấn không dùng tới.
- **Không thêm mục "Unassigned" vào dropdown**: thanh công cụ đã có nút Unassign riêng; hai đường cho cùng một hành động khiến người dùng phân vân chúng có khác nhau không.
- **Hiện tên người, không hiện email thô**: cột Assignee trong bảng Leads và cột Agent trong Overview nay dùng `personLabel`, đúng quy ước đang áp dụng ở task board.
- **Kiểm chứng**: `npm run test:run` 118 files / 840 tests; typecheck + lint sạch.

## 2026-08-28 — Thiếu rollout nới ràng buộc scope cho table-config
- **Loại**: fix (bug production)
- **Cái gì**: `TABLE_SCOPES` trong `lib/table-config/types.ts` được thêm `lead_pc` và `lead_health`, nhưng **không rollout nào** nới ràng buộc CHECK tương ứng dưới DB. Lần đầu mở `/leads` là chết ngay ở `ensureTableColumns()`: `new row for relation "table_column" violates check constraint "table_column_scope_check"`.
- **Ba bảng cùng mang enum đó**: `table_column`, `user_table_layout`, `import_request`. Nới mỗi `table_column` thì lỗi chỉ dời sang màn hình nào ghi layout hoặc import request tiếp theo, nên sửa cả ba cùng lúc.
- **Kiểm chứng**: dựng PostgreSQL 16, nạp schema **cũ**, chèn `lead_pc` → tái hiện đúng nguyên văn lỗi; chạy rollout → chèn được; chạy rollout lần hai → 0 lỗi (idempotent).
- **Bài học**: đợt đối chiếu code với Supabase trước đó chỉ kiểm bảng, cột và RPC — **không kiểm ràng buộc CHECK**. Thêm enum ở TypeScript mà quên DB là loại lỗi typecheck không bắt được.

## 2026-08-28 — Sửa 2 lỗi và 1 bẫy trong Lead Management sau code review
- **Loại**: fix (correctness, reliability)
- **Cái gì**:
  - **Cờ "quá hẹn gọi lại" không bao giờ tắt** (`lib/leads/alerts.ts`): cờ chỉ so `next_follow_up_at < now`, trong khi RPC chỉ xoá trường đó khi lead đóng hoặc khi hẹn một giờ mới. Hệ quả: agent hứa gọi 3pm, gọi đúng hẹn, khách không bắt máy → **cờ đỏ sáng vĩnh viễn**, chỉ thoát được nếu hẹn lại hoặc đóng lead. Nay chỉ báo đỏ khi chưa có liên hệ nào **sau** giờ đã hẹn. Kiểm chứng bằng cách dựng PostgreSQL 16 và chạy đúng kịch bản đó.
  - **Overview tải toàn bộ lead không giới hạn** (`api/leads/overview/route.ts`): không `limit`, không `count`. PostgREST có trần số dòng và cắt bớt **không báo lỗi**, nên dashboard sẽ âm thầm báo thiếu — manager quyết định chuyển lead dựa trên con số đó. Nay đọc theo trang 1.000 dòng tới trần 20.000, trả cờ `truncated`, và UI hiện băng đỏ khi chạm trần. Đồng thời bỏ `custom_values` khỏi truy vấn tổng hợp (jsonb tuỳ ý × mọi lead chỉ để đếm cờ).
  - **Alias `lead` trùng tên OUT param `lead`** trong `log_lead_interaction_atomic`: chạy được chỉ vì OUT param là `jsonb` nên không phải composite. Đổi alias thành `l`. Repo vừa mất một ngày vì SQLSTATE 42702 do biến trùng tên cột (`patch_task_atomic`, 08/08) — không để lại cùng cái bẫy.
- **Không phải lỗi**: review ban đầu của em nghi route assign không kiểm email agent. **Sai** — `api/leads/assign/route.ts` đã kiểm bằng `getUserAccessByEmail` + `isActive` + `isWorker`. Chỉ còn điểm về trải nghiệm: ô nhập là chữ tự do thay vì danh sách chọn.
- **Kiểm chứng**: `npm run test:run` 117 files / **836 tests** (trước đó 834, thêm 2 test hồi quy cho cờ quá hẹn); typecheck + lint sạch. RPC nạp lại trên PostgreSQL 16 và chạy đúng: bộ đếm tăng, idempotency `t` rồi `f`.

## 2026-08-28 — Lead management: workflow hardening and complete module
- **Loại**: feature, security, data-integrity, reliability
- **Cái gì**: Hoàn thiện module Leads với RPC atomic ghi interaction và cập nhật counters/idempotency, quyền `lead.manage`/`lead.work`/`lead.export`, phân trang ghim ownership ở server, realtime và polling chỉ khi tab visible, import Excel có giới hạn/dedupe, giao lead có lịch sử, Overview/cờ theo ngưỡng product, và admin vocabulary có soft-archive. Bật RLS fail-closed cho cả 7 bảng Lead; RPC chỉ cho `service_role`, status interaction phải cùng product với lead. Alert filter của Overview chạy ở server và validation không còn nuốt UUID/date sai thành `null`.
- **Vì sao**: Lead là dữ liệu khách hàng và workflow counters phải nhất quán khi retry hoặc nhiều tab; bộ lọc manager phải trả đúng tập dữ liệu lớn mà không phụ thuộc vào lọc client; cấu hình admin không được vô tình phá engine cảnh báo hoặc mở đường truy cập trực tiếp qua Supabase.
- **Kiểm chứng**: `npm run typecheck`, `npm run lint`, `npm run test:run` (**834 tests / 117 files**), `npm run build`; PostgreSQL sạch reload `supabase/schema.sql`, xác nhận 7 bảng có RLS, `service_role` gọi được RPC, `anon` bị từ chối, idempotency và cross-product status đều pass.

## 2026-08-28 — Lead management: navigation, alert settings, and manager overview
- **Loại**: feature, workflow, RBAC
- **Cái gì**: Thêm mục Health/P&C Leads theo quyền `lead.work`/`lead.manage`; manager có thể chỉnh ngưỡng chưa liên hệ, stale và số lần thử trong Settings. Cờ cảnh báo và Overview dùng các ngưỡng theo product.
- **Vì sao**: Manager cần điều chỉnh nhịp follow-up theo thực tế từng sản phẩm mà không sửa SQL, còn agent chỉ cần thấy đúng queue Leads của mình.
- **Kiểm chứng**: `npm run typecheck`, `npm run lint`; route chặn PATCH settings nếu không có `lead.manage` và từ chối mọi ngưỡng không phải số nguyên dương.

## 2026-08-26 — Enrollment tạo mới không tự gán Caller
- **Loại**: fix, data-integrity
- **Cái gì**: Form tạo Enrollment khởi tạo `caller_email` rỗng cho cả ACA và Medicare. Caller chỉ được lưu khi người dùng chủ động chọn; mặc định hiển thị `Unassigned`.
- **Vì sao**: Trước đây ACA tự lấy tài khoản đang đăng nhập làm Caller, khiến người tạo record bị gán ownership ngoài ý muốn và làm sai các filter/quy tắc scope theo Caller.
- **Ảnh hưởng**: Không đổi `created_by_email` — hệ thống vẫn ghi nhận đúng người tạo. Không ảnh hưởng record hiện hữu hoặc Medicare vì Medicare vốn đã gửi Caller rỗng.

## 2026-08-26 — Review nhánh `feat/comment-system-review` trước khi merge
- **Loại**: fix (blocker, correctness, perf)
- **Cái gì**:
  - **[Blocker] `enrollment_attachments.deleted_at` không tồn tại.** Commit `a1418b7` thêm `.is("deleted_at", null)` vào 3 query enrollment (2 trong `detail.ts`, 1 ở GET `attachments/route.ts`). Bảng này **không có** cột đó — chỉ `task_attachments` có (`schema.sql:2150`). PostgREST trả 42703 → `loadEnrollmentComments` throw → **toàn bộ enrollment detail 500**. Đã revert cả 3, và thêm ghi chú tại chỗ giải thích vì sao Enrollment không có soft-delete file (`delete_enrollment_comment_atomic` xoá cứng) để không ai thêm lại.
  - **Bỏ `shouldAcceptMutationSource`** (`TaskBoardClient.tsx`): dedupe realtime theo `sourceId` trong cửa sổ 2.5s. Nhưng `sourceId` sinh **một lần mỗi tab** (`useState` initializer), tức nó định danh **tab** chứ không phải **mutation**. Hệ quả: một peer đổi hai thứ cách nhau <2.5s thì tab khác **mất hẳn** thay đổi thứ hai cho tới heartbeat 60s. Coalescing đã có sẵn ở `scheduleTaskReconcile` (debounce 300ms) và `canRefreshTaskData` (throttle 5s) — hai cơ chế đó **hoãn** chứ không **mất**.
  - **Trả lại critical path tối ưu cho comment** (`lib/tasks/detail.ts` + `lib/enrollment/detail.ts`): gộp display-names vào cùng `Promise.all` với fetch attachment rows nghe có vẻ song song hơn, nhưng chỉ rút ngắn nhánh vốn không nằm trên critical path. `max(t_names, t_rows) + t_sign` **luôn ≥** `max(t_names, t_rows + t_sign)`. Nay await rows trước, rồi cho names chồng lên signing. Áp cho **cả hai** module (trước đó CS cũng đang ở dạng kém hơn).
  - **Dọn code mồ côi**: xoá `lib/enrollment/comments.ts` (`resolveEnrollmentParentUpdatedAt`) và test của nó — không còn caller sau khi route comment bỏ `fetchEnrollmentRecordById`.
  - **`readTaskMutationSourceId` gọi 1 lần, hoisted khỏi `after()`** (`tasks comments/route.ts`): trước gọi 2 lần và gọi bên trong callback deferred, tức phụ thuộc `Request` sau khi response đã gửi. Khớp cách `reactions/route.ts` đang làm.
  - **Ghi lại invariant idempotency** ở đúng nơi thi hành (`CommentThread.tsx` `post()`): comment giải thích bị xoá cùng code trong `discardOptimistic`, nhưng luật vẫn sống nhờ so `intentKey`. Retry cùng draft giữ `client_request_id` để server replay; draft khác phải lấy id mới, nếu không replay sẽ trả comment cũ và **nuốt mất text mới**.
- **Không sửa (có chủ ý)**: field `warnings` giờ luôn `[]` ở 7 route và **không client nào đọc**. Bỏ hẳn khỏi contract sẽ chạm 7 file route ngay trước lúc merge, mà vẫn phải giữ field ở các route trả warning thật (assignees) → tạo bất nhất giữa các route. Để lại thành việc dọn riêng sau merge.
- **Kiểm chứng**: `npm run test:run` 108 files / **780 tests** pass (783 trước đó, giảm 3 do xoá `comments.test.ts` của helper mồ côi), `npm run typecheck`, `npm run lint` đều sạch.

## 2026-08-25 — Hardening comment realtime, attachment consistency và refresh dedupe
- **Loại**: fix, performance, reliability, live-sync
- **Cái gì**:
  - Task và Enrollment drawer giữ subscription reaction ở cấp drawer, nên reaction vẫn được nhận dù người dùng đang ở tab Activity/Overdue hoặc chưa mở tab Comments; CommentThread hydrate lại reaction bằng endpoint canonical khi nhận event.
  - Enrollment reload trả trạng thái thành công/thất bại rõ ràng. Comment optimistic không bị xoá nhầm khi request refresh lỗi; edit comment cũng báo đúng trạng thái thay vì coi lỗi refresh là đã xong.
  - Enrollment attachment loại bỏ filter `deleted_at` không tồn tại trên bảng attachment; cập nhật activity của record trước khi trả response để lần reload ngay sau upload không đọc snapshot cũ.
  - Upload nhiều file trong comment chạy tối đa 3 worker song song cho cả CS và Enrollment, thay vì chờ từng file tuần tự.
  - Task Board dedupe các invalidation cùng `sourceId`, tránh một mutation làm full refetch hai lần khi vừa đi qua DOM event vừa đi qua Supabase broadcast.
  - Plain comment của CS dùng allow-list thành viên task khi gửi notification, không còn coi mọi participant/reporter/agent là người nhận actionable mặc định.
  - Xoá mềm Enrollment comment dọn luôn reaction liên quan; thêm forward migration cho database đã chạy production.
- **Vì sao**: Hai agent review phát hiện reaction realtime bị phụ thuộc vào lifecycle của tab Comments, optimistic comment có thể biến mất sau một lần reload lỗi, upload file chậm vì tuần tự, và attachment Enrollment tham chiếu cột không tồn tại. Các lỗi này ảnh hưởng đồng thời tới CS và Enrollment hoặc làm hai flow hiển thị khác nhau.
- **Database rollout**: Apply `supabase/rollouts/2026-08-25-comment-review-fixes.sql` trên Supabase production để cập nhật RPC xoá comment hiện hữu; schema source và rollout cũ cũng đã được đồng bộ.
- **Kiểm chứng**: `npm run test:run` 109 files / 783 tests, `npm run typecheck`, `npm run lint`, `git diff --check` đều pass.

## 2026-08-23 — Đồng bộ flow tải dữ liệu giữa Enrollment và CS
- **Loại**: fix, performance, live-sync
- **Cái gì**: Enroll khởi động truy vấn scope cùng lúc với records, people, options, columns và agents thay vì chờ scope xong mới tải phần còn lại. Client list dùng single-flight refetch: nếu realtime, focus hoặc polling cùng kích hoạt trong lúc request đang chạy thì chỉ giữ một lượt refresh bù ở cuối; snapshot đang hiển thị không bị thay bằng trạng thái loading/rỗng.
- **Vì sao**: Enrollment list còn hydrate comment/attachment metadata nên mỗi request nặng hơn task list. Nhiều request chồng nhau làm Enroll hiện dữ liệu trễ, có thể nhảy giữa các snapshot và khác cảm giác tải của CS. Flow mới giữ dữ liệu cũ trong lúc tải và gộp trigger, khớp cơ chế stale-while-revalidate của CS.
- **Ảnh hưởng**: Không đổi quyền, filter hay dữ liệu trả về; chỉ giảm request trùng và rút ngắn thời gian chờ lần tải đầu. Khi có thay đổi trong lúc mutation đang chạy, guard cũ vẫn defer/retry để không ghi đè dữ liệu mới.
- **Kiểm chứng**: `npm run test:run` 108 files / 777 tests, `npm run typecheck`, `npm run lint`, `git diff --check` đều pass.

## 2026-08-23 — Chặn request metadata và overview query quá lớn cho Enrollment và CS
- **Loại**: fix, performance, test tooling
- **Cái gì**: `fetchEnrollmentRecords()` chia batch 50 cho comments/attachments; `fetchTaskListMetadata()` của CS cũng chia batch 50 cho RPC metadata, trong khi fallback CS vốn đã chia batch. Các overview Enrollment cũng chia `record_id` thành batch 50 khi đọc stage cycles (ACA/MED dùng chung code, generic overview dùng cùng giới hạn). ACA/MED overview dùng một lượt đọc stage cycles để tính cả wait-time và owner metrics, bỏ `count: exact` ở các trang overview, và chạy các batch song song. Client giữ snapshot gần nhất theo program/date range để lần quay lại Overview hiển thị ngay rồi refresh nền. Các batch vẫn gộp kết quả trước khi trả dữ liệu; thêm regression test cho helper Enrollment, payload RPC CS và helper overview.
- **Vì sao**: Với 500 ACA records, query list vẫn trả đủ, nhưng overview trước đây đưa 500 UUID vào một `.in("record_id", ...)` request cho stage cycles. URL/payload quá lớn làm `fetch` thất bại sau khoảng 9.5 giây và route trả 500. Sau khi chia batch, việc đọc stage cycles vẫn bị chậm vì cùng dữ liệu bị query hai lần và mỗi trang yêu cầu đếm chính xác; gộp còn một lần đọc, bỏ count thừa và chạy batch song song. Cache phía client giúp không phải chờ lại khi chuyển List/Overview hoặc quay lại cùng cohort. CS không tái hiện đúng lỗi request lớn vì phần task overview đã giới hạn batch assignee task ID ở 50; vẫn giữ giới hạn đồng nhất để các luồng không tái phát khi dữ liệu phình to.
- **Tool test**: Thêm `scripts/seed-enrollment-performance-samples.mjs` và `scripts/benchmark-enrollment-list.mjs`. Seed 500 dòng ACA có marker `[Perf sample enrollment]`, phân bổ trên 17 agent, thêm activity/stage cycle tối thiểu; ghi chỉ khi có `SEED_PERF_ALLOW=1`, cleanup chỉ xóa đúng marker. Benchmark đo queue đầy đủ hoặc scope agent, không ghi dữ liệu.
- **Đo được**: 503 dòng ACA, list-only p50 khoảng 373ms; hydration chia batch 50 chạy thành công khoảng 639ms ở lần đo đơn. HIGH-03 chưa cần pagination ngay vì chưa chạm truncation; HIGH-04 hiện scope agent đo được 1 agent và filter khoảng 220 bytes, chưa đủ bằng chứng để dựng visibility RPC.
- **Lệnh**: `npm run seed:enrollment-perf -- --count=500 --program=aca --dry-run`; ghi thật cần `SEED_PERF_ALLOW=1`; dọn bằng `SEED_PERF_ALLOW=1 npm run seed:enrollment-perf -- --cleanup`; benchmark `npm run benchmark:enrollment-list -- --program=aca --all`.

## 2026-08-23 — Sửa các finding correctness/security từ code review 23/08
- **Loại**: fix (security, correctness, perf)
- **Cái gì**:
  - **`seeAll` vào resolver chung** (`access.ts`): luật "plain-CS thấy toàn bộ company queue" trước đây sống ở `actorSeesAllTasks()` và bị chép lại lần hai trong `fetchTasksForActor()`, nên mỗi route đọc task phải tự nhớ OR nó vào. Comments/detail nhớ; **direct GET `/api/tasks/:id` và search thì quên**. Nay thành flag `seesAllTasks` trong `canViewTask`, và cả hai chỗ quên đã truyền vào. Flag chỉ mở **quyền đọc** — các helper mutation vẫn đọc flag riêng của chúng, có test chốt điều này.
  - **Membership fail-closed** (`membership.ts`): `fetchAssistantAgentsForCs` trả `[]` khi query lỗi, trong khi caller dùng mảng rỗng làm **bằng chứng** user là plain CS → một assistant có thể được cấp toàn bộ queue. Nay throw. Sibling `fetchSelectedAgentEmails` vốn đã throw nên sự cố DB toàn phần luôn fail-closed; lỗ hổng chỉ mở khi riêng `agent_members` lỗi (schema-cache miss, timeout, đổi RLS).
  - **Quyền assign** (`assign/route.ts`): route gác bằng `isTaskViewAdmin` — một phép thử **role**, không kiểm `task.manage`. RPC `assign_unassigned_task` là security-definer và không tự xác thực `p_actor_email`, nên route là hàng rào duy nhất. Nay dùng `buildTaskActor` + `canAssign`, khớp với route `/assignees` đã làm đúng.
  - **Comment đã xoá bị rò** (`comments/route.ts` GET): query không lọc `deleted_at` và không giới hạn. Thêm `.is("deleted_at", null)` + lấy 50 comment mới nhất, đảo lại thứ tự tăng dần để giữ contract cũ. Không client nội bộ nào gọi GET này, nhưng route vẫn reachable.
  - **Comment tạm không được release** (`CommentThread.tsx`): retry upload trước đây đọc state qua closure cũ. Nay đợi React commit trạng thái file thành công rồi mới release bằng effect, không dùng state updater như kênh trả kết quả và không tạo side effect trong updater.
  - **Gom scope membership** (`membership.ts`, `queries.ts`, `search.ts`, direct GET): dùng một resolver fail-closed cho selected-agent/assistant scope, tránh lặp query `agent_members` trong list, search và direct GET.
  - **Broadcast source cho upload lúc tạo task** (`NewTaskDialog.tsx`): upload attachment cấp task gửi cùng `x-task-client-source`, nên tab tạo task cũng bỏ qua echo tasks-only của chính nó. Source thiếu vẫn chỉ là tasks-only; comments/attachments không reload categories.
- **Vì sao**: Ba mục đầu là phân quyền — hai mục fail-open (cấp quyền không nên có), một mục thiếu kiểm tra permission. Mục 4 là rò dữ liệu đã soft-delete. Mục 5-6 là correctness + chi phí.
- **Không làm trong lượt này**: HIGH-03 (cursor pagination), HIGH-04 (visibility RPC), HIGH-05, HIGH-06, HIGH-07, MEDIUM-07/08/09/10. Sáu trong số đó là tối ưu kiến trúc mà chính report yêu cầu `EXPLAIN ANALYZE` hoặc đo production trước; số liệu Vercel cho thấy HIGH-05/06/07 gần như không xuất hiện trong top route. Chi tiết ở `docs/superpowers/plans/2026-08-23-task-review-remediation.md`.
- **Kiểm chứng**: `npm run test:run` 108 files / **772 tests** (baseline 760, thêm 12 test hồi quy), `npm run typecheck`, `npm run lint` đều pass.

## 2026-08-21 — Đặt React cạnh Reply và mở rộng bộ emoji
- **Loại**: feature, fix
- **Cái gì**: Giữ UI reaction cũ trong comment nhưng mở picker searchable/full-set; ô soạn comment dùng cùng picker, nhóm theo category và bộ 1.914 emoji RGI sinh từ dataset Unicode. Server dùng `Set` exact-match trên dataset đã sinh, chuẩn hoá variation selector trước khi lưu, thay cho allowlist 16 emoji.
- **Vì sao**: Giữ reaction comment quen thuộc theo UI cũ; phần nhập comment cần bộ emoji searchable. Regex không được dùng vì chỉ nhận diện chuỗi “giống emoji”, không bảo đảm emoji đó thuộc tập sản phẩm hỗ trợ.
- **File**: `scripts/generate-emoji-data.mjs`, `scripts/emoji-data-source.mjs`, `scripts/check-emoji-length.mjs`, `src/lib/tasks/emoji-data.ts`, `src/lib/tasks/emoji-search.ts`, `src/app/(authed)/tasks/_components/EmojiPicker.tsx`, `CommentThread.tsx`, reaction route, `package.json`
- **Ảnh hưởng**: Không thêm runtime dependency; hai package chỉ là devDependency và dataset được commit, dynamic import chỉ tải chunk khi mở picker. Max dataset hiện tại là 8 code point, vẫn nằm dưới guard RPC `char_length <= 16`. Skin-tone variants, custom emoji và edit-comment picker vẫn ngoài scope.

## 2026-08-20 — Bỏ realtime echo cục bộ và sửa notification batch nhiều task
- **Loại**: fix, performance, reliability
- **Cái gì**: Mỗi Task Board dùng một source id ngẫu nhiên theo tab cho mutation. DOM invalidation và server broadcast mang source id này để tab tạo mutation bỏ qua lượt reconcile của chính nó, trong khi tab khác vẫn refetch. Task-scoped event chỉ tải lại task rows; lượt full luôn được ưu tiên khi nhiều trigger bị gộp. Notification poll có nhiều task phát một broad invalidation thay vì chỉ lấy task đầu tiên.
- **Vì sao**: Một field edit đã có canonical row từ response nhưng vẫn tự kéo lại task list và category config; chỉ lọc DOM event chưa đủ vì server REST broadcast cũng quay lại mọi browser đang subscribe. Với notification batch, drawer có thể bỏ qua task đang mở nếu task khác đứng đầu danh sách.
- **File**: TaskBoardClient.tsx, NotificationBell.tsx, TaskDetailDrawer.tsx, src/lib/tasks/live-sync.ts, src/lib/tasks/notification-invalidation.ts, src/lib/tasks/realtime.ts và các task mutation routes
- **Ảnh hưởng**: Mutation từ chính tab giữ PATCH và refresh detail cần thiết, không tự refetch board/config khi response đã đủ dữ liệu. Cross-tab/cross-device vẫn reconcile; broadcast không có source id như category/config change vẫn chạy full refresh. Không đổi schema hay response API.

## 2026-08-20 — Task Board và Detail tự đồng bộ khi tab mở lâu
- **Loại**: fix, reliability, performance-observability
- **Cái gì**: Board/List nhận snapshot mới nhất từ server sau khi vượt qua guard của local mutation, thay vì giữ nguyên cả task vừa được sửa trong 3 giây. Mutation thành công phát invalidation qua DOM + `localStorage`, nên tab cùng trình duyệt refetch ngay; notification task mới cũng kích hoạt cùng đường này cho tab của người nhận, kể cả notification đã được tab khác mark-read. Các trigger được debounce + single-flight để chỉ giữ tối đa một lượt trailing refresh. Task Detail giữ subscription ở cấp drawer nên Comments, Files, Activity, Overdue và metadata vẫn cập nhật dù người dùng đang ở tab nào; cache đóng được invalidate và realtime refresh giữ nguyên độ sâu comment mà người dùng đã Load older.
- **Vì sao**: Cooldown theo thời gian có thể nuốt vĩnh viễn update của agent khác; subscription cũ chỉ tồn tại khi tab Comments được mount; notification và danh sách dùng hai topic khác nhau nên notification đến không chứng minh `tasks-stream` đã đến. REST broadcast cũ còn không kiểm tra HTTP status, vì vậy cả response 500 cũng bị coi là success và không log.
- **File**: `src/lib/tasks/live-sync.ts`, `src/lib/tasks/client-events.ts`, `TaskBoardClient.tsx`, `TaskDetailDrawer.tsx`, `CommentThread.tsx`, `NotificationBell.tsx`, `src/lib/tasks/realtime.ts`, `src/lib/supabase-browser.ts`, `src/app/api/tasks/route.ts`
- **Ảnh hưởng**: Realtime khỏe reconcile mỗi 60 giây; khi mất/kém realtime dùng fallback 15 giây và báo trạng thái. Tab ẩn hoặc offline không polling. Broadcast server có timeout 1.5 giây mỗi attempt, retry một lần khi lỗi mạng/non-2xx rồi trả warning + log status/count nếu vẫn hỏng; mutation đã commit không bị đổi thành 500 giả, kể cả đường overview assignment. Cross-tab storage chỉ chứa nonce, không chứa task id hay dữ liệu khách hàng. `/api/tasks` thêm `Server-Timing` và log `[perf:tasks-list]` để đo riêng auth, query tasks và tổng route; không đổi schema.

## 2026-08-20 — Emoji cho comment: nút chọn emoji và thả cảm xúc
- **Loại**: feature
- **Cái gì**: Ô soạn comment (không phải ô sửa) có nút chọn emoji với danh sách 16 emoji cố định. Comment trong CS Task drawer có thanh thả cảm xúc kiểu Slack: `PUT` để thêm, `DELETE` để bỏ, mỗi người một emoji một lần. Bảng mới `task_comment_reactions` ràng buộc duy nhất `(comment_id, reactor_email, emoji)` và chuẩn hoá email; mutation chạy trong RPC atomic cùng lock của comment, còn `delete_task_comment_atomic` dọn reaction khi xoá mềm.
- **Vì sao**: Team yêu cầu. Thả cảm xúc còn nhằm CẮT ồn: đo ngày 2026-08-18 trên production có 529 thông báo, 67% là `commented`, trung bình 2,2 thông báo mỗi comment — phần lớn là những câu "ok"/"đã nhận". Thả 👍 thay câu đó thì không bắn thông báo nào.
- **File**: `supabase/rollouts/2026-08-20-comment-reactions.sql` (+ `-test.sql`), `supabase/schema.sql`, `src/lib/tasks/emoji.ts`, `src/lib/tasks/reactions.ts`, `src/lib/tasks/reaction-access.ts`, hai reaction API routes, `src/lib/tasks/realtime.ts`, `src/lib/tasks/realtime-topics.ts`, `src/lib/tasks/detail.ts`, `src/lib/tasks/detail-cache.ts`, `CommentThread.tsx`, `TaskDetailDrawer.tsx`
- **Ảnh hưởng**: Reaction TUYỆT ĐỐI không tạo thông báo và không ghi activity — đó là lý do tồn tại của tính năng, đừng "sửa" lại sau. Dùng topic realtime RIÊNG (`reaction`) với payload rỗng, rồi tab nhận ping gọi endpoint canonical có auth; không dùng `changed` vì nó tải lại toàn bộ detail cho mỗi cú bấm, và không chở email/reaction trên public channel. Client serialize mutation theo comment, bỏ response cũ theo version và reconcile sau khi queue hết nên click nhanh không ghi đè nhau. Emoji giới hạn trong danh sách cố định phía server. `CommentThread` dùng chung với Enrollment nên reaction khoá sau prop `reactionsEnabled` mặc định TẮT; Enrollment giữ nguyên hành vi cũ. Comment render trước, reaction hydrate sau qua endpoint nhẹ nên query reaction không giữ skeleton; benchmark read-only với 34 comment đo p95 464ms khi query còn nằm trong loader và 363ms khi bỏ query đó. Snapshot/mutation reaction patch vào cache hiện có thay vì xoá toàn bộ detail, đồng thời giữ nguyên tuổi cache; background revalidate giữ reaction đã render cho tới canonical response mới nên pill không nhấp nháy hiện-mất-hiện khi mở lại task. Xoá comment là xoá MỀM nên `on delete cascade` không chạy — RPC phải tự dọn. File SQL test chỉ dùng TEMP table, không để lại object production.

## 2026-08-19 — CS: đính kèm file ngay khi tạo task
- **Loại**: feature, data-integrity
- **Cái gì**: Dialog "New task" có trường Attachments ngay dưới Description — chọn file, bỏ file chọn nhầm, y như sửa Description trước khi bấm tạo. File giữ trong bộ nhớ trình duyệt; tạo task trước rồi upload tuần tự theo id trả về. Task drawer hiển thị danh sách file dưới Description, CHỈ ĐỂ XEM: sau khi tạo thì không thêm không xoá.
- **Vì sao**: Yêu cầu nghiệp vụ — đính kèm phải là một trường của form tạo, và mở task ra phải thấy ngay file. Trước đó CS không có giao diện đính kèm cấp task nào cả.
- **File**: `src/lib/tasks/pending-attachments.ts`, `src/lib/tasks/attachments.ts`, `src/app/(authed)/tasks/_components/AttachmentStrip.tsx`, `TaskDetailDrawer.tsx`, `NewTaskDialog.tsx`, `TaskBoardClient.tsx`, `src/app/api/tasks/[id]/detail/route.ts`, `src/app/api/tasks/[id]/attachments/route.ts`
- **Ảnh hưởng**: Không đổi schema, không thêm endpoint — `comment_id` vốn cho phép NULL và route POST đã nhận trường hợp đó. Ba thay đổi hành vi phía server: (1) `includeTaskAttachments` bật lên nên `/api/tasks/[id]/detail` thêm một truy vấn và một lượt ký URL, và endpoint này còn bị gọi bởi `prefetchTaskDetail` khi rê chuột qua từng card/row; (2) cờ `silent=1` khiến upload lúc tạo KHÔNG bắn `attachment_added`, upload đường khác vẫn bắn; (3) giới hạn 10 file / 50MB trước đây CHỈ áp cho đính kèm của comment (`checkOperationLimits` nằm trong `if (commentId)`), giờ áp cho cả đính kèm cấp task. Mỗi file mang một `client_request_id` UUID riêng nên bấm Create lại sau khi upload trượt một phần sẽ không nhân đôi file. Upload chạy SAU khi tạo: task tạo xong mà file trượt thì dialog giữ nguyên, bỏ các file đã lên, nêu tên file hỏng để bấm Create lại chỉ gửi phần còn thiếu.

## 2026-08-18 — Cài staging cho sheet sync và sửa lỗi mất DEFAULT của health_raw_data.id
- **Loại**: fix, data-integrity, datasync
- **Cái gì**: Cài 2 bảng (`sheet_sync_runs`, `sheet_sync_staging`) và 3 hàm (`begin_sheet_sync`, `finalize_sheet_sync`, `purge_sheet_sync_staging`) mà commit f0b327d (2026-08-11) thêm vào file schema nhưng chưa bao giờ đưa lên database. Đồng thời sửa `finalize_sheet_sync`: thay vì `insert ... select (jsonb_populate_record(null::<bảng>, payload)).*` — cách này cấp giá trị tường minh cho MỌI cột của rowtype — giờ chỉ ghi những cột mà payload thực sự mang theo, cột generated/identity bị loại.
- **Vì sao**: Cấp tường minh NULL sẽ vô hiệu hoá DEFAULT của cột. `health_raw_data.id` là `uuid primary key default gen_random_uuid()` nên nhận NULL và vi phạm not-null (SQLSTATE 23502) → sync Health hỏng hoàn toàn, và cron `/api/cron/sync-data` cũng sẽ hỏng ở lần chạy kế tiếp. Cột `id` đó không có trong cả `datasync/schema.sql` lẫn `supabase/schema.sql` vì bảng này vốn là `health_mart` cũ được đổi tên (supabase/schema.sql dòng 5-11); `create table if not exists` sau đó không đụng tới bảng đã tồn tại.
- **File**: `datasync/schema.sql`, `supabase/rollouts/2026-08-18-install-sheet-sync-staging.sql`
- **Lỗi thứ ba (statement timeout 57014)**: bản vá đầu tiên lấy danh sách khoá bằng `array_agg(distinct jsonb_object_keys(payload))` trên TOÀN BỘ staging của lần chạy — 15.871 dòng × 27 khoá ≈ 428.000 dòng chỉ để lấy 27 cái tên cột, đo được 285ms tại chỗ và đủ để vượt giới hạn thời gian của Supabase. Đổi sang lấy khoá từ MỘT dòng (1ms): an toàn vì `rowToRecord` trong `datasync/lib/transform.js` dựng mọi record từ cùng `config.columns` và luôn gán đủ mọi target kể cả null, nên bộ khoá cố định theo config chứ không phụ thuộc dữ liệu. Đã thử và LOẠI cách đặt `set statement_timeout` trong định nghĩa hàm: bộ đếm lên cò lúc câu lệnh ngoài bắt đầu nên đổi bên trong không có tác dụng — file rollout để sẵn `alter role service_role set statement_timeout` dạng comment làm lối thoát dự phòng.
- **Ảnh hưởng**: Không mất dữ liệu — lần finalize hỏng đã tự cuộn lại, 4 bảng production còn nguyên (health_raw_data 14679, health_mart 14666, pc_raw_data 4017, pc_mart 3992). `pc_raw_data` và `provider_address` khớp schema nên vốn không dính lỗi này. Đã kiểm chứng bằng cách dựng lại đúng cấu trúc bảng production trên PostgreSQL 16.8 cục bộ: tái hiện được lỗi 23502 với bản cũ, và bản sửa qua 4 kịch bản (có id / gọi lại cùng run_id / bảng không có id / staging rỗng). Giữ nguyên hành vi cũ: sheet rỗng thì làm rỗng phân vùng tương ứng.

## 2026-08-15 — Chuẩn hoá stage Health ACA và Health Medicare Enrollment
- **Loại**: fix, data-integrity, workflow
- **Cái gì**: ACA dùng đúng 12 stage theo workflow mới; Medicare dùng đúng 11 stage, trong đó Medicare giữ bước gộp `6-Enrolled-1stpayment done`. Seed cho database mới và rollout hiện hữu dùng chung thứ tự, màu, terminal/QC semantics; stage cũ được map khi chắc chắn và archive thay vì xoá để giữ nguyên foreign key/history.
- **Vì sao**: Catalog hiện tại còn stage cũ (`9-Assigned PCP/Get ID Card`, `10-DONE`, `New`, `E- ID Card Unavailable`) và các stage ngoài workflow, khiến create/list/detail/dashboard hiển thị không nhất quán giữa hai chương trình.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-15-enrollment-stage-setup.sql`, `supabase/rollouts/2026-08-15-enrollment-stage-setup-test.sql`
- **Ảnh hưởng**: Record lịch sử không bị xoá hoặc đổi ID; stage ngoài danh sách canonical không còn xuất hiện trong picker sau rollout nhưng vẫn đọc được cho record cũ. Cần apply rollout trước khi kiểm tra UI production.

## 2026-08-15 — Chỉ đếm usage option khi admin yêu cầu archive
- **Loại**: fix, performance, data-integrity
- **Cái gì**: Bỏ eager `enrollment_option_usage_counts()` khỏi `/config`; archive custom dropdown và Enrollment option giờ kiểm tra usage đúng một lần sau khi admin bấm Archive. Custom values dùng JSONB containment trên index GIN partial của các record active; lỗi kiểm tra usage chặn archive và không giả mạo số 0.
- **Vì sao**: Scan toàn bộ enrollment records khi mở `/config` làm tăng latency dù admin không archive gì; usage thất bại có thể bị hiểu nhầm là option không được dùng.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-15-config-option-usage.sql`, `src/app/api/config/columns/[id]/options/[optionId]/usage/route.ts`, `src/app/api/enrollment/option-sets/[id]/usage/route.ts`, `src/app/(authed)/config/page.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`
- **Ảnh hưởng**: Initial `/config` bớt một query scan; archive confirmation thêm một request có chủ đích. Rollout index/RPC phải được apply trước khi deploy UI.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 19

## 2026-08-15 — Chặn category inactive trong cùng transaction tạo/sửa task
- **Loại**: fix, data-integrity
- **Cái gì**: Task create/PATCH kiểm tra UUID category ở memory và map lỗi category không tồn tại/inactive thành 409 `TASK_CATEGORY_INACTIVE`. Trigger DB chỉ kiểm tra khi category được ghi hoặc thay đổi; các task lịch sử vẫn giữ category đã archive để đọc/export.
- **Vì sao**: Route pre-read không thể chống race với thao tác archive đồng thời, còn UUID sai trước đây có thể rơi thành lỗi 500 không rõ nguyên nhân.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-15-task-category-active-guard.sql`, `src/lib/tasks/category-mutation.ts`, `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`
- **Ảnh hưởng**: Không thêm query mạng; invariant active-category được kiểm tra tại transaction boundary của RPC.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 18

## 2026-08-15 — Membership assistant ghi atomically và chặn cycle
- **Loại**: fix, security, data-integrity
- **Cái gì**: Thêm RPC service-role `create_agent_membership_atomic` để serialize membership writes, xác nhận agent/assistant còn active/eligible, chặn tự gán, duplicate và mọi cycle trong đồ thị assistant. API map lỗi thành mã 400/409 ổn định; UI loại self và membership đã tồn tại khỏi picker.
- **Vì sao**: Read-then-upsert trước đây cho phép duplicate bị coi là success, hai chiều tạo vòng quyền, hoặc account bị deactivate giữa lúc kiểm tra và ghi.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-15-agent-membership-invariants.sql`, `src/app/api/config/assistants/route.ts`, `src/lib/tasks/membership-mutation.ts`, `src/lib/tasks/membership-mutation.test.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx`
- **Ảnh hưởng**: Authorization vẫn one-hop/explicit như trước; function/rollout phải được apply trước khi deploy API. Không mở rộng quyền đệ quy.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 17

## 2026-08-15 — Chuẩn hóa màu dropdown ở API boundary
- **Loại**: fix, data-integrity, consistency
- **Cái gì**: Category, custom-column option và Enrollment option mutations giờ dùng cùng parser màu: giá trị hex 6 ký tự được trim/lowercase, giá trị rỗng/null có thể clear, còn input không hợp lệ trả 400 với thông báo ổn định thay vì âm thầm lưu/null. Không thay đổi semantics màu riêng của Stage.
- **Vì sao**: Màu viết hoa/định dạng sai làm các consumer render không nhất quán; silent fallback khiến admin tưởng đã lưu màu nhưng list/detail lại dùng palette khác.
- **File**: `src/lib/table-config/value-colors.ts`, `src/app/api/tasks/categories/route.ts`, `src/app/api/tasks/categories/[id]/route.ts`, `src/app/api/config/columns/[id]/options/route.ts`, `src/app/api/config/columns/[id]/options/[optionId]/route.ts`, `src/app/api/enrollment/option-sets/route.ts`, `src/app/api/enrollment/option-sets/[id]/route.ts`
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 15 (commit 1)

## 2026-08-15 — Refresh Config an toàn trước response lỗi/cũ
- **Loại**: fix, consistency, reliability
- **Cái gì**: Scope columns/options, categories, enrollment option sets, agents và assistant memberships giờ kiểm tra HTTP status trước khi dùng payload, chịu được invalid JSON, validate shape tối thiểu và dùng request sequence riêng để response cũ không ghi đè state mới. Khi refresh mới nhất lỗi, UI giữ last-good data, hiển thị lỗi endpoint-safe và khóa mutation của section tương ứng; các section độc lập không bị reset. Không thêm retry hay request tự động.
- **Vì sao**: Refresh sau mutation có thể nhận 500/HTML/JSON lỗi hoặc response out-of-order; trước đây có thể đọc payload lỗi như success, văng parser error hoặc để optimistic state/response cũ tồn tại mà không báo section stale.
- **File**: `src/lib/table-config/refresh-state.ts`, `src/lib/table-config/refresh-state.test.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx`
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 14

## 2026-08-15 — Cô lập lỗi từng section của Table Config
- **Loại**: fix, reliability
- **Cái gì**: `/config` dùng settled loaders cho các section tùy chọn; chỉ coi Table Columns là load-bearing. Categories, dropdown options, agents/assistant memberships, SLA và enrollment option sets có trạng thái `available/error` riêng, giữ dữ liệu tốt cuối cùng và khóa mutation khi section không tải được. Schema readiness được suy ra từ các column id synthetic `system-*`, không thêm schema-probe query. Thêm `error.tsx` cho lỗi load cấu hình cốt lõi với Retry an toàn.
- **Vì sao**: Một lỗi schema/quyền/mạng ở một dependency trước đây có thể làm cả trang Config fail hoặc để UI tiếp tục ghi vào dữ liệu fallback không đầy đủ.
- **File**: `src/app/(authed)/config/page.tsx`, `src/app/(authed)/config/error.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 13

## 2026-08-15 — Báo đúng partial success khi reset layout thất bại
- **Loại**: fix, reliability
- **Cái gì**: Column PATCH và reorder trả `ok: true` cùng warning có mã ổn định khi thay đổi chính đã commit nhưng reset saved layouts thất bại. Server log chi tiết nội bộ; Config hiển thị thông báo info rằng thay đổi đã lưu nhưng layout chưa reset, không báo full success và không leak lỗi DB.
- **Vì sao**: Response trước đây có thể trả nội dung lỗi hạ tầng vào UI và client chỉ hiểu warning string, khiến partial success không có contract rõ ràng.
- **File**: `src/lib/table-config/partial-success.ts`, `src/app/api/config/columns/route.ts`, `src/app/api/config/columns/[id]/route.ts`, `src/app/api/config/columns/reorder/route.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx`
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 12

## 2026-08-15 — Làm mới SLA trên Task Board đang mở
- **Loại**: fix, consistency
- **Cái gì**: Config phát broadcast invalidation riêng cho SLA sau khi save/reset reminder hoặc rule thành công; Task Board refetch rule qua API mà không reset danh sách task, tự hồi phục khi reconnect và focus. Các lần refresh trùng được gộp bằng guard in-flight/latest, lỗi refresh SLA hiển thị riêng với lỗi table config.
- **Vì sao**: Board đang mở có thể tiếp tục tính Overdue theo SLA cũ cho tới khi reload trang, và broadcast/reconnect có thể tạo nhiều request cạnh tranh.
- **File**: `src/lib/table-config/realtime-topics.ts`, `src/lib/table-config/realtime.ts`, `src/lib/table-config/realtime-client.ts`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- **Ảnh hưởng**: Chỉ invalidation metadata rỗng được gửi; giá trị SLA vẫn đọc qua route đã xác thực. Broadcast là best-effort và không kéo dài response của mutation.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 11

## 2026-08-15 — Reminder settings partial và integer-safe
- **Loại**: fix, data-integrity
- **Cái gì**: Reminder API nhận đúng một key/value qua PATCH, chặn số fractional/non-safe/out-of-range (due-soon tối đa 7 ngày, các reminder giờ tối đa 1 năm), cập nhật một cột trong RPC có row lock và trả canonical full settings. Config serialize theo từng key, giữ pending edit của key khác khi merge response, và không cho sửa khi GET lỗi cho tới khi Retry thành công.
- **Vì sao**: PUT toàn object + `Math.round` biến input `1.5` thành giá trị hợp lệ và cho phép tab cũ ghi đè các reminder khác bằng snapshot stale.
- **File**: `src/app/api/admin/task-reminder-settings/route.ts`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/lib/tasks/reminder-settings.ts`, `supabase/schema.sql`, `supabase/rollouts/2026-08-15-reminder-partial-update.sql`
- **Ảnh hưởng**: SLA reminder cron đọc cùng singleton settings; không đổi tên field response. Client cũ dùng PUT nhận 405 có hướng dẫn nâng cấp. RPC chưa apply vào target DB trong môi trường này.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 10

## 2026-08-15 — SLA rule mutations có optimistic concurrency
- **Loại**: fix, data-integrity
- **Cái gì**: SLA GET trả `updated_at`; save/delete yêu cầu token của row hiện tại và chạy qua RPC lock-compare-write/delete. Stale token trả 409; insert đua nhau dựa trên unique index và map 23505 thành conflict. Category id được kiểm tra UUID trước khi gọi DB.
- **Vì sao**: Read-then-write và last-write-wins có thể để một tab ghi đè SLA của tab khác hoặc xoá rule mới hơn.
- **File**: `src/app/api/admin/task-sla-rules/route.ts`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/lib/tasks/types.ts`, `src/lib/tasks/sla-config.ts`, `supabase/schema.sql`, `supabase/rollouts/2026-08-15-sla-versioned-mutations.sql`
- **Ảnh hưởng**: Chỉ manager chỉnh SLA; Task Board đọc vẫn tương thích. Khi stale, Config reload rules và giữ lỗi để admin biết cần thử lại. RPC chưa apply vào target DB trong môi trường này.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 9

## 2026-08-15 — Atomic và version-aware reorder cột
- **Loại**: fix, perf
- **Cái gì**: Drag reorder gửi `expected_column_keys` cùng thứ tự mong muốn vào một RPC service-role. RPC lock active rows theo id, kiểm tra membership/duplicate sau lock, trả `COLUMN_ORDER_STALE` nếu snapshot cũ và cập nhật toàn bộ position trong một statement. Layout reset vẫn là bước hậu commit và trả warning nếu thất bại.
- **Vì sao**: N lần PATCH song song có thể để vị trí nửa cũ/nửa mới và writer đến sau âm thầm ghi đè thay đổi của writer trước.
- **File**: `src/app/api/config/columns/reorder/route.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/table-config/column-order.ts`, `supabase/schema.sql`, `supabase/rollouts/2026-08-15-table-config-reorder-rpc.sql`
- **Ảnh hưởng**: Reorder của CS/ACA/Medicare; stale editor phải refresh thay vì overwrite. Không thêm request bình thường ngoài RPC + bước reset layout hiện có. Function/rollout chưa được apply vào target DB trong môi trường này.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 8

## 2026-08-15 — Xác nhận rõ ràng khi khôi phục cột đã archive
- **Loại**: fix, security
- **Cái gì**: Tạo cột trùng label/key với một cột archived nay trả 409 kèm id/label/type an toàn; UI yêu cầu admin xác nhận và gọi restore riêng để khôi phục nguyên options/settings. Restore reset saved layouts và trả cảnh báo rõ nếu việc reset không hoàn tất. Dialog dùng focus trap, Escape, backdrop close, scroll lock và trả focus về opener.
- **Vì sao**: Luồng tạo cột trước đây có thể va unique key hoặc khôi phục ngầm qua nhánh fallback, khiến admin không biết cột cũ được dùng lại và có thể làm mất layout cá nhân.
- **File**: `src/app/api/config/columns/route.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/table-config/mutation-errors.ts`
- **Ảnh hưởng**: Chỉ Config admin; dữ liệu archived không bị xoá/đổi type. Restore giữ nguyên id/options/settings và không tự động chạy khi admin chỉ bấm Add.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 7

## 2026-08-15 — Chặn option label trùng trong cùng cột
- **Loại**: fix, migration
- **Cái gì**: Thêm unique partial index chuẩn hoá `lower(btrim(label))` cho active `table_column_option` theo `column_id`; các route tạo/cập nhật option dịch lỗi unique thành `CONFIG_DUPLICATE_OPTION_LABEL` (409) thay vì trả lỗi DB thô.
- **Vì sao**: Hai option active khác casing/khoảng trắng tạo ra giá trị mơ hồ, làm filter/validation và màu hiển thị không xác định.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-15-table-config-option-label-unique.sql`, `src/app/api/config/columns/[id]/options/route.ts`, `src/app/api/config/columns/[id]/options/[optionId]/route.ts`, `src/lib/table-config/mutation-errors.ts`
- **Ảnh hưởng**: Chỉ option active trong cùng custom column; option archived vẫn có thể giữ lịch sử. Preflight hiện tại không phát hiện nhóm trùng (0 nhóm), nên không tự xoá hay đổi dữ liệu production. Rollout phải chạy `CREATE INDEX CONCURRENTLY` ngoài transaction sau preflight.
- **Ref**: `docs/superpowers/plans/2026-08-15-table-config-remediation.md`, Task 6

## 2026-08-11 — Add standalone display-number rollout
- **Loại**: fix, migration
- **Cái gì**: Added an idempotent transactional rollout for the sequence-backed `tasks.display_number` and `enrollment_records.display_number` columns, including exclusive table locks, deterministic backfill, sequence advancement, non-null defaults, and unique indexes.
- **Vì sao**: The application now reads canonical display numbers, but environments that have not applied the schema changes fail with a missing-column error instead of silently reverting to collision-prone UUID hashes.
- **File**: `supabase/rollouts/2026-08-11-display-number-backfill.sql`
- **Ảnh hưởng**: Run this rollout before deploying the current application; it preserves UUID routing and makes visible Task/Enrollment keys unique. It has not been executed here because no database migration authority was granted.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 6

## 2026-08-11 — Remove dead post-commit Enrollment activity builder
- **Loại**: refactor-logic
- **Cái gì**: Removed the unused post-RPC `activityRows` construction from Enrollment PATCH. `rpcActivityRows` remains the sole activity input to `patch_enrollment_atomic`; notification fan-out, broadcasts, canonical reload, and warnings are unchanged.
- **Vì sao**: The second activity array was never persisted or read, duplicated lifecycle logic, and could mislead future changes into assuming post-commit activity was durable.
- **File**: `src/app/api/enrollment/[id]/route.ts`
- **Ảnh hưởng**: ACA and Medicare stage, reopen, QC, people, and generic field updates continue writing activity exactly once through the atomic RPC; only dead allocations were removed.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 16

## 2026-08-11 — Require a configured realtime topic secret in production
- **Loại**: security, fix
- **Cái gì**: Per-user notification topics now use `REALTIME_TOPIC_SECRET` or `AUTH_SECRET`; missing secrets throw in production and only use the development fallback outside production with a warning. HMAC normalization and content-free broadcasts are unchanged.
- **Vì sao**: The previous public fallback `task-notify` made notification topic names guessable if production secret configuration was missing.
- **File**: `src/lib/tasks/realtime.ts`, `src/lib/tasks/realtime.test.ts`
- **Ảnh hưởng**: Production notification API/broadcast paths fail explicitly until a secret is configured; local/test environments retain deterministic fallback behavior with visible warning.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 15

## 2026-08-11 — Expose participant lookup outages
- **Loại**: fix, security
- **Cái gì**: Participant ID/email/membership helpers now use the assignee-only fallback only for a missing `task_participants` relation (`42P01`, or its exact PostgREST schema-cache representation) and throw for permission, network, timeout, and other database failures.
- **Vì sao**: Converting every lookup error into `false`/`[]` silently changed outages into authorization misses and could hide a collaboration visibility incident.
- **File**: `src/lib/tasks/participants.ts`, `src/lib/tasks/participants.test.ts`
- **Ảnh hưởng**: Task list/search/detail/comment/attachment authorization remains fail-closed; missing-table additive rollout remains compatible, while unexpected participant DB failures become observable route errors.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 14

## 2026-08-11 — Observe optional notification enrichment degradation
- **Loại**: fix
- **Cái gì**: Notification title, actor, and comment-body enrichment queries now report structured warnings with only stage names and database error codes. The authenticated base notification list and unread counts remain fail-soft when an optional lookup is unavailable.
- **Vì sao**: Five secondary queries ignored errors, making missing titles/names/bodies indistinguishable from valid empty data and preventing operators from detecting partial notification degradation.
- **File**: `src/app/api/tasks/notifications/route.ts`
- **Ảnh hưởng**: Task and Enrollment notification bells continue returning base notifications during enrichment failures without logging comment text, emails, or record identifiers.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 13

## 2026-08-11 — Report attachment deletion failures per file
- **Loại**: fix
- **Cái gì**: The shared attachment panel now tracks the file being deleted, prevents duplicate delete clicks, parses API/network failures, keeps the row visible on failure, and reports a refresh failure after a successful delete without pretending the delete failed.
- **Vì sao**: A non-OK response or network error was ignored, leaving users with no explanation and encouraging repeated clicks against the same attachment.
- **File**: `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`
- **Ảnh hưởng**: Enrollment attachment management (ACA and Medicare) and any future task-level consumer now expose accessible per-file feedback while preserving the existing API permission behavior.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 11

## 2026-08-11 — Reuse one Enrollment option snapshot during create
- **Loại**: perf, fix
- **Cái gì**: Enrollment create now builds one program-scoped option snapshot and validates every option field against its in-memory ID map, while preserving set membership, archived-option rejection, and first-stage fallback behavior. The helper remains backward compatible for callers that need a standalone lookup.
- **Vì sao**: A populated create request previously reloaded the same option sets/options once per field, increasing query load and allowing validation fields to observe different configuration snapshots.
- **File**: `src/lib/enrollment/options.ts`, `src/app/api/enrollment/route.ts`, `src/lib/enrollment/options.test.ts`
- **Ảnh hưởng**: ACA and Medicare create requests now use exactly one option-set query and one option query per request; no process-global cache or stale config window was introduced.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 10

## 2026-08-11 — Bound collaboration history and isolate enrollment file failures
- **Loại**: fix, perf
- **Cái gì**: Task and Enrollment detail loaders now fetch comments with a shared `(created_at, id)` cursor and 50-row page, include only returned-comment attachments, support older-page and deep-link loading, and preserve total comment counts from metadata. Enrollment attachment signing is isolated per file so one missing storage object renders as unavailable instead of failing the drawer.
- **Vì sao**: Unbounded comment/attachment reads and signing made detail opens scale with the entire history and allowed one storage failure to turn an Enrollment drawer into a 500.
- **File**: `src/lib/collaboration/comment-pagination.ts`, `src/lib/tasks/detail.ts`, `src/lib/enrollment/detail.ts`, `src/app/api/tasks/[id]/detail/route.ts`, `src/app/api/enrollment/[id]/detail/route.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Health CS, ACA, and Medicare collaboration drawers load a bounded initial history, retain reply/deep-link behavior, surface older-page failures, and keep healthy files/comments visible when an individual signed URL fails.
- **Ref**: `docs/superpowers/plans/2026-08-11-open-code-review-remediation.md`, Task 9

## 2026-08-10 — Fix task actor backfill SQL correlation
- **Loại**: fix
- **Cái gì**: Replaced the invalid `UPDATE tasks ... FROM LATERAL` actor backfill with a correlated scalar subquery and an explicit `exists` guard. The latest non-system actor and deterministic timestamp ordering are unchanged.
- **Vì sao**: PostgreSQL rejects references to the `UPDATE` target alias from that `FROM` item with error `42P10`, preventing the schema script from running.
- **File**: `supabase/schema.sql`
- **Ảnh hưởng**: Schema deployment can execute the `last_activity_by_email` backfill; tasks without a human activity row remain untouched. Production execution is still required.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, Task 12, commit `a558429`

## 2026-08-10 — Final task collaboration reconciliation
- **Loại**: security, perf
- **Cái gì**: Completed the repository-level collaboration hardening pass and recorded the final verification boundary: 560 tests, typecheck, lint, and production build pass. The read-only audit command was attempted but cannot query production without Supabase service credentials; live SQL/RPC, storage-fault, concurrency, browser/accessibility, and baseline backfill checks remain explicit release gates.
- **Vì sao**: Code-level P1/P2/P3 findings are implemented, but a go-live decision must not claim production data cleanliness or migration success that was not verified in this environment.
- **File**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`
- **Ảnh hưởng**: The plan now reports **NOT READY** pending production audit/migration/manual matrix and named Security/Product acceptance of the malware-scanning residual risk; after those gates pass the code is **READY WITH RISKS**.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, Task 25

### Format 1 entry
```
## YYYY-MM-DD — <tiêu đề ngắn>
- **Loại**: feat | fix | refactor-logic | security | perf | breaking
- **Cái gì**: mô tả thay đổi logic
- **Vì sao**: lý do / quyết định nghiệp vụ
- **File**: path/to/file.ts:line (các file chính)
- **Ảnh hưởng**: role/luồng/dữ liệu nào bị tác động
- **Ref**: doc / finding / commit (nếu có)
```

## 2026-08-10 — Stabilize comment thread navigation and mutation feedback
- **Loại**: fix, perf
- **Cái gì**: Thread scrolling now follows only the bottom/own-send cases, preserves a reader's position for remote comments, and exposes a New comments affordance. Relative timestamps refresh from one shared visible-thread clock. Drawer and Enrollment comment counts exclude deleted placeholders. Edit-history failures, delete failures, and post-delete reload warnings are shown inline; delete uses a focused confirmation dialog while keeping replies visible.
- **Vì sao**: Realtime rows previously pulled readers to the bottom, counters disagreed with list metadata, timestamps went stale, and mutation/history failures were either silent or misreported as empty history.
- **File**: `src/lib/tasks/thread-view.ts`, `src/lib/tasks/thread-view.test.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Health CS, ACA, and Medicare shared comment threads retain scroll context, keep accessible inline feedback, and preserve author-only delete semantics.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F22/F23

## 2026-08-10 — Harden attachment presentation and preview
- **Loại**: fix, security
- **Cái gì**: Attachment rows now expose safe filename/size/status information, unavailable files never expose storage paths, and the composer provides MIME hints plus duplicate/unsupported-file feedback. Image previews use a labelled dialog with focus containment/restoration, Escape/backdrop close, scroll locking, loading/error states, and Open/Download actions.
- **Vì sao**: Long names and URLs could overflow the thread, unavailable/signed-link failures were ambiguous, and the preview was mouse-only with no recovery or keyboard boundary.
- **File**: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Health CS, ACA, and Medicare shared comments remain usable at narrow widths and with slow/expired signed URLs; server attachment validation and signed-link lifetime are unchanged.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F24

## 2026-08-10 — Unify mentions across comment create, reply, and edit
- **Loại**: fix, security
- **Cái gì**: Added a positioned mention draft model shared by the Tasks/Enrollment comment composer and editor. Mention identity is preserved by email/range, search reuses normalized option filtering, and newly added mentions on edits are notified without trusting client-supplied emails.
- **Vì sao**: The editor previously saved newly typed `@Name` as plain text and could silently sever existing mentions when surrounding text changed; the picker also lacked accent-aware search, responsive sizing, and complete combobox/listbox semantics.
- **File**: `src/lib/tasks/mention-draft.ts`, `src/lib/tasks/mention-draft.test.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/api/tasks/[id]/comments/[cid]/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`
- **Ảnh hưởng**: Health CS, ACA, and Medicare create/reply/edit flows now keep mention identity stable, show canonical name chips, support keyboard/screen-reader selection, and send edit mention notifications as a warning-only post-commit side effect.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F20/F21

## 2026-08-10 — Authorize task detail before privileged reads
- **Loại**: fix, security
- **Cái gì**: Task detail now resolves all non-manager scope predicates before loading comments, activity, metadata, or signing attachment URLs. Activity is excluded at the detail query for roles that cannot view it instead of being loaded and stripped afterward.
- **Vì sao**: The previous parallel load performed privileged reads and minted signed URLs for arbitrary task IDs before returning 403 to unauthorized actors.
- **File**: `src/app/api/tasks/[id]/detail/route.ts`
- **Ảnh hưởng**: Unauthorized task-detail requests stop after authorization; manager and authorized role behavior remains unchanged while non-owner responses avoid activity queries.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F15

## 2026-08-10 — Expire and invalidate task detail cache safely
- **Loại**: fix, perf
- **Cái gì**: Added a five-minute TTL and explicit invalidation to the client task-detail cache, and changed drawer reload to return success/failure while preserving the last committed detail and showing a Retry affordance on failure.
- **Vì sao**: Detail payloads contain one-hour signed attachment URLs; an unbounded cache and swallowed reload errors could keep dead links and stale collaboration data in an open tab.
- **File**: `src/lib/tasks/detail-cache.ts`, `src/lib/tasks/detail-cache.test.ts`, `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`, `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Hover prefetch and task drawers no longer serve expired cache entries; transient reload failures remain recoverable without falsely marking committed comments/files as failed.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F16

## 2026-08-10 — Enforce comment and attachment operation limits
- **Loại**: fix, security
- **Cái gì**: Added shared operation-limit validation for 10,000-character comments, 10 files per comment, a 50MB aggregate attachment cap, and the existing per-file cap. The comment API rejects oversized text before work; attachment uploads re-check the running comment total before reading bytes; the composer mirrors the same messages before upload.
- **Vì sao**: Per-file checks alone left comment text, file count, and aggregate bytes unbounded, allowing accidental or abusive collaboration operations to consume excessive resources.
- **File**: `src/lib/tasks/attachment-limits.ts`, `src/lib/tasks/attachment-limits.test.ts`, `src/app/api/tasks/[id]/comments/route.ts`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Health CS comments and attachments receive deterministic boundary errors on both client and server. This is not malware scanning: magic-byte checks prevent type confusion only; authenticated Office/PDF uploads remain an accepted risk pending owner sign-off.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F17

## 2026-08-10 — Audit same-task collaboration links
- **Loại**: fix, security
- **Cái gì**: Confirmed task comment and attachment writes are routed through atomic commands that validate parent/comment task ownership, added the partial `task_attachments(comment_id)` index, and exposed a restricted read-only audit RPC/script for cross-task and nested reply links.
- **Vì sao**: Foreign-key references alone do not guarantee that a reply or attachment's `task_id` matches its linked comment's task, which could leak collaboration data across detail queries.
- **File**: `supabase/schema.sql`, `scripts/audit-task-collaboration.ts`
- **Ảnh hưởng**: Command paths retain the invariant without adding trigger overhead; operators can prove legacy data is clean before rollout. No direct non-command writer was found, so no trigger was added.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F18

## 2026-08-10 — Align task activity labels with the database vocabulary
- **Loại**: fix
- **Cái gì**: Added a testable `ACTIVITY_LABELS` map covering every allowed task activity type, including attachment and comment edit/delete events, and removed renderer branches for types that cannot exist in `task_activity`. Assignment wording continues to normalize historical removal metadata through `describeActivity`.
- **Vì sao**: Valid attachment events rendered as raw snake_case while dead branches implied unsupported lifecycle events and could drift from the SQL constraint.
- **File**: `src/app/(authed)/tasks/_components/activity-labels.ts`, `src/app/(authed)/tasks/_components/ActivityFeed.tsx`, `src/lib/tasks/activity-events.test.ts`
- **Ảnh hưởng**: Health CS task activity now has complete vocabulary coverage; unknown legacy rows remain readable via the fallback.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F14

## 2026-08-10 — Keep task last-activity actor paired with its timestamp
- **Loại**: fix, security
- **Cái gì**: Persisted `last_activity_by_email` from the same locked mutation that updates `last_activity_at`, excluded system activity from the backfill/read path, kept position-only reorder neutral, and made task archive/overview assignment preserve the human actor pair. The database trigger restores the previous actor when a stale timestamp is clamped.
- **Vì sao**: Deriving the actor from the newest activity row let cron bookkeeping show as the actor for an older human timestamp; independent writers could also split the pair or move it during a presentation-only reorder.
- **File**: `supabase/schema.sql`, `src/lib/tasks/queries.ts`, `src/lib/tasks/last-activity.ts`, `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`
- **Ảnh hưởng**: Task list metadata, stale/recent activity display, human PATCH/assignment/archive mutations, and legacy metadata fallback now use one deterministic pair; system overdue rows remain audit-only.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F10

## 2026-08-10 — Record assignee removals as unassigned activity
- **Loại**: fix
- **Cái gì**: Assignee removal mutations now write the `unassigned` activity type with `removed` and `next_primary` metadata. The activity renderer normalizes that event and older rows that incorrectly used `assigned` with `meta.removed`.
- **Vì sao**: The old feed described a removal as an assignment to the remaining person, hiding the actual audit action.
- **File**: `src/app/api/tasks/[id]/assignees/[email]/route.ts`, `src/lib/tasks/activity-events.ts`, `src/app/(authed)/tasks/_components/ActivityFeed.tsx`
- **Ảnh hưởng**: Task activity history in Health CS and shared task detail surfaces now communicates assignee removal accurately without rewriting historical rows.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F11

## 2026-08-10 — Create tasks atomically and idempotently
- **Loại**: fix, security
- **Cái gì**: Added `create_task_atomic` with a reporter-scoped request token. Task creation now commits the task, assignee rows, initial stage/assignment cycles, and `created` activity together; rotation, notifications, broadcasts, and display reconciliation run after commit as warning-producing side effects. The create dialog reuses one UUID across retries.
- **Vì sao**: The previous six-step create flow could return 500 after a task already existed, leaving partial history and causing a retry to create a duplicate.
- **File**: `supabase/schema.sql`, `src/app/api/tasks/route.ts`, `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- **Ảnh hưởng**: Health CS task creation now fails before any durable row on required-state errors, and an ambiguous/retried submit returns the original task without duplicate audit/cycle rows.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F12

## 2026-08-10 — Make overdue detection atomic and idempotent
- **Loại**: fix, security
- **Cái gì**: Added `mark_task_overdue_atomic`, which conditionally flips an in-progress task, inserts its open overdue event, and records `went_overdue` in one transaction. The cron only resolves recipients and notifies when the RPC returns `true`.
- **Vì sao**: Concurrent cron runs previously ignored the conditional update row count, allowing duplicate events/notifications and leaving a flagged task without a required activity row if a later write failed.
- **File**: `supabase/schema.sql`, `src/app/api/cron/check-overdue/route.ts`
- **Ảnh hưởng**: Overdue transition history is single-writer and rollback-safe; system bookkeeping remains excluded from human last-activity metrics.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F13

## 2026-08-10 — Resolve canonical names for collaboration history
- **Loại**: fix, security
- **Cái gì**: Added a batched historical identity resolver that reads `portal_account` without filtering inactive accounts. Task and Enrollment comment/detail loaders attach `author_name`/`actor_name`, edit-history routes attach `edited_by_name`, and shared rendering uses those names or `Unknown user` instead of guessing from an email local part.
- **Vì sao**: Active mention rosters are not a historical directory; deactivated or nameless authors were previously displayed with an invented name derived from their email.
- **File**: `src/lib/people/display-names.ts`, `src/lib/tasks/detail.ts`, `src/lib/enrollment/detail.ts`, `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Health CS, ACA, and Medicare comment, deleted-placeholder, activity, overdue, and edit-history surfaces show stable canonical labels while email remains an internal identity key.
- **Ref**: `docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md`, F19

---

## 2026-08-10 — Delete task attachment metadata before storage cleanup
- **Loại**: fix, security
- **Cái gì**: Added `delete_task_attachment_atomic`, which removes metadata, records `attachment_deleted`, and bumps task activity in one transaction before best-effort storage cleanup. The DELETE route now returns warnings rather than 500 after a durable metadata commit.
- **Vì sao**: Removing the object first could leave visible metadata pointing to nothing when the database delete failed.
- **File**: `supabase/schema.sql`, `src/app/api/tasks/[id]/attachments/[aid]/route.ts`
- **Ảnh hưởng**: Attachment deletion is durable before storage cleanup; storage or realtime failures no longer turn a successful delete into a retryable error.

## 2026-08-10 — Isolate unsignable task attachments
- **Loại**: fix
- **Cái gì**: Task detail signs each attachment independently and renders unavailable files as a neutral placeholder instead of rejecting the entire comment/activity load.
- **Vì sao**: One missing storage object previously caused the whole drawer to fail with 500.
- **File**: `src/lib/tasks/detail.ts`, `src/lib/tasks/detail.test.ts`, `src/app/(authed)/tasks/_components/CommentThread.tsx`, `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`
- **Ảnh hưởng**: Broken storage rows remain visible as unavailable metadata; healthy comments and files continue rendering.

## 2026-08-10 — Add typed task activity and mutation-result contracts
- **Loại**: feat
- **Cái gì**: Added the shared task activity vocabulary/metadata union and a `MutationResult`/warning helper for post-commit side effects.
- **Vì sao**: SQL writers, API routes, and the activity renderer previously drifted on allowed event names and had no common 2xx-with-warnings contract.
- **File**: `src/lib/tasks/activity-events.ts`, `src/lib/tasks/activity-events.test.ts`, `src/lib/tasks/mutation-result.ts`
- **Ảnh hưởng**: Future task collaboration mutations can share one typed event contract; unknown historical rows remain tolerated.

## 2026-08-10 — Clamp task version and activity timestamps monotonically
- **Loại**: fix, security
- **Cái gì**: Added the `tasks_updated_at_monotonic` trigger, made `touchLastActivity` return the committed `updated_at`, and returned that value from the task comment API as the optimistic-concurrency token.
- **Vì sao**: Slow comment/attachment writers could commit an older application timestamp after a newer PATCH, causing stale tokens and inconsistent last-activity display.
- **File**: `supabase/schema.sql`, `src/lib/tasks/last-activity.ts`, `src/lib/tasks/last-activity.test.ts`, `src/app/api/tasks/[id]/comments/route.ts`
- **Ảnh hưởng**: All task writers are protected at the database column; callers that patch after commenting now receive the actual committed version.

## 2026-08-10 — Add read-only task collaboration reconciliation audit
- **Loại**: chore, security
- **Cái gì**: Added a read-only `audit-task-collaboration.ts` report plus restricted Postgres audit functions for comment/activity gaps, unsignable attachments, last-activity actor mismatches, overdue gaps, and duplicate-comment candidates. Extended the task activity constraint with edit/delete event types needed by later atomic commands.
- **Vì sao**: Collaboration repairs need reproducible baseline evidence and must never infer a destructive repair from duplicate text or a partial activity trail.
- **File**: `scripts/audit-task-collaboration.ts`, `supabase/schema.sql`
- **Ảnh hưởng**: Service-role operators gain read-only reconciliation output; no user-facing mutation or automatic repair is performed.


## 2026-08-10 — Preserve initial Enrollment stage history in create RPC
- **Loại**: fix
- **Cái gì**: `create_enrollment_atomic` now writes the initial `enrollment_stage_history` row in the same transaction as the record and first stage cycle.
- **Vì sao**: Moving create out of the route removed the old best-effort history write; without this, newly created records had cycle data but no initial stage transition.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`
- **Ảnh hưởng**: Only new Enrollment records with a stage receive the initial history row; no existing data is changed.

## 2026-08-10 — Add scoped live stage-dwell metrics to Enrollment Overview
- **Loại**: feat, perf
- **Cái gì**: Added a paginated, count-guarded stage-cycle query scoped by visible enrollment record IDs, restricted to completed live dwell cycles from the last 90 days. The Overview now shows median/p75 time-in-stage and an explicit insufficient-sample state; archived stage labels remain readable for historical rows.
- **Vì sao**: Stage dwell must respect record visibility rather than cycle owner snapshots, avoid PostgREST truncation, exclude zero-second terminal markers/backfill data, and remain distinct from existing create-to-close cycle time.
- **File**: `src/lib/enrollment/stage-metrics.ts`, `src/lib/enrollment/stage-metrics.test.ts`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/overview-types.ts`, `src/lib/enrollment/overview.ts`, `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`, `src/app/api/enrollment/overview/route.ts`
- **Ảnh hưởng**: Overview adds one metrics section and extra bounded reads; list/detail behavior and existing `cycleTime` semantics are unchanged.


## 2026-08-10 — Route Enrollment mutations through atomic stage tracking RPCs
- **Loại**: feat, fix
- **Cái gì**: Enrollment create, patch, and archive now call the atomic RPCs so record updates, stage cycles, stage history, and mutation activities share one transaction. Comment and attachment mutations use `enrollment_touch_activity` and retain their existing activity/notification behavior.
- **Vì sao**: The previous routes committed the record first and wrote stage history/activity best-effort afterward, allowing stage-time invariants and audit history to drift when a side effect failed.
- **File**: `src/app/api/enrollment/route.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/api/enrollment/[id]/comments/route.ts`, `src/app/api/enrollment/[id]/comments/[cid]/route.ts`, `src/app/api/enrollment/[id]/attachments/route.ts`, `src/app/api/enrollment/[id]/attachments/[aid]/route.ts`
- **Ảnh hưởng**: Enrollment mutation conflict/schema errors are surfaced explicitly; notifications, broadcasts, storage cleanup, and existing permission checks remain best-effort/unchanged outside the durable mutation transaction.


## 2026-08-10 — Expose Enrollment stage-time fields and fail closed on schema drift
- **Loại**: feat, fix
- **Cái gì**: Enrollment queries now select the four stage-time/activity tracking columns, shared schema-drift errors return an explicit 503, and missing-column fallbacks only apply to the specific legacy columns they name. Added pure helpers/tests for current-stage dwell and duration summaries.
- **Vì sao**: Deploying application code before the tracking rollout must not silently return records with tracking fields missing; duration calculations also need one reusable, testable contract.
- **File**: `src/lib/enrollment/schema-errors.ts`, `src/lib/enrollment/stage-time.ts`, `src/lib/enrollment/queries.ts`, `src/lib/enrollment/types.ts`, `src/lib/enrollment/overview-data.ts`, `src/lib/enrollment/overview-types.ts`
- **Ảnh hưởng**: Enrollment list/detail/overview now require the tracking schema and can report migration drift instead of masking it; legacy description/custom-values fallbacks remain narrowly scoped.


## Unreleased

## 2026-08-09 — Add idempotent Enrollment stage-time backfill
- **Loại**: chore
- **Cái gì**: Thêm backfill rollback-safe theo record watermark, khôi phục initial stage visits, materialize history source classification, seed current dwell/entry markers, normalize human activity actors và validate tracking invariants.
- **Vì sao**: Backfill phải chạy sau atomic RPC deployment để không chụp mutation hậu-commit cũ, không ghi đè live measurements và chạy lại cho cùng kết quả.
- **File**: `supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql`
- **Ảnh hưởng**: Historical Enrollment ACA/Medicare stage cycles và denormalized tracking fields; production script cần chạy sau code rollout.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-06/CODEX-07

## 2026-08-09 — Add Enrollment stage-time RPC scratch assertions
- **Loại**: test
- **Cái gì**: Thêm rollback-only PostgreSQL assertions cho create/PATCH/archive, terminal markers, owner snapshot, monotonic timestamps, invalid activity/fields, idempotent archive và database invariants.
- **Vì sao**: SQL RPC correctness không được chứng minh bằng TypeScript tests; fixture dùng stage set ACA đã seed và không để lại dữ liệu.
- **File**: `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`
- **Ảnh hưởng**: Chỉ scratch database; production data không bị ghi.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-08/CODEX-16

## 2026-08-09 — Add atomic Enrollment stage mutation RPCs
- **Loại**: feat, security
- **Cái gì**: Thêm `patch_enrollment_atomic`, `create_enrollment_atomic`, `archive_enrollment_atomic` và `enrollment_touch_activity`; các RPC khóa record, enforce monotonic `updated_at`, normalize email, ghi cycle/history/activity trong cùng transaction và fail closed với unknown fields/invalid activity.
- **Vì sao**: Ngăn stale overwrite, thiếu stage history/cycle, terminal/archive tracking gap và actor/email scope drift.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`
- **Ảnh hưởng**: Enrollment ACA/Medicare mutation paths; routes chưa chuyển sang RPC cho tới Task 5.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-03/CODEX-05/CODEX-10/CODEX-11/CODEX-13/CODEX-16

## 2026-08-09 — Add Enrollment stage-time tracking schema
- **Loại**: feat
- **Cái gì**: Thêm các mốc stage/activity trên `enrollment_records` và bảng `enrollment_stage_cycles` với unique open-cycle invariant, source tracking, terminal-marker distinction, index và RLS.
- **Vì sao**: Tạo nền schema cho stage dwell/revisit metrics mà không tách cycle khi chỉ đổi owner và không làm thay đổi semantics usage count của Config archive.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`
- **Ảnh hưởng**: Enrollment ACA/Medicare; chưa có route nào đọc/ghi cycle cho tới các task tiếp theo.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-02/CODEX-03/CODEX-04

## 2026-08-09 — Prevent comment mention menu from covering composer actions
- **Loại**: fix
- **Cái gì**: Menu gợi ý khi gõ `@` được portal ra ngoài drawer, neo theo vị trí caret và tự chọn hướng mở. Composer docked ở đáy luôn mở menu lên trên; reply composer tự chọn phía còn đủ chỗ. Menu tự đo lại khi textarea resize, viewport resize hoặc vùng comment scroll.
- **Vì sao**: Menu cũ render absolute bên trong khung `overflow-hidden`, nên ở đáy Enrollment/CS drawer nó mở xuống, bị cắt và đè lên Attach/Clear/Send.
- **File**: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Mention picker dùng chung trong comment của Health CS, ACA và Medicare; logic lưu mention và gửi comment không đổi.
- **Ref**: user screenshot 2026-08-09

## 2026-08-09 — Backfill Agent for generated Enrollment QA samples
- **Loại**: fix, data
- **Cái gì**: Mở rộng `--backfill-agents` từ 27 fixture hardcode sang cả bộ generated QA, nhưng chỉ nhận record đồng thời có Client Name bắt đầu bằng `[Sample QA]` và FUB thuộc đúng `https://sample.qa/enrollment-{program}/...`. Có thêm `--dry-run`; assignment round-robin dùng toàn bộ tập QA đã sort để rerun sau partial write không làm lệch mapping.
- **Vì sao**: Audit cũ nhầm 640 generated QA records là non-sample vì chúng không nằm trong mảng fixture hardcode. Do đó backfill báo xong 27 record nhưng list vẫn còn 320 ACA + 320 Medicare hiển thị `Assign` ở cột Agent.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Chỉ sample Enrollment có hai marker QA nghiêm ngặt và `agent_email IS NULL`; record khách thật và Agent đã có sẵn không bị thay đổi.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`, post-rollout correction

## 2026-08-09 — Recommend colors for new dropdown values
- **Loại**: fix
- **Cái gì**: Config automatically assigns the least-used color from the shared dropdown palette when an admin adds a Category, custom dropdown option, or Enrollment option without manually choosing a color. The Config color cell previews the same softened/tinted badge treatment used by its consumer while retaining a small raw-color picker for overrides. The visible `Auto` button cycles through the remaining recommendations and stays available after a manual override.
- **Vì sao**: The native picker displayed the stored saturated hex while List/Detail rendered a transformed badge, so admins could not see the actual result; Category/custom creation could also submit `null` despite showing a gray picker.
- **File**: `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/table-config/value-colors.ts`
- **Ảnh hưởng**: Dropdown-value creation and color editing in Health CS, ACA, and Medicare Config. Existing List/Detail/Create badge colors and stored existing values are unchanged.
- **Ref**: user request 2026-08-09

## 2026-08-09 — Searchable custom dropdown/person selection lifecycle
- **Loại**: refactor-logic, fix
- **Cái gì**: Custom dropdown/person cells now use the same anchored searchable selection flow as system fields. Selection still commits only on an existing option, supports the original clear row, closes before saving, skips normalized-equal values, and preserves save-error feedback.
- **Vì sao**: Replacing the native select must not introduce free-form values, blur-triggered saves, duplicate commits, or accidental resets while users search long configured lists.
- **File**: `src/app/(authed)/_shared/EditableCustomCell.tsx`, `src/app/(authed)/_shared/SearchableListboxPanel.tsx`, `src/lib/table-config/values.ts`
- **Ảnh hưởng**: CS custom dropdown/person fields in list/detail and Enrollment custom fields; text/number/date/link/checkbox behavior remains unchanged.
- **Ref**: `docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md`, Task 7

## 2026-08-09 — Khóa nội dung chính Enrollment đối với CS worker
- **Loại**: fix, security
- **Cái gì**: Tách capability `canEditContent` cho Client Name, FUB Link và Description. Manager, agent-owner/assistant và creator được sửa; Caller/Responsible chỉ làm workflow nên ba field này read-only. API PATCH áp cùng guard và trả 403, không chỉ disable UI.
- **Vì sao**: Enrollment trước đây dùng `canEditFields` cho cả nội dung chính lẫn dữ liệu vận hành, khiến CS worker sửa được thông tin mà bên Health CS chỉ manager/agent-owner/reporter được sửa.
- **File**: `src/lib/enrollment/access.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/lib/enrollment/capabilities.test.ts`
- **Ảnh hưởng**: ACA và Medicare detail drawer. Caller/Responsible vẫn đổi Stage/Reopen và các field vận hành Enrollment theo matrix hiện tại; quyền create, QC, archive, assign và transfer agent không đổi.
- **Ref**: user request 2026-08-09; Health CS `canEditContent` precedent

## 2026-08-09 — Chỉ default Enrollment Assignee filter cho plain worker
- **Loại**: fix
- **Cái gì**: Filter mặc định `Responsible/Assignee = current user` chỉ được khởi tạo cho plain worker. Manager mở toàn bộ dữ liệu; agent và assistant mở toàn bộ record đã được server giới hạn trong agent scope của họ, không bị lọc tiếp theo tên cá nhân.
- **Vì sao**: Điều kiện cũ dùng `!canManageOptions`, nên vô tình áp default cá nhân cho mọi non-manager và che mất record hợp lệ của agent/assistant trong cùng scope.
- **File**: `src/app/(authed)/enrollment/page.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: ACA và Medicare initial list filters; không đổi server visibility, quyền mutation hoặc hành vi khi người dùng tự chọn/reset filter.
- **Ref**: user request 2026-08-09

## 2026-08-09 — Enforce Enrollment agent scope and explicit export permission
- **Loại**: security, breaking
- **Cái gì**: ACA/Medicare now enforce the same agent/assistant scope on list, overview, export, deep links and every record-by-ID API. Mutation rights are split by action: agent-owner/assistant controls QC, people assignment and archive; caller/responsible can edit workflow fields and change/reopen stage; creator can edit fields; managers retain all actions. Agent transfer is reserved for manager, agent-owner/assistant or creator. Creating a record requires manager access or ownership/assistant scope for the selected agent. Task and Enrollment exports now require the independent `task.export` permission in both UI and API.
- **Vì sao**: Service-role reads previously allowed out-of-scope UUID access, a single broad client predicate exposed controls the server should reject, and manager status alone was an implicit data-export entitlement.
- **File**: `src/lib/enrollment/access.ts`, `src/lib/enrollment/scope.ts`, `src/app/api/enrollment/**`, `src/app/(authed)/enrollment/**`, `src/lib/table-config/export-access.ts`, `src/app/api/tasks/export/route.ts`, `src/lib/rbac/permissions.ts`, `supabase/schema.sql`
- **Ảnh hưởng**: Scoped agents/assistants only see records for agents they cover; null-agent records fail closed for scoped viewers. Plain task workers keep the shared queue view but cannot create unless they have agent scope. Existing managers without `task.export` lose Export until the permission is granted. Health CS permission behavior was verified and intentionally not changed.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; commits `1e5a763`…`ff12606`

## 2026-08-09 — Thêm chế độ seed assistant có guard
- **Loại**: feat, security
- **Cái gì**: Seed script chỉ tạo assistant membership khi người chạy truyền explicit `cs:agent` allow-list, bật `SEED_ALLOW_ASSISTANTS=1`; hỗ trợ `--dry-run`, in target database và toàn bộ pair trước khi ghi.
- **Vì sao**: Assistant có quyền ngang agent-owner; tự chọn active account hoặc chạy nhầm production có thể cấp quyền truy cập dữ liệu ngoài ý muốn.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Không có write mặc định; chỉ các pair hợp lệ trên môi trường được xác nhận mới được upsert vào `agent_members`.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; Phase 0 Task 0.2

## 2026-08-09 — Gán agent hợp lệ cho enrollment sample
- **Loại**: feat
- **Cái gì**: Enrollment sample seed lấy roster từ giao của `task_agents` và active `portal_account`, phân bổ agent round-robin ổn định với cùng roster, ghi `agent_email` cho record mới và hỗ trợ `--backfill-agents` cho sample cũ.
- **Vì sao**: Sample cũ không có agent nên không thể kiểm thử permission/scope agent-assistant; chỉ đọc `task_agents` có thể chọn account inactive mà API Enrollment từ chối.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Chỉ sample records có FUB link nằm trong fixture; backfill chỉ cập nhật `agent_email` đang null và không tải/chạm record ngoài sample.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; Phase 0 Task 0.1

## 2026-08-09 — Làm drift test SLA kiểm tra mọi khai báo SQL
- **Loại**: test, refactor-logic
- **Cái gì**: Các test đồng bộ SLA đọc toàn bộ SQL matches bằng `matchAll`, thay vì chỉ kiểm tra match đầu tiên; mọi khai báo default tìm được phải khớp với TypeScript constant.
- **Vì sao**: `task_reminder_settings.todo_hours` có cả CREATE và ALTER declaration, nên đọc một match có thể bỏ sót drift ở declaration còn lại.
- **File**: `src/lib/tasks/sla-config.test.ts`
- **Ảnh hưởng**: Chỉ tăng độ tin cậy verification; không thay đổi runtime/API.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding B-02

## 2026-08-09 — Rollback SLA editor sau save lỗi và Reset
- **Loại**: fix
- **Cái gì**: SLA row đồng bộ lại hour/minute khi rule prop thay đổi (bao gồm Reset), và khôi phục giá trị trước đó nếu POST save thất bại; các commit UI cũ hơn bị bỏ qua khi đã có commit mới.
- **Vì sao**: trước đây local state chỉ khởi tạo một lần, nên Reset thành công vẫn hiển thị override cũ; network/API failure cũng để UI hiển thị giá trị chưa được lưu.
- **File**: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ hiển thị/trạng thái SLA admin editor; không đổi giá trị đã lưu hoặc API contract.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; findings stale Reset/save failure

## 2026-08-09 — Serialize SLA rule saves per row
- **Loại**: fix
- **Cái gì**: SLA rule dropdowns và Reset bị khóa theo từng row trong lúc request đang bay; parent dùng functional state update để các row khác nhau không ghi đè lẫn nhau khi save đồng thời.
- **Vì sao**: trước đây `savingKey` chỉ theo dõi một row và callback save dùng snapshot `rules` cũ, nên thao tác nhanh hoặc save hai row cùng lúc có thể để response cũ xoá mất thay đổi mới.
- **File**: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ SLA admin editor; mỗi row vẫn có thể save độc lập, không đổi API/storage.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding SLA save race

## 2026-08-09 — Giới hạn lựa chọn phút theo bounds SLA
- **Loại**: fix
- **Cái gì**: SLA editor lọc minute options theo hour selection, không còn offer `0h 0m` hoặc các tổ hợp vượt quá `168h`; khi đổi giờ, phút hiện tại được clamp về lựa chọn hợp lệ gần nhất.
- **Vì sao**: UI trước đó cho chọn `168h 55m` dù API từ chối trên 10,080 phút, khiến giá trị hiển thị khác giá trị lưu.
- **File**: `src/lib/tasks/sla-config.ts`, `src/lib/tasks/sla-config.test.ts`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ SLA admin editor; API bounds, storage và overdue computation không đổi.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding B-01

## 2026-08-09 — Hiển thị neutral state cho option Enrollment chưa chọn
- **Loại**: fix
- **Cái gì**: Các identity option badge chưa có giá trị trong Enrollment List dùng neutral background `#f4f5f7` và foreground `#5e6c84`, thay vì bị JSX ghi đè thành nền trong suốt.
- **Vì sao**: Helper palette đã có empty-state trung tính nhưng render path bỏ qua nó khi `option` là `null`, khiến empty value không đồng nhất với badge đã chọn.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Chỉ hiển thị List; không đổi option value, payload, permission hay validation.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commit `b86ffbb`

## 2026-08-09 — Đồng bộ badge option Enrollment theo hai ngôn ngữ của Health CS
- **Loại**: fix, refactor-logic
- **Cái gì**: Enrollment List phân biệt hai loại badge: Carrier / Payment / AC / Platform / Consent dùng identity badge solid theo màu option, chữ uppercase và không có chevron; Stage giữ workflow-state badge nền tint 0.14 và chỉ hiện chevron khi record editable. Palette và contrast logic dùng `src/lib/enrollment/option-badge.ts`, tái sử dụng `readableTextColor` của CS.
- **Vì sao**: Enrollment option chip nhạt 0.08, chữ thường và chevron luôn hiện nên không cùng design language với CS `CategoryBadge`; Stage lại bị hiển thị affordance dù read-only.
- **File**: `src/lib/enrollment/option-badge.ts`, `src/lib/enrollment/option-badge.test.ts`, `src/lib/tasks/category-colors.ts`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: chỉ thay đổi List presentation/affordance; Detail form controls, payload, permission, validation và program-specific fields không đổi. ACA và Medicare dùng chung implementation.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commits `f20392e`, `912bb00`

## 2026-08-09 — Chuẩn hóa empty state person field trong Enrollment Create
- **Loại**: fix
- **Cái gì**: `EnrollmentPersonMenu` đổi từ boolean `field` sang surface union `list | form-bare | form-field`. ACA và Medicare Create dùng `form-bare`, nên Agent / Caller / Responsible không còn render pill `Assign` nét đứt của List bên trong border của `CreatePropertyField`; List vẫn giữ CTA `Assign`, Detail vẫn giữ control có border và chevron.
- **Vì sao**: một prop boolean đang gộp hai trách nhiệm khác nhau: surface và border chrome. Empty state List đúng nhưng bị dùng nhầm trong Create.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: chỉ thay đổi presentation/affordance của person fields; không đổi payload, permission, required validation hoặc cardinality. `agent_email`, `caller_email`, `responsible_enroll_email` vẫn là single-person text fields.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commit `c51691f`

## 2026-08-09 — Di chuyển cấu hình SLA vào Health Table Configuration
- **Loại**: feat, fix, refactor-logic, breaking
- **Cái gì**: Chuyển giao diện quản trị `SLA Times` từ modal trên CS Task Board sang tab `SLA Times` trong `/config`; gom các constant UI/validation vào `src/lib/tasks/sla-config.ts`; xoá `SlaRulesModal.tsx`. API `POST /api/admin/task-sla-rules` nay từ chối `duration_minutes` ngoài khoảng 1–10080 phút (tối đa 168 giờ). Thêm test khóa `DEFAULT_SLA_MINUTES` và `DEFAULT_REMINDER_SETTINGS` đồng bộ với `supabase/schema.sql`.
- **Vì sao**: Tập trung toàn bộ cấu hình quản trị vào `/config`, tránh hardcode SLA trong component UI và tránh API chấp nhận giá trị mà UI không thể hiển thị/chỉnh sửa lại.
- **File**: `src/lib/tasks/sla-config.ts`, `src/lib/tasks/sla-config.test.ts`, `src/app/api/admin/task-sla-rules/route.ts`, `src/app/(authed)/config/page.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`
- **Ảnh hưởng**: Admin quản lý SLA tại `/config`; quyền truy cập vẫn do `loadConfigAdmin()`/manager gate quyết định. Người dùng Task Board vẫn đọc `slaRules` để hiển thị overdue/countdown; không đổi SLA computation, storage shape hoặc read permission. Direct API caller lưu SLA trên 168 giờ sẽ nhận `400` thay vì `200`.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; source commits `3ec0616`, `36e41cc`, `30746ba`

## 2026-08-08 — Fix bug UI nhảy A→B→A→B (race condition) ở Enrollment + Config + CS [Phase 0]
- **Loại**: fix, breaking (tăng khả năng gặp 409 khi có người comment — xem Ảnh hưởng)
- **Cái gì**: Review toàn bộ module Task (CS/Enroll/Config) bằng 2 agent độc lập + 1 vòng debate đối kháng. **Phát hiện quan trọng: 1 triệu chứng nhưng 3 nguyên nhân khác nhau**, không phải 1 root cause chung như giả định ban đầu:
  1. **Enrollment — race thật (nguyên nhân chính)**: `refetch()` kiểm tra điều kiện chặn (`pendingRef.size === 0`) **sau** khi request về, thay vì lúc gửi đi. Nên 1 GET xuất phát *trước* lúc ghi commit nhưng về *sau* sẽ đè snapshot cũ lên dữ liệu vừa ghi. Cộng debounce 300ms của realtime → ra đúng nhịp A→B→A→B cách nhau ~0.5s. **Sửa**: bắt `refetchSeqRef` (chỉ refetch mới nhất được áp) + `hadPendingAtIssue` (refetch gửi lúc đang có ghi thì vĩnh viễn không được áp).
  2. **Hệ quả nặng hơn cả bug hiển thị**: sau khi snapshot cũ đè lên, `updated_at` trong state thành giá trị cũ → lần sửa kế gửi `expected_updated_at` sai → **409** → code rollback về đúng bản cũ đó → **record kẹt, không sửa được nữa**. Đây chính là lời giải cho lỗi "Task was updated by someone else" gặp trong lúc test trước đó — lỗi thật, không phải do tab giữ state cũ.
  3. **CS**: đã có 4 ref canh từ trước nên hiếm gặp, nhưng response bị giữ lại thì **bị vứt luôn** (kèm cả update của người khác) cho tới ping kế tiếp. **Sửa**: đánh dấu `tasksRefetchDirtyRef` và chạy lại khi mutation settle, thay vì bỏ.
  4. **Config — KHÔNG phải race**: optimistic giữ nguyên thứ tự mảng, còn echo từ server thì sort lại (khoá sort đầu tiên là `hidden_default`) → dòng vừa toggle bị đẩy xuống cuối bảng ~1s sau; đồng thời server ép thêm field mà client không áp (`show_in_detail=true` khi set Required cho cột custom) → nút "In detail" tự bật lên sau 1s. **Sửa**: tách luật ép field thành **1 hàm dùng chung `applyColumnPatchInvariants()`** gọi bởi CẢ server route lẫn optimistic update ở client (không thể lệch nhau nữa), và tách comparator thành `sortConfigEditorColumns()` dùng chung cho cả list lẫn optimistic. Thêm khoá 8 toggle khi đang lưu để chặn đường race 2-lần-bấm.
  5. `touchLastActivity()` giờ bump luôn `updated_at` — trước đó chỉ ghi `last_activity_at`/`stale_reminded_at`, nghĩa là nội dung hiển thị của dòng đổi mà version không đổi (đã verify: schema **0 trigger** tự bump `updated_at`, mọi route tự set tay).
- **Vì sao**: 2 phương án "hiển nhiên" đều bị chính người đề xuất rút lại sau debate — (a) dùng `updated_at` làm khoá so sánh mới/cũ: **sai**, vì có đường ghi đổi nội dung mà không bump version, và timestamp do app sinh trên nhiều serverless instance nên lệch đồng hồ; (b) dùng TanStack Query `cancelQueries`: **không đủ**, vì request gây lỗi *sinh ra giữa lúc mutation đang bay*, lúc `cancelQueries` chạy chưa có gì để cancel.
- **File**: `enrollment/_components/EnrollmentClient.tsx`, `tasks/_components/TaskBoardClient.tsx`, `lib/tasks/last-activity.ts`, `lib/table-config/columns.ts` (2 hàm mới dùng chung + 9 test), `api/config/columns/[id]/route.ts`, `config/_components/ConfigClient.tsx`
- **Ảnh hưởng**: **Cần theo dõi** — vì `updated_at` giờ được bump khi có comment, người đang mở task từ trước lúc ai đó comment mà sửa task sẽ gặp 409 "updated by someone else" thường hơn trước. Đây là đánh đổi có chủ đích (version giờ phản ánh đúng thay đổi), nhưng nếu gây phiền thì hướng xử lý đúng là tự rebase khi 409 (Phase 2), không phải quay lại để version nói dối.
- **Ref**: `docs/superpowers/plans/2026-08-08-task-module-state-architecture.md` (plan đầy đủ 5 phase; đây mới là Phase 0 "chặn máu"). Phase 1-2 (tách state optimistic khỏi state server thành primitive dùng chung cho cả 3 module) và Phase 3 (perf: module hiện **không có `React.memo`** nào, 1 lần sửa ô Enrollment = ~100 API call ở 50 user) chưa làm.

### Sửa tiếp sau vòng review Phase 0 (cùng đợt)
Cho 1 agent review lại đúng phần code Phase 0 vừa viết, nó bắt được **2 lỗi do chính đợt sửa này gây ra** + 3 lỗi sẵn có:
- **(do đợt này gây ra) Bump `updated_at` khi comment làm hỏng luồng comment→sửa**: `POST /api/tasks/[id]/comments` chỉ trả `{comment}`, không trả `updated_at` mới → state của board giữ token cũ → sửa task ngay sau khi comment bị **409**, và đường rollback còn cài lại token cũ + tái kích hoạt cooldown 3s nên task kẹt tới khi ngừng bấm 3s. **Sửa**: cả 2 route comment (CS + Enrollment) nay trả `parent_updated_at`, `CommentThread` (dùng chung) đẩy ngược lên qua `onParentUpdatedAt` để list cập nhật token. Enrollment vốn đã trả `record` nhưng client bỏ qua — nay cùng dùng 1 field chung.
- **(do đợt này gây ra) Sort lại mảng optimistic ở Config làm dòng "teleport"**: dòng chỉ có animation khi đang kéo-thả, nên sort lại lúc toggle khiến dòng **biến mất khỏi dưới con trỏ ngay lập tức** → mất luôn phản hồi thị giác, user tưởng nút không ăn. **Sửa gốc**: bỏ hẳn việc sort editor theo `hidden_default` (dùng `sortColumns` thuần theo position), đánh dấu cột ẩn bằng cách làm mờ dòng. Việc này còn sửa 1 lỗi dữ liệu có sẵn: `handleDragEnd` ghi `position = index+1` theo thứ tự editor, nên mỗi lần kéo-thả là **ghi cứng luôn thứ tự "cột ẩn nằm cuối" vào position thật**, bỏ ẩn sau đó thì cột kẹt lại dưới cùng.
- **Khoá toggle khi đang lưu là hướng sai** (thêm ở 0.5): `busy` là biến global nên khoá **toàn bộ 8 toggle của mọi dòng** ~0.5-1s → bấm toggle thứ 2 bị **nuốt im lặng**, khiến chính tiêu chí nghiệm thu "2 toggle trong 500ms đều phải lưu" không thể đạt. **Sửa**: bỏ khoá, thay bằng đếm số PATCH đang bay — chỉ patch cuối cùng settle mới gọi refresh (patch còn bay thì snapshot server chưa chứa nó, áp vào sẽ revert toggle kia).
- **Cờ hoãn-refetch không bao giờ chạy tới**: cờ được set *trong* handler response, nhưng chỗ chạy lại chỉ nằm ở `finally` của mutation — mà mutation thường settle **trước** khi response bị giữ lại về, nên flush chạy rồi mới có cờ → không bao giờ chạy lại. **Sửa**: nếu lúc đó không còn ghi nào đang bay thì chạy lại ngay tại chỗ; đồng thời xoá cờ khi có lần áp thành công (trước đó cờ kẹt `true` vĩnh viễn, gây refetch thừa).
- **`refreshScope` nằm trong `try` của Config**: GET lỗi sẽ rollback một lần ghi **đã thành công** — nút bật lại về cũ trong khi server đang giữ giá trị mới. **Sửa**: đưa ra ngoài `try`. Rollback cũng đổi từ khôi phục nguyên mảng sang **chỉ khôi phục đúng cột đó**, để không xoá mất chỉnh sửa cột khác đang bay.
- **`createRecord`/`archiveRecord` không đăng ký vào `pendingRef`** → refetch chạy song song coi là "sạch" và áp vào: record vừa tạo biến mất, record vừa archive sống lại. **Sửa**: đăng ký như mọi write khác.

## 2026-08-08 — Thông báo chuyển từ banner chèn layout sang toast nổi (toàn app)
- **Loại**: fix (UX)
- **Cái gì**: các thông báo trạng thái trước đây render **trong luồng layout**, nên khi hiện lên là **đẩy nguyên bảng xuống** và khi tắt thì giật ngược lên — rất khó chịu khi đang thao tác giữa bảng. Gom thành 1 component chung `_shared/Toast.tsx` (nổi, `fixed`, tự tắt sau 5s, có nút đóng, xếp chồng được) và áp cho: Config (`notice`), Account Manager (`error`/`message`), Role Manager (`error`/`message`). Đồng thời gộp luôn 2 toast tự chế khác nhau đang có ở CS và Enrollment về dùng chung component này (trước đó mỗi chỗ 1 kiểu). Bỏ effect tự-xoá-lỗi trùng lặp ở Enrollment vì Toast đã lo.
- **Vì sao**: user phản ánh trực tiếp trên màn Config — "cái này nó sẽ đẩy cái bảng xuống không tiện lắm", yêu cầu sửa cho tất cả các phần.
- **File**: `_shared/Toast.tsx` (mới), `config/_components/ConfigClient.tsx`, `account-manager/AccountManagerClient.tsx`, `role-manager/RoleManagerClient.tsx`, `tasks/_components/TaskBoardClient.tsx`, `enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: không đổi logic nghiệp vụ. Timer auto-dismiss giữ trong ref nên parent re-render không làm reset đếm ngược.

## 2026-08-08 — Nhãn cột (label) trong Create/Detail/Filter/Kanban giờ đọc live từ table_column, không hard code
- **Loại**: fix, refactor-logic
- **Cái gì**: Audit (2 subagent song song + 2 subagent phản biện kiến trúc) phát hiện: admin ĐƯỢC PHÉP đổi tên (label) mọi cột kể cả cột hệ thống qua `/config` → Table Columns (`canEditColumnField` cho phép `label` với `is_system=true`), nhưng rất nhiều nơi hiển thị nhãn đó bằng chữ hard code thẳng trong JSX, không đọc `table_column.label` — nên đổi tên trong Config không có tác dụng gì ở các chỗ đó. Đã sửa toàn bộ: (1) CS `NewTaskDialog`/`TaskDetailDrawer` — mọi nhãn field (Client Name, FUB Link, Description, Priority, Category, Agent, Assignee, Stage, Created by, Assignees, QC Review) giờ đọc `columnByKey.get(key)?.label ?? <chữ cũ làm fallback>`. (2) Enrollment `EnrollmentDrawer`/`NewEnrollmentDialog` — tương tự cho toàn bộ field (Client Name, FUB, Description, Stage, Due date, Payment, Carrier, AC, Consent, Platform, Agent, Caller, Responsible/Assignee, Created by, PCP 2025/2026, QC). (3) 2 ô List-cell Enrollment (`pcp2026`, `due`) trước đó hard code lệch khỏi pattern đúng đã có sẵn 2 dòng kế bên — sửa khớp. (4) Filter dropdown ở toolbar (cả CS lẫn Enrollment: Agent/Category/Status/Priority/Stage/Carrier/Payment/Caller/Responsible) cũng đọc label live thay vì chữ cứng. (5) CS Kanban board trước giờ KHÔNG hề nhận `visibleColumnKeys`/config gì cả — ẩn cột Priority/Category/QC trong Config chỉ ẩn được ở Create/Detail/List, card Kanban vẫn hiện — nay Kanban nhận `visibleColumnKeys` (từ `adminVisibleColumnKeys`, xuyên suốt `KanbanBoard → Column → SortableCard → TaskCard`) và ẩn đúng 3 badge đó khi cột bị ẩn.
- **Cơ chế dùng chung** (để tránh lặp lại kiểu "bảng dịch hard code" mà session này đã bác bỏ 1 lần cho Required-field): mỗi component cha (`TaskBoardClient.tsx`, `EnrollmentClient.tsx`) build 1 `columnByKey: Map<key, column>` DUY NHẤT từ danh sách cột ĐÃ resolve sẵn cho List view (`taskListColumnConfig`/`columns` — vốn đã đúng label/Medicare-relabel), không tạo file/hàm helper dùng chung mới, không build lại từ config thô lần 2 (tránh mất Medicare relabel).
- **Vì sao**: user yêu cầu review toàn bộ code tìm điểm hard code liên quan cột không tuân theo config; đã cho 2 agent research độc lập + 2 agent debate kiến trúc trước khi viết plan cuối, tránh vừa thiếu (bỏ sót Kanban) vừa thừa (không thêm custom-field render lên Kanban card — đó là tính năng mới, ngoài phạm vi).
- **File**: `tasks/_components/{NewTaskDialog,TaskDetailDrawer,TaskToolbar,KanbanBoard,TaskCard,TaskBoardClient}.tsx`, `enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Vài field đổi hiển thị NGAY LẬP TỨC không cần admin làm gì, vì label thật trong DB khác chữ hard code cũ — đã audit riêng bằng 1 subagent review + query DB trực tiếp để phân biệt 2 loại: (a) **thống nhất lại đúng ý** — CS "Created by"→"Opened by", "QC Review"→"QC", "Assignees"→"Assignee" (số ít), Enrollment "Payment"→"Payment status": tất cả các field này List view VỐN ĐÃ hiện đúng label live này từ trước, chỉ có Detail/Create/Toolbar bị kẹt ở chữ cứng cũ — sau fix mọi nơi khớp nhau, không phải lỗi. (b) **lỗi thật, đã sửa**: CS field Title/Client Name đọc default DB là "Task" (seed cũ có từ trước, chưa ai đổi) — nếu để vậy sẽ LÙI LẠI đúng việc vừa đổi "Title"→"Client Name" ở fix ngay phía trên. Đã sửa tận gốc: update `table_column.label` (`cs.summary`) từ "Task" → "Client Name" trực tiếp trên DB (script tạm, đã chạy + xoá), đồng thời sửa luôn default seed trong `queries.ts` và `schema.sql` để khớp — không hardcode fallback đè lên, giữ đúng nguyên tắc "config là nguồn thật".
- **Ref**: `docs/superpowers/plans/2026-08-07-column-config-hardcoding-audit.md`, `-DRAFT.md`, `-fix.md` (plan cuối sau debate); user "review lại all code, list mọi điểm hard code liên quan đến cột... đáng lẽ mình phải lấy từ database lên á"; 1 subagent review bug sau khi code xong tìm ra 5 điểm nhãn lệch, phân loại 4 OK + 1 lỗi thật đã fix

## 2026-08-07 — Đồng bộ UI Create/Detail giữa CS và Enrollment (ACA/Medicare) + xiết quyền Archive
- **Loại**: breaking (quyền), fix
- **Cái gì**: Rà lại toàn bộ UI 2 cặp Create/Detail (CS: `NewTaskDialog`/`TaskDetailDrawer`; Enrollment: `NewEnrollmentDialog`/`EnrollmentDrawer`), lấy CS làm chuẩn. Sửa 3 điểm lệch thật: (1) field Title/Client Name — CS Create ghi "Title" trong khi CS Detail + cả 2 dialog Enrollment đều ghi "Client Name" → đổi CS Create thành "Client Name" cho khớp. (2) Header của Enrollment Detail có thêm badge màu hiển thị Stage cạnh mã ticket — CS Detail không có (Stage đã hiện đủ ở khối field bên phải) → bỏ badge này. (3) Khung dialog CS Create dùng `rounded` + nền mờ `/45`, còn CS Detail và cả 2 dialog Enrollment đều dùng `rounded-lg` + `/40` → đổi CS Create theo số đông cho khớp. **Quyền Archive (Enrollment)**: nút "Archive record" trước giờ hiện cho bất kỳ ai xem được record (server chặn sau qua `canMutateEnrollmentRecord` — cho phép cả caller/responsible/creator, rộng hơn CS). CS's "Delete task" chỉ hiện cho Manager hoặc chủ Agent (`canDeleteTask`). User xác nhận xiết Enrollment giống CS → thêm `canArchiveEnrollmentRecord()` (server, `lib/enrollment/access.ts`) + `canArchiveEnrollmentRecordClient()` (client, mirror) = Manager HOẶC người tạo record (`created_by_email`) — hẹp hơn hẳn quyền sửa field thường, vì Enrollment không có khái niệm "chủ Agent" như CS nên dùng "người tạo" làm tương đương gần nhất.
- **Vì sao**: user yêu cầu review tổng thể "UI display phải giống nhau... làm giống bên CS á" cho cả 3 phần CS/ACA/Medicare (2 dialog Enrollment dùng chung code, chỉ khác field theo `program`).
- **File**: `tasks/_components/NewTaskDialog.tsx`, `enrollment/_components/EnrollmentClient.tsx`, `lib/enrollment/access.ts` (hàm mới `canArchiveEnrollmentRecord`), `api/enrollment/[id]/route.ts` (DELETE dùng hàm mới thay vì `canMutateEnrollmentRecord`)
- **Ảnh hưởng**: non-manager KHÔNG PHẢI người tạo record (vd chỉ là caller/responsible) sẽ **mất quyền Archive** dù vẫn sửa được field bình thường — cần thông báo trước cho CS Enrollment nếu có ai đang dựa vào việc archive record người khác tạo.
- **Ref**: user "tao cần mày review lại tất cả UI phần create task / xem task... hãy làm giống bên CS á"; AskUserQuestion xác nhận xiết quyền Archive

## 2026-08-07 — Bỏ hết bảng dịch field hardcode trong Required-check + thêm Stage vào Create/Detail (CS)
- **Loại**: refactor-logic, feat
- **Cái gì**: (1) **Xoá hardcode còn sót trong hệ Required**: sau 2 lần fix (2 mục dưới) `findMissingRequiredFields()`/`isAutoGeneratedColumn()` vẫn dựa vào 1 bảng dịch tên cố định (`SYSTEM_COLUMN_FIELD_MAP`) giữa `table_column.key` và tên field DB thật — user chỉ ra đây vẫn là "hardcode column list", không tuân theo config trong DB. Thiết kế lại: `findMissingRequiredFields()` giờ đọc thẳng `column.key` từ `table_column` (live, mỗi request) và tra đúng key đó trong object `fieldValues` caller truyền vào — không còn bảng dịch giá trị nào cả. Việc dịch tên (vd DB dùng `agent_email`, cột config dùng key `agent`) chỉ còn ở đúng nơi cần: từng route tự gán inline 1 lần (`{ agent: patch.agent_email }`), không qua module dùng chung — nên không thể "trôi" ra khỏi DB nữa. Riêng `REQUIRED_CAPABLE_SYSTEM_KEYS` (`columns.ts`) chỉ còn là 1 tập hợp **key** (không phải bảng dịch giá trị) để biết field hệ thống nào có ô nhập thật lúc tạo — dùng khoá Required cho field tự sinh (Key, Created by, QC...). Loại "assignee" (cs) khỏi tập này: unassigned là trạng thái hợp lệ (tự về Backlog), không phải "thiếu giá trị". (2) **Thêm Stage/Trạng thái vào Create + Detail (CS)**: trước giờ chỉ chọn được Stage gián tiếp qua cột Kanban/List; nay `NewTaskDialog` có picker Stage (khoá cứng "Backlog" khi chưa chọn Assignee — đúng luật `resolveCreateAssignment()`, mở khoá thành dropdown khi đã có Assignee) và `TaskDetailDrawer` hiện Stage full-width ngay dưới Assignees, tái dùng nguyên logic tương tác của `StatusPill` (khoá overdue cần unlock, Done/Cancel chỉ Reopen qua flow có lý do, ẩn "To Do" sau khi đã từng In Progress) qua prop `size="field"` mới thêm — style row (List/Board) giữ nguyên không đổi.
- **Vì sao**: (1) user yêu cầu lặp lại nhiều lần trong buổi — bất kỳ bảng dịch cố định nào cũng là 1 chỗ có thể lệch khỏi Config thật trong DB theo thời gian (đúng như đã xảy ra 2 lần trước với Priority/In-Detail). (2) user xem task chi tiết + tạo task mới đều muốn thấy/đổi Stage tại chỗ, không phải quay ra bảng ngoài.
- **File**: `lib/table-config/required.ts` (viết lại, không còn bảng dịch), `lib/table-config/columns.ts` (`REQUIRED_CAPABLE_SYSTEM_KEYS` đổi từ map sang set key), `api/tasks/route.ts` + `api/tasks/[id]/route.ts` + `api/enrollment/route.ts` + `api/enrollment/[id]/route.ts` (dịch tên field inline tại chỗ), `tasks/_components/TaskRowItem.tsx` (`StatusPill` export + prop `size`), `tasks/_components/NewTaskDialog.tsx`, `tasks/_components/TaskDetailDrawer.tsx`, `tasks/_components/TaskBoardClient.tsx`
- **Ảnh hưởng**: không đổi RBAC/schema/hành vi Required đã có (chỉ đổi cách code tự kiểm tra chính nó); Stage field mới chỉ ở CS, chưa làm cho Enrollment. Tất cả 4 route Required-check verify lại đúng field cũ (title/description/fub/priority/category/agent CS; 15 field Enrollment).
- **Ref**: user "check cực kì kĩ... không hard code" (lặp 3 lần), "cái stage cũng phải hiện ở đây chứ" + "thêm cái stage vào này cho tao coi"

## 2026-08-07 — Fix 2 lỗi phát hiện lúc test trực tiếp tính năng Required (mục ngay dưới)
- **Loại**: fix
- **Cái gì**: (1) **Toggle "In Detail" hiện sai cho field hệ thống**: `ConfigClient.tsx` hardcode `checked=false` cho mọi field hệ thống bất kể `show_in_detail` thật là gì — nên Client Name/Agent (đã seed `show_in_detail=true`, thật sự có hiện trên form) lại hiện toggle tắt, gây hiểu lầm "field này không có trên form". Sửa: bỏ nhánh hardcode, luôn hiện đúng `column.show_in_detail || column.required` (vẫn giữ `disabled` cho field hệ thống/required — chỉ sửa phần hiển thị, không đổi quyền chỉnh). (2) **Tạo task báo "Priority required." dù đã chọn Medium**: `POST /api/tasks` validate Required ở server nhưng object `fieldValues` truyền vào chỉ có `title/agent_email/category_id` (3 field vốn đã hardcode check riêng) — thiếu hẳn `priority`, `description`, `fub_link`. User tự tick Required cho Priority lúc test Config (xem entry trước) → field này khi tạo task luôn bị báo thiếu dù có giá trị thật, vì server tra `fieldValues.priority` ra `undefined`. Sửa: bổ sung đủ cả 6 field vào `fieldValues`.
- **Vì sao**: cả 2 phát hiện qua test trực tiếp UI, không phải yêu cầu mới — thuộc phạm vi "Required field" đang làm dở, sửa liền không tách task riêng.
- **File**: config/_components/ConfigClient.tsx:769,871 (đã gộp thành 1 chỗ dùng chung), api/tasks/route.ts (thêm `description` làm biến dùng chung, bổ sung `fieldValues`)
- **Ảnh hưởng**: không đổi RBAC/schema. Sửa (2) là **blocker thật** — nếu không sửa, bất kỳ field nào ngoài Title/Agent/Category được tick Required sẽ khiến CS Task không tạo được nữa dù đã điền đủ.
- **Ref**: user test trực tiếp, ảnh chụp màn hình "Priority required."

## 2026-08-04 — Feature mới: Required field thật (Config) + fix đúng cơ chế Hidden/Detail cho Create/Detail (CS + Enrollment)
- **Loại**: feat, fix, breaking (đổi hành vi nút Create: không còn tự khoá, chuyển sang validate-khi-bấm)
- **Cái gì**: Sau 2 lần fix trong ngày (mục dưới) vẫn còn thiếu — user yêu cầu mở rộng thành 1 hệ thống hoàn chỉnh, không chỉ vá bug:
  1. **Required field thật**: `table_column.required` (cột có sẵn nhưng trước giờ chết, không được đọc ở đâu) nay có tác dụng thật — admin bật được cho **mọi cột** (hệ thống lẫn custom) qua toggle switch mới trong `/config` → Table Columns (đổi luôn 4 checkbox Pinned/Hidden/Detail cũ + Required mới sang dạng toggle switch, bỏ chữ label rối mắt). Field tự sinh (Key, Created by/date, Last edited by/time, QC) bị khoá không cho tick Required (không có ô nhập nào để mà thiếu/đủ).
  2. **Khoá chéo**: Required=true tự ép `hidden_default=false` (không ai ẩn được field bắt buộc khỏi Create/Detail, kể cả admin) và tự ép `show_in_detail=true` cho custom field; nút Archive bị khoá khi cột đang Required (phải tắt Required trước). Chặn luôn ở server (không chỉ UI) — 1 cột không thể vừa `pinned=true` vừa `hidden_default=true`, và không thể `required=true` mà `hidden_default=true`.
  3. **Bỏ luật either/or cũ của Enrollment** (Client Name HOẶC FUB Link, 1 trong 2) — thay bằng 2 field độc lập, mỗi field tự có Required riêng. Seed mặc định: Client Name = required, FUB Link = không (giữ gần đúng hành vi cũ nhất — luôn có tên khách khi tạo mới).
  4. **Validate kiểu mới trên Create + Detail** (CS: `NewTaskDialog`, `TaskDetailDrawer`; Enrollment: `NewEnrollmentDialog`, `EnrollmentDrawer`): nút Create **luôn bấm được** (không tự xám nữa) — bấm vào mới kiểm tra, nếu thiếu field Required thì **chặn gửi API, không đóng form**, tô viền đỏ đúng field thiếu (tái dùng style `ring-2 ring-[#ff5630]` có sẵn) + dấu `*` đỏ cạnh label mọi field Required. Detail drawer không có nút Save chung (mỗi field tự lưu khi blur) — field Required bị xoá trống rồi blur thì chặn lưu, **tự trả lại giá trị cũ**, tô đỏ tạm thời cho tới khi user bắt đầu sửa lại (focus vào ô).
  5. **Validate ở server cho cả 4 route** (`POST /api/tasks`, `PATCH /api/tasks/[id]`, `POST /api/enrollment`, `PATCH /api/enrollment/[id]`) qua hàm chung mới `findMissingRequiredFields()` (`src/lib/table-config/required.ts`) — tự đọc `table_column.required` theo scope, không tin riêng client. PATCH chỉ kiểm tra field mà chính request đó đang đổi (không chặn nhầm 1 patch không liên quan).
  6. **Khôi phục đúng cơ chế Hidden cho Create/Detail** (2 lần fix sáng nay bị lỗi — lần 1 gỡ sạch không phân biệt per-user vs admin, lần 2 chỉ áp cho field hệ thống bỏ sót custom field) — giờ Hidden áp dụng **thống nhất cho cả field hệ thống lẫn custom**, hoàn toàn tách khỏi state List View cá nhân của từng user. `show_in_detail`/"Detail" checkbox giữ đúng vai trò cũ: chỉ có ý nghĩa với custom field (opt-in thêm, ngoài việc hiện cột List), field hệ thống không cần nó nên checkbox bị khoá.
  7. Seed data: CS Title/Agent/Category, Enrollment Agent/Client Name → `required=true`; mọi field hệ thống có ô nhập thật trên Create → `show_in_detail=true` (thuần data-hygiene, app không đọc cờ này cho field hệ thống nhưng để dữ liệu phản ánh đúng thực tế). Áp trực tiếp lên Supabase production (data update, không đổi schema) + ghi vào `schema.sql` để môi trường mới cũng có sẵn.
- **Vì sao**: bug gốc (PCP2025 tick Hidden vẫn hiện ở Create) lộ ra 1 lỗ hổng thiết kế lớn hơn — Hidden/Detail/Required/Archive chưa từng được nghĩ như 1 hệ thống thống nhất. User yêu cầu review toàn bộ rồi thiết kế lại cho "hoàn hảo", qua nhiều vòng hỏi-đáp chốt từng quyết định (custom field Hidden luôn thắng Detail; field bắt buộc dùng cờ Required thật thay vì fallback ngầm; validate kiểu chặn-gửi-tô-đỏ thay vì khoá nút; bỏ either/or cũ).
- **File**: lib/table-config/columns.ts, lib/table-config/required.ts (mới), api/config/columns/[id]/route.ts, api/tasks/route.ts, api/tasks/[id]/route.ts, api/enrollment/route.ts, api/enrollment/[id]/route.ts, config/_components/ConfigClient.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/NewTaskDialog.tsx, tasks/_components/TaskDetailDrawer.tsx, enrollment/_components/EnrollmentClient.tsx, supabase/schema.sql
- **Ảnh hưởng**: Create/Detail của cả CS lẫn Enrollment đổi hành vi validate (nút không tự khoá nữa, chuyển sang chặn-lúc-bấm + tô đỏ). Enrollment mất luật either/or cũ. Admin có thêm quyền lực mới (Required cho bất kỳ field nào) — cần cẩn thận vì đánh dấu 1 custom field Required cho Enrollment tạo mới sẽ **luôn không thoả được** vì Create dialog của Enrollment chưa có UI custom field (chỉ set được qua Detail sau khi tạo) — validator đã né việc này (`checkCustom: false` khi tạo mới) nhưng admin cần biết giới hạn này. Không đổi RBAC/permission.
- **Ref**: docs/superpowers/plans/2026-08-04-fix-admin-hidden-field-visibility.md (plan gốc hẹp hơn, đã mở rộng nhiều qua hỏi-đáp trực tiếp với user)

## 2026-08-04 — Fix: field hệ thống biến mất khỏi form Tạo/Sửa khi user tự ẩn cột List View (CS + Enrollment)
- **Loại**: fix
- **Cái gì**: `NewTaskDialog`/`TaskDetailDrawer` (CS) và `NewEnrollmentDialog`/`EnrollmentDrawer` (ACA/Medicare) đang dùng chung 1 hàm `isFieldVisible`/`showField` để quyết định field nào hiện trong form Tạo task/record và Chi tiết task/record. Hàm này lại đọc từ `visibleCreateColumnKeys` — tập cột đang hiện trong **List View của chính người dùng đó** (`hiddenTaskListColumnKeys`/`hiddenColumnKeys`, lưu per-user ở bảng `user_table_layout`). Hậu quả: **ai tự ẩn 1 cột hệ thống trong bảng List (chỉ để gọn bảng) thì field đó biến mất luôn khỏi form Tạo task/record và Chi tiết** — kể cả field bắt buộc như Title/Client Name, Category, Priority, Agent, Assignee, Stage. Bug có từ commit `24e9eaa` (2026-08-02, "Fix task and enrollment field visibility") khi generalize nhầm cơ chế `show_in_detail` (vốn chỉ dành cho **custom field**, vẫn đúng và giữ nguyên) sang áp luôn cho **field hệ thống**. Fix: gỡ hoàn toàn `isFieldVisible`/`showField`/`configuredColumnKeys`/`visibleColumnKeys` khỏi 4 component trên — field hệ thống giờ **luôn hiện không điều kiện** (khôi phục đúng hành vi gốc trước commit `24e9eaa`, đã verify bằng diff `git show 24e9eaa~1`), chỉ giữ lại điều kiện nghiệp vụ thật (vd `!isMedicare` cho Payment/Carrier-AC/Consent/Platform/Caller/PCP-2026 ở Enrollment). Cơ chế `show_in_detail` cho custom field không đổi.
- **Vì sao**: user báo "task CS chỉ còn điền được ô Note khi tạo task". Điều tra + verify trực tiếp DB (read-only) xác nhận `table_column.hidden_default` toàn bộ `false` (không phải admin ẩn cột toàn công ty) — nguyên nhân là chính user đã tự ẩn `category, status, priority, slaRemaining, agent, reporter` ở List View của mình lúc 2026-08-04 15:23 UTC, và bug coupling khiến hành động "ẩn cột bảng" (cosmetic, per-user) vô tình xoá luôn khả năng set field đó trên task. Kiểm tra thêm phát hiện Enrollment dính y hệt (cùng commit gây lỗi, cùng cơ chế) dù chưa ai report — sửa gộp luôn theo yêu cầu "fix kĩ".
- **File**: tasks/_components/NewTaskDialog.tsx, tasks/_components/TaskDetailDrawer.tsx, tasks/_components/TaskBoardClient.tsx (xoá `configuredCreateColumnKeys`/`visibleCreateColumnKeys`, giữ nguyên `taskListColumnConfig`/`visibleTaskListColumnConfig` vì vẫn cần cho List/Board table + export), enrollment/_components/EnrollmentClient.tsx (xoá tương tự trong `NewEnrollmentDialog`/`EnrollmentDrawer`, giữ nguyên `visibleColumns`/`hiddenColumnKeys` cho List table)
- **Ảnh hưởng**: **Không đổi RBAC/mutate permission, không đổi schema, không đổi chức năng `/config`** — checkbox Pinned/Hidden/Detail ở `/config` → Table Columns vẫn hoạt động y nguyên cho List/Board table view và cho custom field; chỉ gỡ 1 coupling sai khiến nó lan sang Create/Detail. `user_table_layout` hiện có của `bao.vo@excelplannings.com` (scope cs) không cần xoá — giờ chỉ còn tác dụng đúng phạm vi List View như dự định ban đầu. Đã chạy `tsc --noEmit` (0 lỗi), `vitest run` (419 pass), `eslint` trên 4 file đổi (0 lỗi/cảnh báo).
- **Ref**: bug report trực tiếp từ user + root cause verify qua Supabase read-only query

## 2026-08-03 — Khôi phục đính kèm file trong comment + chuyển composer xuống dưới
- **Loại**: fix, feat
- **Cái gì**: (1) **Khôi phục regression**: tính năng đính kèm file trong comment (nút Attach, chip file đã chọn, preview ảnh inline + modal phóng to, link tải file thường) đã bị gỡ khỏi `CommentThread.tsx` ở commit `2b185f0` (2026-07-13, "simplify detail visibility and attachments") — nay port lại vào cấu trúc hiện tại (không revert thẳng vì file đã thay đổi nhiều: mention encoding, edit history, prop `apiBase`). Kèm theo: bật lại `includeCommentAttachments: true` ở `/api/tasks/[id]/detail` (đang bị tắt cứng `false`), và cho phép comment **chỉ có file, không có chữ** ở cả 2 route POST comments (trước đó chặn `400 "Comment is empty."`). (2) **Đổi layout**: ô soạn comment chuyển từ trên xuống **dưới** danh sách, để tin nhắn mới hiện ngay phía trên chỗ đang gõ, giống giao diện chat.
- **Vì sao**: user báo mất nút đính kèm và muốn layout kiểu chat. Điều tra git xác nhận là regression thật (backend `/api/{tasks,enrollment}/[id]/attachments` nhận `comment_id`, `groupCommentAttachments`, signed URL, magic-byte validation đều còn nguyên vẹn — chỉ mất UI + 1 cờ bị tắt).
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/api/tasks/[id]/detail/route.ts, src/app/api/tasks/[id]/comments/route.ts, src/app/api/enrollment/[id]/comments/route.ts
- **Ảnh hưởng**: `CommentThread` dùng chung qua prop `apiBase` nên **enrollment cũng được khôi phục đính kèm cùng lúc** (enrollment vốn đã load sẵn comment attachments). Không đổi schema/RBAC — quyền attach giữ nguyên: phải xem được task/record **và** là tác giả của comment đó. Blob URL của preview lạc quan được revoke khi server trả về URL thật (tránh memory leak).
- **Ref**: regression từ commit 2b185f0

## 2026-08-03 — Fix comment hiện 2 lần khi gửi kèm file
- **Loại**: fix
- **Cái gì**: gửi comment có đính kèm thì nội dung hiện **2 lần** rồi vài giây sau mới còn 1. Nguyên nhân: POST comment bắn realtime broadcast → `onReload()` chạy sau ~300ms mang comment **thật** về, trong khi bản **lạc quan** vẫn còn trên màn hình do đang upload file → cả 2 cùng render. Cửa sổ trùng đúng bằng thời gian upload (nên user thấy ~5s). Fix: khi server trả về id thật, gắn `realId` vào bản lạc quan; lúc dựng danh sách thì ẩn bản server tương ứng và **giữ bản lạc quan** (vì nó có preview ảnh cục bộ), tới khi upload xong `releaseOptimistic` mới hoán đổi sang bản thật.
- **Vì sao**: lỗi do chính đợt khôi phục đính kèm ở entry trên gây ra — trước đó comment không có file nên `persistComment` chạy gần như tức thì, cửa sổ trùng không nhìn thấy được.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx
- **Ảnh hưởng**: chỉ hiển thị; không đổi API/schema. Chọn giữ bản lạc quan thay vì bản server để ảnh preview không bị nháy (biến mất rồi hiện lại) trong lúc upload.

## 2026-08-03 — Ô soạn comment luôn mở & ghim đáy (kiểu Messenger)
- **Loại**: feat
- **Cái gì**: ô soạn comment trước đây **thu gọn** thành 1 nút, phải bấm mới mở. Nay thêm chế độ `alwaysOpen`: luôn mở sẵn, `sticky bottom-0` nên **ghim ở đáy vùng cuộn** — cuộn danh sách comment thì ô nhập vẫn nằm nguyên dưới cùng, giống Messenger. Kèm: textarea gọn hơn (2 dòng thay vì 3), nút "Cancel" đổi thành "Clear" và **chỉ hiện khi đã có nội dung** (ô luôn-mở thì không có gì để "cancel" về).
- **Vì sao**: user yêu cầu "lúc nào nó cũng nằm bên dưới sẵn giống Messenger".
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx
- **Ảnh hưởng**: chỉ ô soạn cấp cao nhất dùng `alwaysOpen`; ô **trả lời** (reply) giữ nguyên hành vi cũ (mở khi bấm Reply, có Cancel để đóng). Cố ý **không autofocus** ô luôn-mở, nếu không mỗi lần mở task sẽ bị cướp con trỏ. Enrollment dùng chung component nên cũng được cập nhật.

## 2026-08-03 — Comment thread dựng đúng layout Messenger (list cuộn riêng, ô nhập dính đáy)
- **Loại**: feat
- **Cái gì**: bản trước dùng `sticky bottom-0` nên ô nhập chỉ dính đáy khi comment đủ dài để cuộn — ít comment thì nó trôi lên giữa drawer. Nay dựng đúng kiểu Messenger: **danh sách comment có vùng cuộn riêng** (`flex-1` + `overflow-y-auto`), **ô nhập docked cố định** ngay dưới nó và không bao giờ di chuyển, bất kể có 0 hay 100 comment. Thêm **tự cuộn xuống tin mới nhất** khi mở/khi có comment mới (bỏ qua khi đang deep-link tới 1 comment cụ thể để không phá luồng đó).
- **Vì sao**: user yêu cầu "y xì Messenger" — ô nhập phải luôn nằm đáy.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: để vùng cuộn hoạt động, khu tab trong drawer phải giãn đầy chiều cao — đã đổi `<main>` sang flex-column và section tab sang `flex-1 min-h-0` ở **cả 2 drawer** (task + enrollment). Không đổi API/schema/logic.

## 2026-08-03 — Khoá chiều cao drawer để ô nhập comment thật sự dính đáy
- **Loại**: fix
- **Cái gì**: bản trước vẫn sai — có nhiều comment thì ô nhập bị đẩy khỏi màn hình, phải kéo xuống mới thấy. Nguyên nhân: vùng cuộn nội bộ **không bị chặn chiều cao** (grid dùng `min-h-full` + body vẫn `overflow-y-auto`), nên `flex-1` cứ nở ra theo nội dung thay vì cuộn. Fix: ở màn hình lớn (`lg:`), body chuyển `overflow-hidden`, grid dùng `h-full`, `<main>` thêm `min-h-0 overflow-hidden`, sidebar tự cuộn riêng — mỗi cột có vùng cuộn độc lập, đúng kiểu app chat. Các field phía trên (Client Name/FUB/Description) thêm `shrink-0` để không bị bóp lại khi chỗ chật.
- **Vì sao**: user báo "ô comment phải stick chứ sao mất khi có nhiều comment" — đúng, 2 lần trước tao chưa khoá chiều cao nên dock không có tác dụng.
- **File**: src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: chỉ áp dụng từ breakpoint `lg` trở lên; màn hình hẹp giữ layout cuộn-một-mạch như cũ (2 cột xếp dọc mà khoá chiều cao sẽ quá chật). Không đổi API/schema/logic.

## 2026-08-03 — Thu gọn composer + thiết kế lại tab Comments/Activity
- **Loại**: style
- **Cái gì**: (1) ô soạn comment chiếm quá nhiều chỗ → thu còn ~nửa chiều cao: 1 dòng thay vì 2-3, padding sát, nút cao 28px, nút Attach chỉ còn icon (có tooltip). Áp cho **cả ô docked lẫn ô Reply** (lần đầu quên Reply). (2) Tab Comments/Activity/Overdue (task) và Comments/Activity/Files (enrollment) đổi từ pill trên nền xám sang **tab gạch chân** + số đếm tách thành badge tròn riêng thay vì nhét trong ngoặc `(5)`; active = chữ xanh + gạch chân xanh, hover = gạch chân xám nhạt.
- **Vì sao**: user báo composer chiếm hết chỗ, và tab bar "xấu quá". Tab gạch chân cũng thấp hơn pill nên trả thêm chỗ cho danh sách comment.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: `DetailTabButton`/`DrawerTab` đổi API từ `label`-gộp-số (hoặc `children`) sang `label` + `count` riêng — đã cập nhật đủ 6 call site. Tiện thể dọn: bỏ hết nhánh `alwaysOpen ? ... : ...` trong class kích thước, giờ `alwaysOpen` chỉ quyết định **hành vi** (thu gọn hay không, nút phụ "Clear" hay "Cancel").

## 2026-08-03 — Merge Dropdown Values into one unified nav (Custom + Category + Option Sets)
- **Loại**: refactor-logic
- **Cái gì**: gộp `ConfigValueSection` + `ConfigOptionSetSection` (2 khối riêng của đợt consolidate cùng ngày) thành 1 component `ConfigDropdownValuesSection` — 1 nav trái liệt kê mọi nhóm giá trị (Option Set nếu aca/medicare + Category nếu cs + mọi custom dropdown), chọn 1 mục hiện value tương ứng ở panel phải, dùng chung 1 form/table. Field đặc thù (Terminal/QC, cảnh báo archive theo usage-count, guard Consent 2-giá-trị) hiện có điều kiện theo nhóm đang chọn thay vì cố định theo khối.
- **Vì sao**: user test UI thật thấy 2 khối tách rời gây cảm giác rời rạc (vd scope=aca báo "No dropdown columns yet" ở khối trên dù Stage/Carrier/... có đủ ở khối dưới) — phản hồi trực tiếp: "tất cả là dropdown value, không nên tách riêng option set". Trước khi gộp đã audit lại DB (`table_column` 3 scope + `enrollment_option_sets`) xác nhận danh sách nhóm hiển thị đúng, không thiếu/thừa.
- **File**: config/_components/ConfigClient.tsx (xoá `ConfigValueSection`+`ConfigOptionSetSection`, thêm `ConfigDropdownValuesSection`), enrollment/_components/EnrollmentClient.tsx (bỏ prop `optionSets` đã hết dùng), enrollment/page.tsx
- **Ảnh hưởng**: thuần UI, không đổi schema/API/RBAC — tái dùng nguyên logic CRUD đã viết ở đợt trước.
- **Ref**: docs/superpowers/plans/2026-08-03-consolidate-dropdown-values.md (mục 6)

## 2026-08-03 — Consolidate dropdown values (Custom + Category + Option Sets) into /config
- **Loại**: feat, refactor-logic, fix
- **Cái gì**: gộp quản lý mọi dropdown value (custom column + CS Category + Enrollment Option Sets) vào `/config` → tab Dropdown Values, 2 khối theo scope (Custom+Category chung 1 form, nâng cấp thêm màu + sửa-tên-inline; Option Sets port gần nguyên vẹn giữ đủ Terminal/QC + cảnh báo usage-count khi archive, tính qua query mới ở server thay vì load nguyên enrollment records). Loại CS Status/Priority khỏi picker (dropdown system nhưng giá trị hardcode enum, không có nơi lưu). Xoá UI setup cũ khỏi `/tasks` (nút+modal Categories) và `/enrollment` (nút+modal Option sets). Kèm 2 fix có sẵn: Consent giới hạn đúng 2 giá trị active (chặn bug im lặng trong `EnrollmentConsentToggle` khi có option thứ 3 — nó chỉ hiểu "Yes" + 1 option khác); category giờ bắn `broadcastTasksChanged()` (3 route trước đó thiếu) và `/tasks` tự refresh category qua realtime thay vì chỉ lúc mở modal cũ; tương tự `/enrollment` giờ tự refresh option set qua realtime.
- **Vì sao**: user muốn 1 nơi duy nhất set up mọi dropdown, không rải rác 3 trang. Kiến trúc (3 khối, không migrate schema, không gộp 1 picker chung) đã qua review đối kháng 2-agent (1 agent bảo vệ hướng "1 picker chung", 1 agent phản biện độc lập) — agent phản biện thắng vì bằng chứng cụ thể: 3 hệ thống có tính năng lệch cấp (Option Sets có cảnh báo an toàn xuất phát từ 1 sự cố thật, Custom dropdown thì không), ép chung 1 abstraction vẫn rò rỉ field đặc thù (is_terminal/triggers_qc) và cần map-ngược-key dễ vỡ.
- **File**: config/_components/ConfigClient.tsx (mở rộng `ConfigValueSection` + thêm `ConfigOptionSetSection`/`ConfirmDialog`), config/page.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/CategoryManager.tsx (xoá), enrollment/_components/EnrollmentClient.tsx (xoá `OptionSetManager` ~260 dòng), enrollment/page.tsx, api/tasks/categories/route.ts, api/tasks/categories/[id]/route.ts
- **Ảnh hưởng**: không đổi schema, không đổi RBAC, không đổi API route sẵn có (trừ thêm broadcast vào category). Admin set up category/option sets chỉ còn ở `/config`.
- **Ref**: docs/superpowers/specs/2026-08-03-consolidate-dropdown-values-design.md, docs/superpowers/plans/2026-08-03-consolidate-dropdown-values.md

## 2026-08-02 — Consolidate Agent/Assistant config into /config + fix Assistant picker source
- **Loại**: refactor-logic, fix
- **Cái gì**: dồn toàn bộ quản lý "ai là Agent" + "ai là Assistant của agent nào" về `/config` → tab Assistant Membership (thêm panel Agents dùng API mới `/api/config/agents`, gate `loadConfigAdmin()`). Khai tử Agent Groups modal trên `/tasks` + 2 route `/api/admin/task-agents`, `/api/admin/agent-members` (đổi gate `isTaskViewAdmin`/`isManager` rời rạc về 1 chuẩn `loadConfigAdmin()`). **Fix bug**: dropdown "Assistant" trước đó cho chọn bất kỳ account active nào trong hệ thống (nguồn `fetchTaskAgentCandidates()`), giờ giới hạn đúng người có quyền `task.work`/`task.manage` (nguồn `fetchTaskAssignees()`, khớp hành vi gốc của Agent Groups modal) — vì Assistant được cấp quyền ngang agent-owner trên task, người không có quyền task.work không vào được `/tasks` nên gán họ là vô nghĩa.
- **Vì sao**: 2 nơi cấu hình cùng 1 dữ liệu (task_agents/agent_members) gây trùng lặp API + UI; user muốn 1 nguồn duy nhất. Nhân tiện sửa luôn nguồn dữ liệu sai của Assistant picker phát hiện trong lúc rà soát.
- **File**: api/config/agents/route.ts (mới), api/admin/{task-agents,agent-members}/route.ts (xoá), config/page.tsx, ConfigClient.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/AgentGroupsModal.tsx (xoá)
- **Ảnh hưởng**: không đổi schema, không đổi RBAC permission/role, không đổi ai xem được gì (Enrollment vẫn agent/assistant-agnostic — đã verify). Assistant picker giờ chặt hơn (đúng ý), Agent picker không đổi (vẫn mọi account).
- **Ref**: docs/superpowers/specs/2026-08-02-consolidate-agent-assistant-config-design.md, docs/superpowers/plans/2026-08-02-consolidate-agent-assistant-config.md

## 2026-08-02 — Fix DropdownSelect off-screen popup + Assistant list hidden by single-agent filter
- **Loại**: fix
- **Cái gì**: 2 bug phát hiện lúc test trực tiếp trang `/config` sau đợt consolidate ở trên. (1) `DropdownSelect` (dùng ở 6 chỗ trong `ConfigClient.tsx`) luôn mở popup xuống dưới, không kiểm tra còn chỗ trong viewport hay không — thêm section "Agents" phía trên đẩy form Assistant xuống cuối trang khiến popup mở ra ngoài màn hình; giờ tự tính chỗ trống và lật lên khi cần (giống pattern `useAnchoredMenu`). (2) List "Assistant membership" chỉ hiện assistant của agent đang chọn trong dropdown Agent (mặc định là agent đầu bảng chữ cái), khiến admin tưởng mất data các team khác dù DB vẫn còn nguyên đủ 5 team/13 quan hệ — giờ hiện toàn bộ, sắp theo tên agent rồi tên assistant.
- **Vì sao**: user báo lỗi UI ngay sau khi deploy đợt trên; đã verify trực tiếp DB xác nhận không mất data trước khi sửa, tránh sửa nhầm hướng.
- **File**: config/_components/ConfigClient.tsx (`DropdownSelect`, `ConfigAssistantSection`)
- **Ảnh hưởng**: thuần UI/UX, không đổi API, không đổi dữ liệu.
- **Ref**: bug report trực tiếp từ user kèm screenshot, 2026-08-02/03

## 2026-08-02 — Add Agent column to Enrollment ACA + Medicare
- **Loại**: feat, schema
- **Cái gì**: thêm cột hệ thống `agent_email` cho `enrollment_records` (ACA + Medicare) — agent sở hữu khách hàng, dùng chung danh sách `task_agents` với CS (không phải toàn bộ `portal_account` như Caller/Responsible). Hiện ngay sau Client Name trong list/filter/create dialog/drawer, bắt buộc khi tạo enrollment mới (client + server validate), có trong export và import (system column key `agent`).
- **Vì sao**: user quên thêm cột này lúc thiết kế ban đầu; cần biết record thuộc khách hàng của agent nào để lọc/báo cáo, giống mô hình CS.
- **File**: supabase/schema.sql, src/lib/table-config/queries.ts, src/lib/enrollment/types.ts, src/lib/enrollment/queries.ts, src/app/(authed)/enrollment/page.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx, src/app/api/enrollment/route.ts, src/app/api/enrollment/[id]/route.ts, src/app/api/enrollment/export/route.ts, src/app/api/config/imports/[id]/route.ts, src/app/api/config/imports/route.ts
- **Ảnh hưởng**: chỉ dữ liệu/filter/hiển thị — KHÔNG đụng quyền xem (enrollment vẫn shared theo Q1) hay quyền sửa (`canMutateEnrollmentRecord` không đổi). Import validate Agent bằng danh sách person chung (parity với Caller/Responsible), không siết theo `task_agents`. User cần tự chạy `schema.sql` để tạo cột `agent_email` + index trước khi dùng.
- **Ref**: docs/superpowers/specs/2026-08-02-enrollment-agent-column-design.md

## 2026-08-02 — Add CS detail custom fields to task creation
- **Loại**: feat
- **Cái gì**: custom columns được bật `show_in_detail` trong CS table configuration giờ xuất hiện trong modal tạo task và được gửi/lưu vào `tasks.custom_values` khi tạo record mới.
- **Vì sao**: detail custom fields cần nhập được ngay lúc tạo task, không chỉ sau khi task đã tồn tại.
- **File**: src/app/(authed)/tasks/_components/TaskBoardClient.tsx, src/app/(authed)/tasks/_components/NewTaskDialog.tsx, src/app/api/tasks/route.ts
- **Ảnh hưởng**: CS New Task modal và create API nhận thêm custom field scalar values; RBAC/assignment/status logic không đổi.
- **Ref**: bug report detail columns missing from New Task modal

## 2026-08-02 — Fix CS custom column value save
- **Loại**: fix
- **Cái gì**: `resolveTaskPatch` giờ công nhận `custom_values` là patch hợp lệ, route task merge custom values đã clean với JSON hiện tại trước khi update DB.
- **Vì sao**: custom-only update từ list/drawer bị `Nothing to update` trước khi tới Supabase nên value không được lưu.
- **File**: src/lib/tasks/transitions.ts, src/app/api/tasks/[id]/route.ts, src/lib/tasks/transitions.test.ts
- **Ảnh hưởng**: custom column values trong CS Task List/Task Drawer lưu được vào `tasks.custom_values`; các rule status/assign/QC không đổi.
- **Ref**: bug report custom column save returns `Nothing to update`

## 2026-08-02 — CS company-wide view + Enrollment shared view + import fixes
- **Loại**: feat, security, refactor-logic
- **Cái gì**:
  - CS plain-CS thấy tất cả task; agent/assistant vẫn bị scope; manager không đổi.
  - CS plain-CS mở/xem/comment được mọi task: thêm `actorSeesAllTasks` short-circuit vào các route view (detail, comments, comments/[cid], comments/[cid]/edits, attachments, attachments/[aid]); activity vẫn owner-only; sửa/status/assign/xóa vẫn khóa. (Fix gap: Q1 mở list nhưng /detail vẫn 403 khi mở task lạ.)
  - Enrollment worker thấy tất cả record, nhưng sửa vẫn giữ manager/stakeholder; non-manager mặc định filter responsible=self.
  - Import có thể close/reject request failed/processing bị kẹt; update import không đổi assignee task.
  - Fix cache assignee list, log activity lỗi khi archive enrollment, xóa dead table-config permissions, normalize person compare và thêm save-error feedback cho custom cell.
- **Vì sao**: CS là hàng đợi chung công ty; enrollment dùng shared view với filter cá nhân; import cần recovery và không được làm mất đa-assignee.
- **File**: lib/tasks/queries.ts, lib/tasks/assignees.ts, lib/tasks/membership.ts, app/api/tasks/[id]/{detail,comments,comments/[cid],comments/[cid]/edits,attachments,attachments/[aid]}/route.ts, lib/enrollment/access.ts, lib/enrollment/queries.ts, lib/enrollment/overview-data.ts, app/api/enrollment/*, app/api/config/imports/[id]/route.ts, ConfigClient.tsx, EnrollmentClient.tsx, EditableCustomCell.tsx
- **Ảnh hưởng**: plain-CS và enrollment workers thấy dữ liệu rộng hơn có chủ ý; mutate/RBAC không đổi.
- **Ref**: docs/superpowers/plans/2026-08-02-view-model-and-batch-fixes.md
## 2026-08-10 — Task collaboration hardening

- Added an atomic, idempotent task comment command. Comment rows, audit events,
  mention participants, and the parent timestamp/version now commit together;
  notification and realtime failures return warnings after commit.
- Added optional `client_request_id` deduplication and made participant upserts
  report errors instead of silently swallowing visibility failures.
- Split optimistic comment status from per-file upload status. A committed
  comment no longer becomes failed because one file or a reload fails; failed
  files expose their own retry state, and preview blob URLs are revoked on
  discard, task change, and unmount.
- Hardened attachment upload: authorization now runs before multipart buffering;
  storage upload, signing, and atomic metadata/audit commit have explicit
  compensation/idempotency boundaries, and activity metadata stores identifiers
  rather than customer-controlled filenames.
- Made task and enrollment comment edits compare-and-swap operations with
  transactional edit history/activity and explicit 409 conflict responses;
  the editor keeps its draft and shows the server error instead of silently
  closing or overwriting another tab.
- Added one retention contract for task comment deletion: comments and linked
  attachment metadata are soft-deleted atomically, replies remain visible,
  filename search and counters exclude deleted files, and storage cleanup is
  best-effort with warnings.

## 2026-08-11 — Datasync SECURITY DEFINER ACL hardening

- Added a read-only ACL audit for datasync SECURITY DEFINER routines.
- Locked `refresh_pc_mart`, `refresh_health_mart`, and
  `clear_health_payment_summary` to `service_role` and set an explicit safe
  search path.
- Added a fail-closed schema assertion so a future standalone datasync
  SECURITY DEFINER function cannot silently retain PUBLIC EXECUTE.

## 2026-08-11 — Enrollment stage backfill validation boundary

- Moved stage-entry constraint validation before the backfill transaction
  commits, so a failed validation rolls back the complete backfill.
- Added a disposable SQL assertion covering the validation failure boundary.
## 2026-08-11

- Health statement payment-summary replacement now runs through one service-role-only RPC, so a failed row cast/insert preserves the previous dataset instead of leaving the summary empty.
- Google Sheet raw-table refreshes now stage rows by run ID and atomically finalize a source partition, preventing delete-first syncs from exposing empty or partial data.
- Workbook automation endpoints now share server-side type, count, per-file, aggregate-size, and sequential-parser guards. The deployment still must enforce the matching request-body cap at the hosting edge.
- Tasks and Enrollment records now receive immutable sequence-backed display numbers; list/detail/search/notification/export paths render the durable `TASK-...`/`ENR-...` value while UUIDs remain internal identifiers.
- Config agent deletion now removes the agent and assistant memberships in one service-role RPC transaction, preventing a partial delete from leaving orphaned mappings.
- Config custom dropdown option creation now locks its parent column and allocates default positions inside a service-role RPC; max-position query failures can no longer silently create duplicate positions.

## 2026-08-13 — ACA enrollment operations overview

- Added a manager-only ACA operations overview with an all-dates default,
  config-driven dashboard terminal stages, scorecards, stage waiting/action
  views, people workload, queue, and stage/person timing surfaces.
- Added explicit ACA dashboard terminal configuration without changing the
  database's record-closing semantics or Medicare behaviour.
- Added bounded snapshot reads and denormalized work-activity/responsible-
  assignment timestamps, with conservative rollout backfills and separate
  Enrollment queue membership storage.
- Added responsible attribution to live stage cycles. Handover cycles are
  excluded from per-person medians and the UI suppresses timing cells below
  ten measured samples.
- Added a manager-only `Edit queue` grid for ACA assignment membership. Changes
  reload the snapshot so queue ordering and cohort-scoped counts reconcile from
  the server response.
- Rendered the complete 15-tile ACA scorecard set, including terminal counts,
  staleness metrics, speed samples, and staffing figures.
- Paginated ACA needs-action and unassigned lists at 20 rows per page so large
  cohorts remain reachable from the dashboard.
- Distinguished unavailable cycle-derived metrics (`Not enough samples`) from
  empty current-cohort metrics (`—`) in the ACA scorecards.
- Kept the ACA person × stage matrix's person column visible while scrolling
  across many stages.
- Marked stage-table wait aggregates that include estimated pre-tracking ages,
  avoiding presentation of backfilled ages as measured timings.
- ACA overview now honors the configured `threshold_days` default on initial
  load and for invalid query values; explicit valid picker selections override
  the default.
- Bounded ACA live dwell and per-person cycle reads to 90 days and suppressed
  medians below ten samples, preventing sparse or stale history from appearing
  as a reliable speed metric.
- Normalized ACA record/cycle emails at the snapshot boundary so mixed-case
  database values continue to match roster people and responsibility history.

## 2026-08-14 — ACA overview review fixes

- Restored `supabase/schema.sql`, which had been truncated from 4870 lines to 77
  in the working tree. That truncation was also what made the two
  `sla-config.test.ts` schema-drift tests fail.
- Enabled row level security on `enrollment_queue_members` and
  `enrollment_overview_settings`. The anon key ships to the browser, so without
  it any visitor could read those tables, add themselves to the assignment queue,
  or rewrite the dashboard threshold. Both are written only through service-role
  routes, which bypass RLS, so no policies are needed.
- Keyed queue membership by `(email, program)` instead of email alone, and gave
  the upsert an explicit conflict target. Previously an ACA toggle would have
  governed every program — the exact flaw this design criticised in the CS queue.
- Fixed `Avg tasks per person`: it divided *all* open records by the number of
  people holding work, counting the unassigned queue against people who were not
  holding it. Now assigned open records over active people.
- Fixed the people table's `Done` column, which counted any record with
  `closed_at` set. `11-Terminated` sets that too, so the throughput column was
  crediting people for losing customers. Now only `10-DONE` counts.
- Fixed the record trigger's `elsif` chain, which meant a handover stamped the
  assignment clock and then skipped the activity clock — so a record passed
  between people looked progressively more neglected the more attention it got.
  The two branches are now independent.
- Added the team baseline row to the people table and the Total row to the
  person × stage matrix (occupancy totals, and the stage baseline in speed mode).
  Both existed in the payload but were never rendered; without them a bad
  per-person percentage cannot be told apart from a bad stage.
- Replaced the stage table's `stageAgeEstimated` boolean with `estimatedCount`.
  One old record used to mark an entire row as estimated, so nearly every row was
  marked and the warning stopped meaning anything.
- Removed a duplicate snapshot request on every dashboard mount, caused by
  adopting the server threshold into the state the fetch depended on.
- Assigning a record now updates the `Unassigned` tile, the team row and the
  unassigned row together, instead of leaving the tile contradicting the table,
  and adopts the returned `updated_at` so a second edit cannot 409 on a stale
  timestamp.
- The two optional config tables now degrade identically when absent, matching on
  Postgres/PostgREST error codes rather than on English message text.
- Attributed cycle emails are normalised on the way out, not only for the
  start/end comparison, so a mixed-case row is no longer silently dropped.
- Added regression tests for the average, the done count, the team/unassigned
  rows and the estimated count, plus SQL assertions for RLS, the composite key,
  and the trigger moving both clocks on assignment.

## 2026-08-14 — ACA overview schema replay fixes

- `enrollment_options.treat_as_terminal` was declared only inside
  `create table if not exists`, which is a no-op on an existing database. Running
  `schema.sql` against any live environment failed with
  `column "treat_as_terminal" of relation "enrollment_options" does not exist`
  at the ACA option seed. Added the matching
  `alter table ... add column if not exists`, the pattern the rest of the file
  already uses for columns added after a table ships.
- `enrollment_stage_cycles.responsible_start_email` / `responsible_end_email`
  were never declared in `schema.sql` at all, yet the responsibility trigger and
  both atomic RPCs write them — so a database built from `schema.sql` broke at
  the first stage transition. Added both columns. (They had been added to
  `task_stage_cycles` instead, where nothing reads them.)
- `schema.sql` still carried the pre-fix `elsif` version of
  `enrollment_sync_overview_timestamps`. Both it and the rollout use
  `create or replace`, so replaying the schema silently reinstated the bug where
  an assignment skipped the activity clock. Now matches the rollout.
- Added `enrollment_queue_members` and `enrollment_overview_settings` to
  `schema.sql`; they existed only in the rollout, so a fresh environment got
  neither table. Both are registered in the `protected_tables` list that enables
  row level security, rather than enabling it in two places.
- Moved the queue-membership `useCallback` above the dashboard's loading/error
  early returns. It was declared after them, so the loading render called eleven
  hooks and the loaded render called twelve, crashing with "rendered more hooks
  than during the previous render" as soon as the first snapshot arrived.
- Added an expandable column-definition legend to the ACA stage table, plus
  header tooltips. Three of those columns go blank rather than showing zero when
  the underlying stage-entry clock was never recorded, which is indistinguishable
  from "nothing is wrong" without a stated definition.

## 2026-08-14 — ACA overview rebuilt on the dashboard design system

- Installed the four `dash-*` skills into `.claude/skills/` and adopted two of
  them for the ACA overview: `dash-design-system` (tokens + 23 primitives) and
  `dash-page-patterns` (page anatomy, glance hero, numbered section rhythm,
  provenance footer).
- **Skipped `dash-charts` on purpose.** It mandates ECharts, the project already
  ships Recharts, and this page has no charts at all — adopting it would add a
  second charting library and ~1MB for zero charts. Revisit as one decision if
  the page ever needs one.
- The overview is the only thing restyled. Sidebar, page title, Export, New
  enrollment, the Overview/List tabs and the date picker are untouched: the
  design tokens are bound to a `.aca-dash` wrapper instead of `:root`, the
  upstream global reset and app shell were dropped, and every rule in
  `primitives.css` / `page.css` is prefixed with that scope so a bare `.card` or
  `.chip` rule cannot reach the rest of the portal.
- Recomposed the page as: filter bar (staleness threshold + window) → coverage
  banner → five-tile glance hero → five numbered sections (VOLUME, PIPELINE,
  ATTENTION, PEOPLE, QUEUE) → provenance footer.
- Added a coverage banner that fires when at least half of open records have no
  recorded stage-entry time, naming the count and saying which three columns go
  blank as a result. Previously that state was indistinguishable from healthy.
- Moved the ACA overview's Unassigned list out of section 03 and under section
  05, directly below the assignment queue. The queue answers who is next and the
  list is what to hand them; splitting them meant reading one section and acting
  in another. Section 03 is now the single full-width Needs-action list.

## 2026-08-15 — Table Config write validation foundation

- Added a service-role-only `table_config_write_context` RPC and typed loader so
  Task and Enrollment mutations can validate only touched columns/options in one
  request, with conditional Person matching and no full roster fetch.
- Added pure custom-value type, active-option, archived-column and scoped-Person
  validation plus context-based Required checks; explicit checkbox `false` and
  optional `null` remain valid values.
- Task Create/PATCH now validate custom values and Required fields from that
  same context. Existing transition cleaning and custom-values-only edits remain
  owned by `resolveTaskPatch`; no full table metadata or assignee roster is
  loaded on the inline-edit path.
- Enrollment Create/PATCH now use the same one-request validation context,
  reject malformed or stale custom values, preserve unrelated custom fields on
  partial edits, and enforce Required custom fields in the ACA/Medicare Create
  dialog with controlled dropdown, Person, checkbox, text, number, date and
  link inputs.
- Config column, custom-option, enrollment-option and task-category mutations
  now target active rows atomically and return a stable conflict when an id is
  archived, missing or belongs to another parent; raw database errors are not
  sent to callers on these mutation paths.
- Enrollment option-rule writes now reject terminal/QC flags outside Stage and
  ACA dashboard-terminal flags outside ACA Stage instead of coercing invalid
  values. Config only renders those controls for eligible Stage groups, and
  the option-set read response reports legacy invalid rule ids for explicit
  cleanup.

## 2026-08-16 — Migration runbook and two rollout fixes

- Fixed `supabase/rollouts/2026-08-15-enrollment-stage-setup.sql`. It created
  `create temporary table ... on commit drop` at the top level and referenced
  those tables from later statements, so any client that does not execute the
  script as a single unit (the Supabase Studio SQL editor among them) dropped
  them in between and failed with `42P01: relation "_enrollment_stage_setup"
  does not exist`. The migration is now one `DO` block: no client can split it,
  the temp tables live for its whole duration, and any failure rolls everything
  back. The SQL logic is unchanged.
- The same migration now clears `stage_id` (with the matching
  `stage_entered_at` / `stage_entered_source` pair) on active records whose
  stage falls outside the canonical catalog and is about to be archived.
  Previously such a record kept pointing at an archived stage that no picker
  could show or re-select. Archived records keep their historical reference.
- Fixed `supabase/rollouts/2026-08-13-aca-overview-schema.sql`. Its
  `last_work_activity_at` backfill used `update ... from lateral (... where
  activity.record_id = records.id)`, but PostgreSQL does not put an UPDATE's
  target table in scope for a LATERAL item, so the statement always failed with
  `42P10: invalid reference to FROM-clause entry for table "records"`. That is
  why this backfill had never been applied. Pre-aggregating by `record_id` and
  joining is equivalent and runs.
- Added `supabase/run-order/`: the pending migrations split into numbered,
  individually runnable files with a README covering apply order, rollback,
  per-step verification, and which Supabase Studio "destructive operation"
  warnings are false positives. `CREATE INDEX CONCURRENTLY` is dropped in the
  two index files because Studio wraps every submission in a transaction.
