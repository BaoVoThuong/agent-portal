# Task Management Code Review — 23/08/2026

> [codex - Sol ] **Kết quả review:** Approve with changes. Report của Luna tìm đúng các vùng rủi ro chính, nhưng phần “đã xác nhận” đang trộn bug chức năng, security issue và giả thuyết hiệu năng. Thứ tự sửa thực tế nên là: (1) membership fail-open, (2) assignment permission, (3) đồng bộ visibility giữa list/detail/direct GET/search, rồi mới đến các tối ưu có tính mở rộng.

> [Claude-opus5.0] **Approve with changes — nhưng thứ tự ưu tiên nhóm hiệu năng cần đảo lại.** Em đã đối chiếu từng finding với source ở commit hiện tại, và thêm một nguồn mà cả hai bản review đều không có: **số liệu Vercel Observability thật, cửa sổ 12h ngày 22/08**.
>
> Phần correctness/security của Luna và Sol đúng gần hết. Em chỉnh ba chỗ: điều kiện kích hoạt của HIGH-01 hẹp hơn mô tả; MEDIUM-01/02/03 là **một** nguyên nhân gốc chứ không phải ba; MEDIUM-05 và MEDIUM-06 mô tả sai bản chất (một cái tất định chứ không phải race, một cái trỏ vào code chết).
>
> Phần hiệu năng thì khác hẳn: **hai route tốn nhất trong production không có mặt trong report** (chiếm 68% invocations), còn HIGH-06 và HIGH-07 được xếp hạng cao hơn thực tế nhiều. Xem mục "Đối chiếu với số liệu production" ở cuối.
>
> Đã chạy lại kiểm chứng: `npm run test:run` → 108 files / 760 tests passed, khớp với con số trong report.
>
> **Cảnh báo về độ tươi của số liệu:** phần "Đối chiếu với số liệu production" bên dưới đo ở cửa sổ 12h kết thúc ~01:30 ngày 22/08, khi HEAD còn là `13e8e12`. Đến lúc viết nhận định này HEAD đã là `03caeac`, hơn 28 commit sau, và `6f32194` đã sửa mất hai trong ba hotspot em nêu. Em đã đính chính ngay trong mục đó thay vì xoá, để giữ lại lý do. Ai đọc report này nên **đo lại một cửa sổ mới** trước khi ra quyết định chi phí.

## Phạm vi và cách review

Đã review toàn bộ repository theo 3 luồng Luna độc lập, tập trung sâu vào:

- Task Management: list/board, detail drawer, access control, assignment, comments, reactions, attachments, search, notifications.
- Hiệu năng: database query, API payload, cache, realtime, polling và Vercel runtime.
- UI/runtime: modal, optimistic update, hydration, accessibility và parity giữa CS/Enrollment.

Đây là **code review tĩnh**, đối chiếu thêm bằng test/typecheck/lint. Các mục bên dưới được chia thành:

- **Đã xác nhận bằng source code:** có đường đi và impact rõ ràng trong code hiện tại.
- **Cần đo thêm:** có khả năng gây vấn đề nhưng cần `EXPLAIN ANALYZE`, production cardinality hoặc browser/E2E để kết luận mức độ.

## Kết luận nhanh

Không thấy lỗi làm hỏng dữ liệu hoặc bypass qua các route reaction/attachment chính. Tuy nhiên có hai nhóm cần ưu tiên:

1. **Phân quyền và visibility chưa dùng chung một luật:** assignment, list, direct GET, detail, comments và search có thể cho kết quả khác nhau. Có một nhánh membership lookup có khả năng fail-open.
2. **Task Board đang tải quá nhiều dữ liệu mỗi lần:** full task snapshot, broad overview scan, fan-out search và reaction của toàn bộ comment history. Khi dữ liệu tăng, latency và chi phí Vercel/Supabase sẽ tăng theo.

## Các finding đã xác nhận

### HIGH-01 — Membership lookup lỗi có thể làm phân quyền fail-open

**File liên quan:** [membership.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/membership.ts:60), [membership.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/membership.ts:125), [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:43)

**Mô tả:** `fetchAssistantAgentsForCs()` trả về danh sách rỗng khi query membership lỗi. Sau đó `actorSeesAllTasks()` có thể hiểu rằng user không phải assistant và cho `seeAll = true`. Một assistant có thể bị phân loại thành plain CS và thấy toàn bộ task queue.

**Cách tái hiện:** Làm query membership của một assistant bị lỗi tạm thời, sau đó gọi `/api/tasks`. Nếu user không nằm trong selected-agent list, nhánh `seeAll` có thể được bật.

**Impact:** Có nguy cơ lộ task ngoài phạm vi được phép xem trong thời điểm database/auth lookup lỗi. Đây là vấn đề security/correctness, không chỉ là UI.

**Đề xuất:** Authorization lookup phải **fail-closed**: query lỗi thì trả lỗi access/deny, không biến lỗi thành “không có membership”. Thêm regression test cho membership query error.

> [codex - Sol ] **Xác nhận — ưu tiên cao nhất.** Source hiện trả mảng rỗng khi query assistant lỗi, trong khi caller dùng mảng rỗng như bằng chứng user là plain CS. Cần sửa đồng bộ tất cả membership helper tham gia authorization, không chỉ riêng fetchAssistantAgentsForCs, và test cả lỗi Supabase/PostgREST.

> [Claude-opus5.0] **Xác nhận bug, nhưng điều kiện kích hoạt hẹp hơn mô tả.** `fetchSelectedAgentEmails` (assignees.ts:35-41) **throw** khi query lỗi chứ không trả Set rỗng. Vì `fetchTasksForActor` gọi hai hàm trong cùng một `Promise.all`, sự cố database toàn phần sẽ **fail-closed** (500) chứ không fail-open. Fail-open chỉ xảy ra khi query `agent_members` lỗi **trong khi** `task_agents` vẫn chạy được: schema-cache miss (PGRST205), statement timeout riêng câu đó, hoặc đổi RLS trên đúng bảng đó. Repo này đã có sẵn helper xử lý đúng loại lỗi PGRST205 (`isMissingTaskParticipantsError`), nên đây là kịch bản có thật chứ không phải giả định. Vẫn giữ ưu tiên số 1.
>
> **Bổ sung cả hai bản review đều bỏ sót:** `fetchAgentsForCs` (membership.ts:5-13) và `fetchAssistantAgentsForCs` (membership.ts:60-68) là **hai câu query giống hệt nhau từng ký tự** — cùng bảng `agent_members`, cùng filter `cs_email = email AND is_assistant = true`, cùng cột `agent_email` — nhưng code gọi lại gán cho chúng hai ý nghĩa khác nhau ("agent mà CS này phụ trách" vs "agent mà người này làm assistant"). Cần chốt đây là trùng lặp cần gộp hay một trong hai đang sai filter. Nếu là sai filter thì đó là bug phân quyền độc lập, không liên quan fail-open.

### HIGH-02 — Assignment endpoint không kiểm tra đúng permission `task.manage`

**File liên quan:** [assign/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/assign/route.ts:29), [access.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/access.ts:22)

**Mô tả:** Route assignment kiểm tra `isTaskViewAdmin()` trực tiếp thay vì dùng actor/permission resolver chung và xác nhận `task.manage`.

**Cách tái hiện:** Tạo role có quyền xem/admin theo cách hiện tại nhưng bỏ `task.manage`, rồi gọi `POST /api/tasks/:id/assign`.

**Impact:** User không có quyền quản lý task vẫn có khả năng thay đổi người được assign. Điều này làm permission model giữa UI và API không nhất quán.

**Đề xuất:** Route dùng `buildTaskActor()` rồi kiểm tra `actor.isManager` hoặc `canAssign(actor)`. Thêm test role có/không có `task.manage`.

> [codex - Sol ] **Xác nhận — High hợp lý.** RPC assign_unassigned_task là security-definer và chỉ kiểm tra người được nhận task có hợp lệ; RPC không tự xác nhận p_actor_email có task.manage. Vì vậy route API hiện là hàng rào quyền duy nhất và phải dùng permission resolver chung.

> [Claude-opus5.0] **Xác nhận, nhưng cần nói rõ phạm vi kẻo hiểu quá rộng.** `isTaskViewAdmin` (access.ts:22-32) không kiểm tra `task.manage`; `canAssign` (access.ts:68) thì yêu cầu `isManager = task.manage AND isAdmin`. Tập user lọt qua vì vậy là: **có role admin / Super Admin / Task Admin nhưng bị thu hồi `task.manage`** — không phải "người xem bất kỳ". Comment ở access.ts:19-21 cho thấy chênh lệch này là **cố ý theo một chiều** (giữ agent/assistant có manage ra khỏi màn admin), nhưng chiều ngược lại thì không ai cố ý. Trước khi sửa nên query DB xem hiện có role nào rơi vào tổ hợp đó chưa — nếu chưa có thì đây là lỗ hổng tiềm tàng chứ chưa khai thác được, và có thể xếp sau HIGH-01.

### HIGH-03 — `/api/tasks` tải toàn bộ task list, không phân trang

**File liên quan:** [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:25), [route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/route.ts:83)

**Mô tả:** Board lấy toàn bộ active task trong một snapshot, kèm exact count. Nếu response bị cắt, code chủ động trả `503 TASK_LIST_TRUNCATED` thay vì pagination.

**Impact:**

- Latency, memory, JSON serialization và network tăng tuyến tính theo số task.
- Board có thể không mở được khi vượt giới hạn response của PostgREST.
- Các lần refresh/realtime refetch đều trả lại toàn bộ dữ liệu.

**Đề xuất:** Cursor pagination hoặc server-side board snapshot; render/virtualize phần đang nhìn thấy; tách exact count thành query riêng hoặc cache count.

> [codex - Sol ] **Xác nhận về kiến trúc; mức High phụ thuộc quy mô.** Hiện code fail-closed khi snapshot bị cắt là đúng về an toàn dữ liệu, nhưng UX sẽ thành 503 khi vượt ngưỡng. Nên đo số task active và kích thước response hiện tại để chọn cursor pagination hay snapshot RPC; không nên chỉ bỏ kiểm tra truncation.

> [Claude-opus5.0] **Đồng ý với Sol: kiến trúc đúng, mức High phụ thuộc quy mô.** Số đo production 12h ngày 22/08: `/api/tasks` chạy **5.1K lần, 3m Active CPU** — đứng thứ hai, không phải thứ nhất. Error rate 0%, tức chưa từng chạm ngưỡng 503 truncation. Xếp sau nhóm correctness.

### HIGH-04 — Visibility query tạo filter ID/email rất lớn

**File liên quan:** [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:47)

**Mô tả:** Server lấy membership/task IDs trước, rồi đưa danh sách lớn vào `.in(...)` và `.or(...)` để lọc task.

**Impact:** Request dài, parse chậm, query planner phải xử lý nhiều điều kiện; khi membership/task tăng có thể gặp giới hạn URL/header và tăng tải database.

**Đề xuất:** Đưa visibility vào một RPC/view SQL dùng `JOIN`/`EXISTS`, để database lọc trực tiếp thay vì truyền danh sách ID qua nhiều round-trip.

> [codex - Sol ] **Đồng ý hướng tối ưu, nhưng nên xếp Medium cho tới khi đo.** Đây chưa phải bug xảy ra chắc chắn; impact phụ thuộc số agent, participant và assigned task của một user. Cần log số phần tử trong từng filter và độ dài request trước khi thiết kế RPC.

### HIGH-05 — Task detail chạy nhiều authorization query thừa

**File liên quan:** [detail/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/detail/route.ts:129)

**Mô tả:** Với non-manager, route chạy đồng thời nhiều check: owner/assistant, participant, assignee, agent list và `actorSeesAllTasks()` trước khi load detail.

**Impact:** Mỗi lần mở drawer có thể phát sinh nhiều query không cần thiết, làm cảm giác mở task chậm và tăng DB/Vercel usage.

**Đề xuất:** Resolve broad access trước. Nếu user có full CS queue visibility thì bỏ qua các check task-specific. Tốt nhất gom thành một access RPC dùng chung.

> [codex - Sol ] **Xác nhận là hotspot hiệu năng, không phải bug chức năng.** Route đang chạy năm scope checks trước mỗi detail load. Nên dùng Server-Timing sẵn có để so sánh scope/detail trước và sau; đồng thời việc gom access phải giữ nguyên nguyên tắc “không đọc comment/file trước khi authorize”.

> [Claude-opus5.0] **Hạ xuống Low theo số đo.** `/api/tasks/[id]/detail` chiếm **2.4K/33K invocations (7%)** và **2m/~20m Active CPU** trong 12h. Năm scope check là có thật, nhưng chúng chạy song song trong một `Promise.all` nên chi phí là **max**, không phải tổng. Sửa cái này gần như không đổi hóa đơn. Giá trị thật nằm ở độ trễ mở drawer — và nếu vậy thì nên đo bằng `Server-Timing` đã có sẵn trong route trước khi refactor.

### HIGH-06 — Overview quét rộng và refresh định kỳ 30 giây

**File liên quan:** [overview-data.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/overview-data.ts:25), [TaskBoardClient.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/TaskBoardClient.tsx:610)

**Mô tả:** Overview tải nhiều dataset, lọc date một phần ở JavaScript sau khi đã lấy rows, và manager overview refresh mỗi 30 giây.

**Impact:** Tạo tải nền liên tục trên database, CPU, egress và Vercel function; nhiều tab/user manager sẽ nhân số request. Đây là nhóm có khả năng liên quan trực tiếp đến chi phí Observability/Function hiện tại.

**Đề xuất:** Đẩy date predicate xuống SQL, thay row scan bằng aggregate RPC, cache snapshot ngắn hạn và chỉ refresh khi có mutation/realtime liên quan.

> [codex - Sol ] **Xác nhận.** Overview hiện lấy toàn bộ active rows rồi lọc cohort trong JavaScript và refresh mỗi 30 giây khi màn Overview mở. Đây là ứng viên giảm chi phí rõ hơn search. Nên ưu tiên SQL aggregate + cache ngắn hạn, sau đó mới thay đổi interval.

> [Claude-opus5.0] **Không đồng ý mức High — đây là finding bị xếp hạng lệch nhiều nhất so với thực tế.** Report viết đây là "nhóm có khả năng liên quan trực tiếp đến chi phí Observability/Function hiện tại". Số đo bác bỏ: trong bảng Functions 12h của Vercel, **`/api/tasks/overview` không xuất hiện trong top 5 route**, trong khi top 5 đã chiếm ~90% invocations. Lý do nằm ở chính TaskBoardClient.tsx:607-610 — interval 30 giây bị chặn bởi `if (!isManager || view !== "overview" || !overviewSnapshot) return`, tức chỉ chạy khi một manager đang **mở đúng tab Overview**. Với vài manager thì tải nền không đáng kể. Vẫn nên đẩy date predicate xuống SQL, nhưng xếp Medium và làm sau nhóm correctness.

### HIGH-07 — Search có thể fan-out thành hàng chục query

**File liên quan:** [search.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/search.ts:124), [search.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/search.ts:232)

**Mô tả:** Search quét tối đa khoảng 1.000 raw rows cho từng nhóm và thực hiện thêm visibility/metadata query trong quá trình paging.

**Impact:** Một lượt search rộng có thể tạo nhiều DB requests; nhiều user search cùng lúc sẽ gây connection/CPU pressure và làm search chậm không ổn định.

**Đề xuất:** Tạo một search RPC/view có full-text/trigram matching và visibility predicate trong database, dùng keyset pagination và một access evaluation duy nhất.

> [codex - Sol ] **Finding hợp lý nhưng chưa đủ bằng chứng để giữ High.** MAX_SEARCH_SCAN chỉ là trần, không đồng nghĩa mỗi search luôn quét 1.000 × 3 rows. Chuyển thành Medium/needs measurement, bổ sung log pages scanned, candidate count và DB duration theo từng group.

> [Claude-opus5.0] **Đồng ý hạ cấp, và có số liệu chứng minh chứ không chỉ suy luận.** Route search **không xuất hiện trong bảng Functions 12h**. `MAX_SEARCH_SCAN = 1000` là trần an toàn, và comment ngay tại search.ts:127-131 đã giải thích vì sao phải page (visibility được resolve sau khi join membership). Xếp Low / needs-measurement.

### HIGH-08 — Reaction query lấy reactions của toàn bộ comment history

**File liên quan:** [detail.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/detail.ts:320), [schema.sql](/Users/vothuongbao/Project/Web/agent-portal/supabase/schema.sql:2096)

**Mô tả:** Comment đã pagination, nhưng `task_comment_reactions_for_task` vẫn trả reactions của mọi comment trong task. Client chỉ gắn reaction cho visible comments sau đó, nên phần dữ liệu thừa vẫn đã bị query/trả về.

**Impact:** Task có lịch sử comment dài sẽ tốn query time, payload và client processing; làm mất lợi ích của comment pagination và có thể khiến reaction load chậm.

**Đề xuất:** Chỉ lấy reactions theo danh sách visible comment IDs, hoặc đưa reactions vào cùng paginated comments RPC.

> [codex - Sol ] **Xác nhận logic nhưng nên xếp Medium.** Query toàn bộ reaction thực sự làm giảm lợi ích pagination, tuy nhiên impact phụ thuộc số comment/reaction mỗi task. Hướng tốt nhất là RPC nhận visible comment IDs hoặc paginated comment RPC trả luôn reaction groups.

> [Claude-opus5.0] **Xác nhận bằng chữ ký hàm, không cần đọc thân hàm.** `task_comment_reactions_for_task(p_task_id uuid)` chỉ nhận task id — không có tham số comment id nào — nên chắc chắn trả toàn bộ lịch sử reaction của task. Số đo: `/api/tasks/[id]/comment-reactions` chạy **1.2K lần, 52s Active CPU** trong 12h. Chi phí hiện nhỏ nhưng tăng tuyến tính theo độ dài thread. Đồng ý mức Medium của Sol.

### MEDIUM-01 — Policy backlog không nhất quán giữa helper và task list

**File liên quan:** [access.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/access.ts:54), [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:43), [comments/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/comments/route.ts:52)

**Mô tả:** `canSeeBacklog()` mô tả backlog là manager-only, nhưng nhánh plain CS trong `fetchTasksForActor()` không loại backlog. Vì vậy list/detail/comment có thể cho plain CS thấy và thao tác backlog.

**Impact:** Người dùng có thể thấy khác với policy được mô tả trong code/tests; search và các route khác có thể lại cho kết quả khác. Đây là policy drift, cần chốt business rule.

**Đề xuất:** Chọn một chính sách rồi áp dụng xuyên suốt list, detail, comments, reactions, attachments và search. Nếu backlog collaboration là chủ ý hiện tại thì đổi tên/helper/test để phản ánh đúng.

> [codex - Sol ] **Không coi đây là bug sản phẩm theo yêu cầu hiện tại.** Anh đã chốt trước đó rằng task backlog vẫn được comment. Vì vậy không nên thêm lại chặn backlog; cần cập nhật canSeeBacklog, comment “manager-only” và tests để phân biệt “được thấy/collaborate” với “được assign/quản lý backlog”.

### MEDIUM-02 — Direct task GET có scope khác detail/list/comments

**File liên quan:** [task route](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/route.ts:106), [detail route](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/detail/route.ts:136), [TaskBoardClient.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/TaskBoardClient.tsx:1326)

**Mô tả:** Board/detail cho phép plain CS mở shared-queue task, nhưng `GET /api/tasks/:id` chỉ dùng `canViewTask()` và có thể trả 403.

**Impact:** Khi client gặp conflict `409` rồi cần reload task canonical, reload có thể thất bại dù task đang hiển thị hợp lệ. UI có thể giữ state cũ hoặc hiện “reload to continue”.

**Đề xuất:** Dùng một read-visibility resolver cho list, direct GET, detail, comments, reactions và attachments. Tách quyền đọc khỏi quyền mutation.

> [codex - Sol ] **Xác nhận — bug chức năng thật.** Direct GET hiện không gọi actorSeesAllTasks trong khi detail/comments có gọi. Trường hợp conflict recovery sau 409 là đường tái hiện cụ thể; nên sửa cùng MEDIUM-03 bằng một resolver dùng chung thay vì vá riêng từng route.

> [Claude-opus5.0] **MEDIUM-01, MEDIUM-02 và MEDIUM-03 là MỘT nguyên nhân gốc, không phải ba finding riêng.**
>
> Dòng 1 của access.ts tự mô tả: *"The ONLY place task-board permission/scope decisions are made"*. Câu đó **không còn đúng**. Luật "plain-CS thấy toàn bộ company queue" (`seeAll`) không nằm trong `canViewTask` — nó nằm riêng ở `actorSeesAllTasks()` (membership.ts:126-135) và **được viết lại lần thứ hai** ngay trong `fetchTasksForActor()` (queries.ts:45-51). Hệ quả: mọi route đọc task phải **tự nhớ** OR thêm `seeAll` vào.
>
> Em kiểm cả bốn nơi:
>
> | Nơi đọc task | Có gọi `actorSeesAllTasks`? |
> |---|---|
> | comments route (comments/route.ts:59) | Có |
> | detail route (detail/route.ts:143) | Có |
> | **direct GET** (`[id]/route.ts:129-134`) | **Không** → MEDIUM-02 |
> | **search** (search.ts:94-121) | **Không** → MEDIUM-03 |
>
> Đáng chú ý: comment ngay trên `isHitVisible` khẳng định ngược lại — *"Reuses canViewTask so search visibility cannot drift from board visibility"*. Comment này sai, vì board có thêm nhánh `seeAll` mà `canViewTask` không biết.
>
> **Vì vậy đừng vá ba chỗ.** Đưa `seeAll` thành một flag trong chính resolver dùng chung rồi xoá hai bản sao của luật. Làm cách này thì MEDIUM-01 cũng tự giải quyết, vì `canSeeBacklog` sẽ nằm cùng một nơi với luật thật thay vì mô tả một chính sách mà list không thi hành.

### MEDIUM-03 — Search bỏ sót task shared queue của plain CS

**File liên quan:** [search.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/search.ts:93), [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:43)

**Mô tả:** List dùng luật plain CS thấy shared queue, nhưng `isHitVisible()` của search vẫn áp dụng scoped `canViewTask()` và không dùng cùng luật `actorSeesAllTasks()`.

**Impact:** Task có trên board nhưng không xuất hiện khi search. User dễ hiểu nhầm task đã bị xoá hoặc không tồn tại.

**Đề xuất:** Dùng chung visibility resolver cho list/search và thêm regression test cho plain CS search shared queue.

> [codex - Sol ] **Xác nhận — bug chức năng thật.** Comment trong search nói visibility không drift, nhưng implementation chỉ gọi canViewTask và bỏ nhánh shared queue. Cần test một task chỉ được nhìn thấy nhờ plain-CS company queue.

### MEDIUM-04 — Legacy comments endpoint trả comment đã xoá và không pagination

**File liên quan:** [comments/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/%5Bid%5D/comments/route.ts:77), [detail.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/detail.ts:109)

**Mô tả:** `GET /api/tasks/:id/comments` query trực tiếp, không filter `deleted_at`, không limit/cursor và không dùng canonical `loadComments()`.

**Impact:**

- Comment body đã soft-delete có thể bị trả ra nếu client/route cũ gọi endpoint này.
- Comment history lớn tạo response lớn và tăng memory/latency.
- Contract attachment không đầy đủ vì endpoint luôn trả `attachments: []`.

**Đề xuất:** Deprecate endpoint hoặc delegate sang `loadComments()` để dùng chung deletion filter, cursor pagination và attachment contract.

> [codex - Sol ] **Xác nhận, nhưng hiện chưa thấy client nội bộ gọi GET endpoint này.** Vì route có thể vẫn được gọi bên ngoài nên deleted_at leak cần xử lý; nếu không có consumer thì ưu tiên xoá/deprecate route sẽ an toàn và đơn giản hơn duy trì hai comment read paths.

> [Claude-opus5.0] **Xác nhận phần `deleted_at`; nhưng lưu ý route này lại chính là chỗ làm ĐÚNG phân quyền.** Query ở comments/route.ts:87-91 thật sự không lọc `deleted_at`, không limit/cursor, và trả `attachments: []` cứng. Tuy nhiên `canViewResolved` ngay phía trên (dòng 53-74) **có** gọi `actorSeesAllTasks` — đây là một trong hai nơi duy nhất thi hành đúng luật `seeAll` (xem MEDIUM-02). Nếu chọn xoá route thì phải giữ lại logic resolver này làm mẫu cho resolver dùng chung, đừng xoá cả cụm.

### MEDIUM-05 — Comment attachment retry dùng state closure cũ

**File liên quan:** [CommentThread.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/CommentThread.tsx:1182)

**Mô tả:** Sau khi retry upload thành công, code cập nhật `optimisticComments` bằng functional state update nhưng ngay sau đó lại tìm `latest` từ biến closure cũ.

**Impact:** Trong timing phù hợp, optimistic comment không được release hoặc comment tạm bị giữ/duplicate sau reload. Đây là lỗi race khó tái hiện nhưng ảnh hưởng trực tiếp trải nghiệm comment có file.

**Đề xuất:** Dùng state/ref mới nhất hoặc trả object từ functional update; chỉ gọi `releaseOptimistic()` sau khi đã đọc trạng thái sau update.

> [codex - Sol ] **Xác nhận — race condition cụ thể.** latest đang đọc optimisticComments từ closure trước setState. Nên dùng ref đồng bộ với state hoặc quyết định release ngay trong functional update; cần test retry file cuối cùng thành công sau một lần upload fail.

> [Claude-opus5.0] **Xác nhận, nhưng nặng hơn mô tả — đây không phải race "khó tái hiện", nó tất định.** Tại CommentThread.tsx:1198, `optimisticComments` là biến closure của lần render đã tạo ra handler; `setOptimisticComments` ở dòng 1182 không thể thay đổi biến đó. Nên `latest.fileStates` **luôn** là trạng thái *trước* khi file vừa upload xong được đánh dấu success. Với file cuối cùng trong danh sách, `every(state => state.status === "success")` **luôn** trả false → `releaseOptimistic(tempId)` **không bao giờ chạy**. `await onReload()` nằm ở giữa cũng không cứu được, vì closure đã cố định từ lúc render.
>
> Kết quả người dùng thấy: retry upload thành công, nhưng comment tạm vẫn nằm lại cạnh comment thật sau khi reload — đúng triệu chứng "duplicate" mà report mô tả, chỉ khác là nó xảy ra **mọi lần** chứ không phải "trong timing phù hợp". Test cần: upload 1 file fail → retry thành công → assert comment tạm biến mất.

### MEDIUM-06 — Participant email chưa normalize đồng nhất

**File liên quan:** [participants.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/participants.ts:9)

**Mô tả:** Một số query so sánh email exact, trong khi normalize trim/lowercase không được áp dụng thống nhất ở read và write.

**Impact:** Email khác hoa thường hoặc có whitespace có thể làm mất quyền xem/comment dù thực tế là cùng một user.

**Đề xuất:** Chuẩn hoá email ở một helper dùng chung trước khi lưu/query; thêm unique/index strategy phù hợp và test mixed-case/whitespace.

> [codex - Sol ] **Đồng ý.** Đây là correctness risk có bằng chứng ở source vì read/write đều có nhánh exact comparison. Cần normalize cả dữ liệu cũ trước khi thêm unique constraint, tránh migration thất bại do duplicate khác case.

> [Claude-opus5.0] **Xác nhận có vấn đề, nhưng hàm được trỏ tới là code chết — sửa nó sẽ không thay đổi gì.** `addParticipants()` (participants.ts:56-70) **không có caller nào** trong toàn repo; em grep cả `src/` lẫn `supabase/`, kết quả duy nhất là chính dòng định nghĩa.
>
> Đường ghi thật nằm trong RPC comment ở schema.sql:
> ```sql
> insert into task_participants (task_id, email, source)
> select p_task_id, mention_email, 'mention'
> from unnest(p_mentions) as mention_email
> where mention_email is not null and btrim(mention_email) <> ''
> ```
> Nó **lọc** chuỗi rỗng nhưng **ghi nguyên văn** — không `lower()`, không `btrim()`. Phía trên nó, mentions.ts:10 làm `emails.add(match[1].trim())`: có trim, **không có lowercase**.
>
> Đường đọc thì so khớp tuyệt đối: `isTaskParticipant` (participants.ts:46) và `fetchParticipantTaskIds` (participants.ts:12) đều dùng `.eq("email", email)` với email lấy từ session.
>
> **Tái hiện cụ thể:** mention `@Bao.Vo@Example.com` trong khi account là `bao.vo@example.com` → row participant được tạo, nhưng `isTaskParticipant()` không bao giờ khớp → **người được mention âm thầm không có quyền xem task**, và không có thông báo lỗi nào. Fix phải chạm cả RPC lẫn `mentions.ts`, và phải backfill dữ liệu cũ **trước** khi thêm unique constraint, nếu không migration sẽ fail vì duplicate khác case.

### MEDIUM-07 — Attachment upload khi tạo task/comment chạy tuần tự

**File liên quan:** [NewTaskDialog.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/NewTaskDialog.tsx:241), [CommentThread.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/CommentThread.tsx:1070)

**Mô tả:** Mỗi file chỉ bắt đầu upload sau khi file trước hoàn tất.

**Impact:** Thời gian tạo task hoặc gửi comment tăng gần tuyến tính theo số file, dù các upload độc lập nhau.

**Đề xuất:** Bounded concurrency 2–4 file song song, vẫn giữ progress/error riêng từng file để không làm quá tải browser/storage.

> [codex - Sol ] **Đồng ý nhưng đây là optimization, không phải bug.** Bounded concurrency 2–3 phù hợp hơn Promise.all không giới hạn. Cần giữ idempotency key và per-file retry hiện tại.

### MEDIUM-08 — Create dialog/detail drawer thiếu chuẩn modal chung

**File liên quan:** [NewTaskDialog.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/NewTaskDialog.tsx:299), [TaskDetailDrawer.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/TaskDetailDrawer.tsx:627)

**Mô tả:** Hai modal chính chưa có đầy đủ Escape handling, focus trap, `role="dialog"`/`aria-modal` và restore focus; preview attachment dialog là trường hợp riêng đã có cơ chế tốt hơn.

**Impact:** Keyboard user có thể focus ra ngoài modal, không đóng được bằng Escape hoặc mất vị trí focus sau khi đóng. Đây là accessibility và UX issue.

**Đề xuất:** Tạo `ModalShell` dùng chung cho CS/Enrollment với Escape, focus trap, restore focus, body scroll lock và ARIA chuẩn.

> [codex - Sol ] **Xác nhận.** Nên tái sử dụng behavior đã có trong AttachmentPreviewDialog thay vì tự viết thêm một cơ chế focus khác; làm chung cho CS và Enrollment để tránh parity drift.

### MEDIUM-09 — Metadata count dùng correlated subquery theo từng task

**File liên quan:** [queries.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/queries.ts:223), [schema.sql](/Users/vothuongbao/Project/Web/agent-portal/supabase/schema.sql:2203)

**Mô tả:** Comment/attachment counts được tính bằng các correlated subquery cho từng task ID.

**Impact:** Với 1.000 task, database phải lặp nhiều index lookup/aggregation; thời gian và CPU tăng khi board lớn.

**Đề xuất:** Aggregate một lần bằng `GROUP BY task_id` rồi join vào task rows; về lâu dài dùng counter hoặc metadata snapshot.

> [codex - Sol ] **Chuyển sang mục cần đo thêm.** Correlated subquery không tự động đồng nghĩa N+1 ở database vì planner/index có thể tối ưu. Chỉ thay SQL sau khi EXPLAIN ANALYZE cho thấy repeated scans hoặc CPU đáng kể.

### MEDIUM-10 — Realtime invalidation có thể refetch toàn bộ board ở nhiều tab

**File liên quan:** [TaskBoardClient.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/%28authed%29/tasks/_components/TaskBoardClient.tsx:616)

**Mô tả:** Một mutation/realtime event có thể clear detail cache và làm các tab cùng refetch full `/api/tasks`.

**Impact:** Một thay đổi nhỏ bị khuếch đại thành nhiều full snapshot requests, tăng latency và Vercel/DB/Observability cost.

**Đề xuất:** Broadcast task IDs thay đổi, patch row/detail bị ảnh hưởng; cân nhắc một tab làm network leader qua `BroadcastChannel`.

> [codex - Sol ] **Xác nhận có full refetch amplification, nhưng code đã có debounce/coalescing.** Bước tiếp theo nên đo số refetch thực tế theo mutation trước; patch-by-ID có rủi ro làm cache/list filter sai nếu task đổi category/status/visibility.

### MEDIUM-11 — Notification summary trả toàn bộ unread assignment IDs

**File liên quan:** [notifications/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/notifications/route.ts:20)

**Mô tả:** Summary endpoint trả mọi `task_id` chưa đọc của assignment mà không cap.

**Impact:** Payload mỗi lần poll tăng theo số unread assignment; đây là request nền có thể đóng góp vào chi phí function/observability.

**Đề xuất:** Trả count + danh sách giới hạn, hoặc chỉ trả IDs thuộc board scope hiện tại và dùng query riêng khi mở notification panel.

> [codex - Sol ] **Hạ xuống Low ở quy mô hiện tại.** Summary đã chỉ trả count và task IDs, nhẹ hơn endpoint cũ rất nhiều. Nên thêm cap để phòng dữ liệu unread tăng vô hạn, nhưng chưa phải hotspot nếu chưa có user với hàng nghìn unread assignments.

> [Claude-opus5.0] **Không đồng ý với việc hạ xuống Low — nhưng cũng không phải vì lý do report nêu.** Route này **là hotspot số 1 của toàn hệ thống**; chỉ có điều nguyên nhân không nằm ở payload unread IDs.
>
> Số đo production 12h: `/api/tasks/notifications` chạy **18K/33K invocations (55%)** và **13m/~20m Active CPU (65%)** — gấp 3.5 lần route đứng thứ hai.
>
> Nguyên nhân thật nằm ở phía client, không phải trong route: NotificationBell.tsx:291-297 đặt `setInterval` **20 giây** và **không kiểm tra `document.visibilityState`**. Agent để tab nền cả ngày thì vẫn poll đều. Task board thì làm đúng — xem `canRefreshTaskData(document.visibilityState, ...)` tại TaskBoardClient.tsx:769 — riêng chuông thì không.
>
> Nhân với chi phí mỗi lượt: route này chạy tới ~11 query Supabase một lần gọi (1 ở middleware + 1 ở `auth()` → `getUserAccessByEmail` + 5 song song ở batch đầu + tối đa 5 enrichment ở batch sau). Vì vậy nó chiếm khoảng **67% trong tổng 294K lệnh gọi Supabase/12h**.
>
> Thêm nữa, poll này gần như thừa: NotificationBell.tsx:331-333 đã đăng ký realtime `event: "new"` và gọi `load()` khi có thông báo mới. Poll 20 giây chỉ là lưới an toàn.
>
> Cap danh sách ID vẫn nên làm để phòng dữ liệu unread tăng vô hạn, nhưng đó không phải thứ đắt. Thứ đắt là tần suất poll và số query mỗi lượt.

### MEDIUM-12 — Storage bucket có thể bị kiểm tra/provision trong runtime upload

**File liên quan:** [storage.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/storage.ts:30)

**Mô tả:** Upload path có thể gọi thao tác control-plane để tạo/cập nhật bucket; cache chỉ tồn tại trong warm serverless instance.

**Impact:** Cold start/upload đầu tiên có thêm latency và request control-plane không cần thiết.

**Đề xuất:** Provision bucket qua migration/deploy; runtime chỉ đọc config và upload.

> [codex - Sol ] **Xác nhận.** Warm-instance promise chỉ giảm lặp trong một instance, không tránh control-plane calls ở cold start. Cần rollout bucket trước rồi mới bỏ ensure runtime để không làm upload production fail.

> [Claude-opus5.0] **Xác nhận.** `configureTaskBucket` (storage.ts:29-53) gọi `getBucket`, có thể `createBucket`, và **luôn** gọi `updateBucket` ở cuối kể cả khi bucket đã đúng cấu hình. Đó là 1-2 lệnh gọi control-plane mỗi cold start. Đồng ý hướng của Sol: rollout bucket trước, rồi mới bỏ ensure ở runtime.

### LOW-01 — Signing attachment có lookup O(n²)

**File liên quan:** [detail.ts](/Users/vothuongbao/Project/Web/agent-portal/src/lib/tasks/detail.ts:375)

**Mô tả:** Mỗi attachment dùng `.find()` trên toàn bộ signing result.

**Impact:** Hiện tại tác động nhỏ, nhưng CPU tăng không cần thiết khi một task có nhiều file.

**Đề xuất:** Tạo `Map<storage_path, signedUrl>` một lần rồi lookup O(1).

> [codex - Sol ] **Đồng ý, quick win ít rủi ro.** Chỉ nên làm kèm test mapping khi Storage trả thiếu, lỗi hoặc đảo thứ tự result; không đáng tách thành một release riêng.

> [Claude-opus5.0] **Xác nhận.** detail.ts:387 gọi `results.find(...)` bên trong `rows.map(...)`. Quick win, nên làm kèm lúc đụng file chứ không tách riêng.

### LOW-02 — Notification fallback nuốt nhầm schema-cache error

**File liên quan:** [notifications/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/notifications/route.ts:40), [notifications/read/route.ts](/Users/vothuongbao/Project/Web/agent-portal/src/app/api/tasks/notifications/read/route.ts:50)

**Mô tả:** `isMissingEnrollmentTableError()` coi mọi `PGRST205` hoặc message “schema cache” là lỗi thiếu bảng enrollment, kể cả khi lỗi thực tế thuộc relation khác.

**Impact:** API có thể trả count thiếu hoặc báo read thành công trong khi update notification thất bại, làm mất tín hiệu lỗi để debug.

**Đề xuất:** Chỉ suppress khi error xác định rõ relation `enrollment_notifications`.

> [codex - Sol ] **Xác nhận.** Đây là lỗi observability/reliability: fallback quá rộng có thể che lỗi relation khác. Sửa helper và test PGRST205 có/không chứa đúng tên bảng.

## [Claude-opus5.0] Đối chiếu với số liệu production — hai finding report bỏ sót

**Nguồn:** Vercel Observability, project `agent-portal-vercel`, môi trường Production, cửa sổ 12 giờ ngày 22/08/2026. Đây là phần review tĩnh của Luna/Sol không có, nên em bổ sung để chốt lại thứ tự ưu tiên nhóm hiệu năng.

Bảng Functions — 33K invocations, ~20m Active CPU, error rate 0%, cold start 0.2%, Active CPU P75 77ms:

| Route | Invocations | Active CPU | Finding tương ứng |
|---|---:|---:|---|
| `/api/tasks/notifications` | 18K (55%) | 13m (65%) | MEDIUM-11 — đang bị hạ xuống Low |
| `/api/tasks` | 5.1K | 3m | HIGH-03 |
| `/api/tasks/categories` | **4.6K (14%)** | 1m | **không có trong report** |
| `/api/tasks/[id]/detail` | 2.4K | 2m | HIGH-05 |
| `/api/tasks/[id]/comment-reactions` | 1.2K | 52s | HIGH-08 |

Bảng External APIs: **294K lệnh gọi / 12h, đúng một hostname duy nhất** (Supabase), p75 150ms, 0% lỗi. Chia ra: 294K / 33K = **8.9 lệnh gọi Supabase cho mỗi lần chạy hàm**.

Hai điểm report không nêu:

> **ĐÍNH CHÍNH (viết sau, cùng ngày):** số liệu trên lấy từ cửa sổ 12h kết thúc ~01:30 ngày 22/08. Commit `6f32194 perf: reduce notification and task polling cost` (22/08 02:02) đã sửa cả P-01 và P-02 — tức **user đã xử lý ngay đêm đó**, trước khi bản review này được viết. Hai mục dưới đây giữ lại để ghi nhận nguyên nhân, **không còn là việc cần làm**. Mục còn sống là P-03.

**P-01 — Notification poll 20 giây không kiểm tra tab ẩn.** ✅ **Đã sửa ở `6f32194`.** Hiện tại: `POLL_REALTIME_MS = 120000`, `POLL_FALLBACK_MS = 30000`, có `if (document.visibilityState !== "visible") return` trong interval, có `refreshFromForeground` khi quay lại tab, và route đã tách thành `loadSummary()` nhẹ hơn. Đây từng là khoản đắt nhất hệ thống: 55% invocations, 65% Active CPU, ~67% tổng lệnh gọi Supabase.

**P-02 — Nhịp reconcile 60 giây kéo theo `/api/tasks/categories`.** ✅ **Đã sửa ở `6f32194`.** Heartbeat hiện gọi `reconcileTaskData("tasks-only")`.

**P-03 — Bốn route mutation vứt bỏ `sourceId` khi broadcast.** ⚠️ **Vẫn còn ở HEAD `03caeac`.** Đây là phần dư còn lại giải thích vì sao `/api/tasks/categories` vẫn bám sát `/api/tasks` (4.6K so với 5.1K, tức ~90% lần refetch task cũng nạp lại categories).

`taskBroadcastReconcileScope(sourceId, ownSourceId)` trả `"full"` khi `sourceId` rỗng, và trả `null` (bỏ qua) khi trùng `ownSourceId`. Chín route mutation truyền `readTaskMutationSourceId(req)` đúng cách. **Bốn route thì không:**

| Route | Hệ quả |
|---|---|
| `comments/route.ts` (POST) | Mỗi comment mới → **mọi tab** full-reconcile |
| `comments/[cid]/route.ts` (PATCH, DELETE) | Sửa/xoá comment → như trên |
| `attachments/route.ts` (POST) | Upload file → như trên |
| `attachments/[aid]/route.ts` (DELETE) | Xoá file → như trên |

Hai hệ quả cộng dồn: (1) reconcile thành `"full"` nên kéo theo `/api/tasks/categories` dù comment không bao giờ đổi danh mục; (2) thiếu `sourceId` nên **chính tab vừa gõ comment cũng không tự bỏ qua được echo của mình**.

Trình duyệt **đã gửi sẵn** header `x-task-client-source` cho các request này (`mutationHeaders()` trong `CommentThread.tsx`) — chỉ có phía server là vứt đi. Fix nằm hoàn toàn ở server, không đụng client.

**Thứ tự ưu tiên nhóm hiệu năng theo số đo thật:**

```
P-01 (đã sửa)  >  P-02 (đã sửa)  >  P-03  >  HIGH-03  >  HIGH-05 ~ HIGH-08  >  HIGH-06 ~ HIGH-07
```

Report xếp HIGH-06 và HIGH-07 lên đầu nhóm hiệu năng; số đo cho thấy cả hai gần như không xuất hiện trong production. Ngược lại, ba khoản chiếm phần lớn invocations thì không được nhắc tới — hai trong ba đã được sửa ở `6f32194` trước khi report này ra đời, còn P-03 vẫn sống.

**Bối cảnh chi phí:** meter bị ảnh hưởng là Observability Plus ($1.20/triệu events, tự bật khi team nâng Pro từ 03/04/2026). Tại thời điểm đo: ~400K events/ngày ≈ $14-16/tháng, cộng Active CPU ~$3.20 → usage ~$18-19/tháng, sát trần tín dụng $20. P-01 + P-02 đã sửa; **cần đo lại một cửa sổ 12h mới** để biết mức thật sau khi sửa, trước khi quyết định có tắt Observability Plus hay không.

---

## Các điểm cần đo thêm trước khi tối ưu database

> [codex - Sol ] **Đồng ý với cách tách mục này.** Mọi thay đổi index phải dựa trên EXPLAIN ANALYZE ở query thực tế; không thêm index chỉ vì nhìn thấy ORDER BY trong source, vì index thừa cũng làm chậm mutation và tăng storage.

Đây là các nghi vấn hợp lý, chưa nên kết luận impact chỉ từ source:

1. **Index task list:** filter active + order `position, created_at, id` chưa thấy partial composite index khớp hoàn toàn. Cần `EXPLAIN ANALYZE` với production cardinality. Xem [schema.sql](/Users/vothuongbao/Project/Web/agent-portal/supabase/schema.sql:1586).
2. **Index comment pagination:** keyset order `(task_id, created_at, id)` cần kiểm tra query plan và index thực tế. Xem [schema.sql](/Users/vothuongbao/Project/Web/agent-portal/supabase/schema.sql:1962).
3. **Trigram search:** index hỗ trợ match nhưng vẫn có thể tốn khi vừa filter active vừa sort theo timestamp. Cần đo query plan.
4. **Assignee enrichment concurrency:** batching hiện nhanh với dữ liệu nhỏ nhưng có thể tạo quá nhiều query đồng thời khi board lớn.
5. **Hydration/date boundary:** `new Date()` trong client initial render có thể lệch ngày gần midnight/timezone. Lỗi `data-immersive-translate-page-theme` trước đó là do browser extension Immersive Translate chèn attribute vào `<html>`, không phải do app layout. Xem [layout.tsx](/Users/vothuongbao/Project/Web/agent-portal/src/app/layout.tsx:20).
6. **Emoji picker/preview/responsive drawer:** cần browser/E2E ở viewport thấp; static review chưa đủ để kết luận lỗi hiển thị.

## Những phần đã kiểm tra và đang ổn

> [codex - Sol ] **Lưu ý phạm vi:** “đang ổn” ở đây nghĩa là không phát hiện vấn đề trong static review + test hiện có, không phải chứng minh tuyệt đối. Đặc biệt cần giữ regression tests cho authorization khi refactor resolver chung.

- Các route chính task list/detail/comments/attachments/reactions/search/assignment đều reject unauthenticated request.
- Reaction access dùng task visibility boundary chung; reaction RPC kiểm tra ownership và idempotent write.
- Attachment access kiểm tra visibility trước khi đọc/upload và filter attachment đã xoá.
- Realtime broadcast không chứa nội dung task/comment; client refetch dữ liệu canonical có auth.
- Mutation task dùng `expected_updated_at` compare-and-swap để tránh ghi đè response cũ.
- Detail cache có request dedupe, TTL/max entries và stale-response protection.
- Comment pagination canonical dùng keyset-style cursor.
- Reaction mutation có queue/targeted update; realtime có debounce/coalescing và polling giảm khi tab hidden/realtime khỏe.
- Attachment signing cô lập lỗi từng file; display-name enrichment được batch.
- Task list truncation hiện fail-closed, không âm thầm hiển thị snapshot thiếu.
- `AttachmentPreviewDialog` đã có Escape, focus trap, restore focus và body scroll lock.

## Kiểm chứng tự động

- `npm run test:run`: **108 test files, 760 tests passed**.
- `npm run typecheck`: **passed**.
- `npm run lint`: **passed**.
- Một số log stderr trong test attachment là lỗi storage được cố tình mô phỏng; test vẫn pass và không phải production bug.
- Ba agent chỉ review, không sửa source và không tạo commit.

## Thứ tự nên xử lý

> [codex - Sol ] **Đề xuất chốt lại thứ tự:** Sprint 1 sửa HIGH-01, HIGH-02, MEDIUM-02, MEDIUM-03 và MEDIUM-04; Sprint 2 đo rồi xử lý task snapshot/detail scope/overview/reactions; Sprint 3 mới làm search RPC, metadata SQL và các tối ưu UI/accessibility. Cách này giảm rủi ro quyền trước, sau đó mới thay kiến trúc dữ liệu.

1. **Security/correctness:** fail-closed membership; sửa assignment permission; gom read visibility resolver; chốt backlog policy.
2. **Board scalability:** cursor pagination/virtualization cho `/api/tasks`; DB-side visibility bằng join/RPC.
3. **Detail/search/overview:** bỏ query auth thừa; reaction theo visible comments; search RPC; overview aggregate/cache.
4. **Reliability:** sửa legacy comments endpoint, stale optimistic retry, notification fallback.
5. **Cost/latency:** giảm full realtime refetch, cap notification IDs, bounded attachment concurrency, bỏ runtime bucket provisioning.
6. **Database tuning:** chạy `EXPLAIN ANALYZE`, thêm composite indexes chỉ sau khi có plan và số liệu production.
7. **UX/accessibility:** chuẩn hoá modal shell và E2E cho keyboard, hydration/date boundary, emoji picker và responsive drawer.
