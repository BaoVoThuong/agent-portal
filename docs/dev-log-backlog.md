# Agent Portal Dev Log Backlog

Danh sách này được đối chiếu với `origin/main` và chỉ chứa các commit chưa xuất hiện trong bất kỳ ngày nào ở [`docs/dev-log.md`](./dev-log.md).

## Cách dùng

- Khi chọn commit để viết báo cáo, đọc diff và gom các commit cùng mục tiêu thành một task.
- Thêm task vào đầu ngày báo cáo trong `docs/dev-log.md`.
- **Bắt buộc:** commit nào đã được dùng trong report thì xoá khỏi bảng `Implementation backlog` ngay trong cùng lượt sửa; backlog tuyệt đối không giữ lại commit đã report.
- Không dùng ngày commit làm ngày report. Ngày report là ngày quản lý muốn ghi nhận công việc.
- Commit chỉ tạo tài liệu/kế hoạch không cần report như một tính năng riêng; chúng được giữ ở mục cuối để tra cứu.

Trước khi hoàn tất một lượt report, kiểm tra nhanh:

```sh
rg -o '[0-9a-f]{7,40}' docs/dev-log.md | sort -u
rg -o '[0-9a-f]{7,40}' docs/dev-log-backlog.md | sort -u
```

Hai danh sách không được có cùng hash implementation.

## Implementation backlog

| Commit | Nội dung nên gom khi report | Ngày report |
| --- | --- | --- |
| `9bb5069` | Giữ nền cột Kanban ổn định trên toàn bộ lane | Chưa gán |
| `f524688`, `ffb8c2b`, `03ec9bd` | Hoàn thiện trải nghiệm board: rút ngắn notification chime, giữ không gian cho Comments, chuẩn hóa UI text | Chưa gán |
| `c6d3955` | Bổ sung staging cho Sheet Data Sync và sửa finalize dữ liệu | Chưa gán |
| `bc27874` | Sửa role dropdown trong Account Management khi mở modal | Chưa gán |
| `308be82` | Live-sync Task Board/List và toàn bộ Task Detail | Chưa gán |
| `3593e51` | Đồng bộ UI Task Detail giữa Enrollment và CS | Chưa gán |
| `fb9d03b` | Đồng bộ live-sync Enrollment theo cơ chế CS | Chưa gán |
| `b004ac9` | Đóng các finding review về quyền truy cập, assign, dữ liệu xoá và dedupe scope lookup | Chưa gán |
| `26430c8` | Đồng bộ flow loading Enrollment và CS: parallel initial load, single-flight refetch, tránh request chồng nhau | Chưa gán |
| `a1418b7` | Tối ưu comment/attachment cho CS và Enrollment: phản hồi gửi sớm, side effect chạy nền, batch signing và sửa realtime reaction giữa nhiều account | Chưa gán |

## Documentation-only commits

Các commit này chưa được dùng trong report, nhưng không cần tạo task riêng nếu chỉ thay đổi tài liệu:

| Commit | Nội dung | Trạng thái |
| --- | --- | --- |
| `1918032` | Implementation plans cho Task Attachments, Enrollment Attachments và Enrollment Drawer | Không report riêng |
| `b5f027e` | Hướng dẫn viết daily dev log | Không report riêng |
| `e87f3e7` | Kế hoạch review live-sync | Không report riêng |
| `0a43daa` | Quy trình daily dev log | Không report riêng |
| `64659bb` | Commit ghi báo cáo polling cost optimizations | Không report riêng |

## Nguồn đối chiếu

- Remote được đối chiếu: `origin/main`
- Snapshot hiện tại: `a1418b7`
- Khoảng commit rà soát: từ `18/08/2026` đến snapshot hiện tại

## Raw commit ledger — 22/08–03/09/2026

> Snapshot đầy đủ của `main` theo ngày author ở múi giờ `Asia/Ho_Chi_Minh`.
> Đây chỉ là danh sách tham chiếu để chọn commit cho từng daily report sau này; **chưa** phân bổ hay viết báo cáo theo ngày.

| Date | Commit | Subject |
| --- | --- | --- |
| 2026-08-22 | `fcdb658` | feat(enrollment): align detail collaboration with CS |
| 2026-08-22 | `faf7160` | fix(tasks): allow backlog team collaboration |
| 2026-08-22 | `268f90e` | perf(tasks): merge comment reactions into detail load |
| 2026-08-22 | `0a43daa` | docs: add daily dev log workflow |
| 2026-08-22 | `6f32194` | perf: reduce notification and task polling cost |
| 2026-08-22 | `64659bb` | docs: report polling cost optimizations |
| 2026-08-23 | `3593e51` | feat: align enrollment and task detail UI |
| 2026-08-23 | `fb9d03b` | fix: align enrollment live sync with tasks |
| 2026-08-23 | `6b63f9f` | feat: notify comment authors about reactions |
| 2026-08-23 | `cabe4d9` | fix: preserve enrollment creator visibility |
| 2026-08-23 | `6ec65a3` | fix: let task creators see their own tasks |
| 2026-08-23 | `eaba029` | docs: report creator visibility and reaction notifications |
| 2026-08-23 | `e35369d` | fix: hide enrollment overview from non-managers |
| 2026-08-23 | `4fdd78a` | docs: report enrollment overview visibility fix |
| 2026-08-23 | `1f36069` | fix: keep enrollment creation on the list |
| 2026-08-23 | `bfa6f05` | docs: report enrollment create flow fix |
| 2026-08-23 | `8796298` | feat: split display keys by workstream |
| 2026-08-23 | `4099d6f` | docs: report display key split |
| 2026-08-23 | `9b584ba` | fix: soften due date typography |
| 2026-08-23 | `b1228dc` | docs: report due date typography fix |
| 2026-08-23 | `1c5c487` | fix: clarify date format labels |
| 2026-08-23 | `b5fe5ee` | docs: report date format wording fix |
| 2026-08-23 | `d450e48` | feat: align enrollment overview with cs dashboard |
| 2026-08-23 | `3952acd` | docs: report enrollment overview alignment |
| 2026-08-23 | `961bcdc` | fix(enrollment): compact overview dashboard layout |
| 2026-08-23 | `8c2fd4a` | docs(dev-log): report compact enrollment overview |
| 2026-08-23 | `dc8ced2` | feat(enrollment): add Medicare overview dashboard |
| 2026-08-23 | `03caeac` | docs(dev-log): report Medicare overview dashboard |
| 2026-08-23 | `b004ac9` | fix(tasks): close review findings and dedupe scope lookups |
| 2026-08-23 | `26430c8` | perf: align enrollment and task loading flow |
| 2026-08-24 | `a1418b7` | perf(comments): optimize realtime collaboration flow |
| 2026-08-24 | `2774bf7` | docs(dev-log): track comment collaboration work |
| 2026-08-26 | `41eda21` | fix(enrollment): drop the deleted_at filter attachments never had |
| 2026-08-26 | `7baa696` | fix(tasks): stop dropping a peer's second realtime update |
| 2026-08-26 | `2611d39` | chore(tasks): remove orphaned comment helper and hoist source id |
| 2026-08-26 | `0b46082` | fix(enrollment): stop assigning the creator as Caller |
| 2026-08-27 | `ccffe1c` | docs(leads): add the lead management implementation plan |
| 2026-08-27 | `3c23eac` | docs(leads): add a resumable progress log |
| 2026-08-27 | `a3df404` | docs(leads): fix step order and pin the nav file in the plan |
| 2026-08-27 | `c635655` | feat(leads): add lead management schema |
| 2026-08-27 | `7bae0a8` | docs(leads): pin schema.sql insert point and fix the verify recipe |
| 2026-08-28 | `c001444` | docs(leads): mark Task 1 complete |
| 2026-08-28 | `4997217` | feat(leads): add shared lead types |
| 2026-08-28 | `5cdf114` | docs(leads): mark Task 2 complete |
| 2026-08-28 | `c7ba4bd` | feat(leads): add the lead alert engine |
| 2026-08-28 | `1985c68` | test(leads): cover archived, multi-alert, and lost-status guards |
| 2026-08-28 | `744bf3a` | docs(leads): mark Task 3 complete, stop after Phase 1 partial |
| 2026-08-28 | `f6c680e` | feat(leads): add the atomic interaction log RPC |
| 2026-08-28 | `af787c2` | feat(leads): add lead permissions and access rules |
| 2026-08-28 | `a30eafc` | feat(leads): add lead table-config scopes |
| 2026-08-28 | `fceb8c0` | feat(leads): add paginated lead queries |
| 2026-08-28 | `f6cdbd7` | feat(leads): add lead list and interaction routes |
| 2026-08-28 | `03c5dcf` | feat(leads): add the leads table and interaction log |
| 2026-08-28 | `2f72199` | feat(leads): add the lead import parser |
| 2026-08-28 | `9a47ba1` | feat(leads): add lead import and event routes |
| 2026-08-28 | `41ef6db` | feat(leads): add the lead import dialog |
| 2026-08-28 | `3705f0e` | feat(leads): add bulk lead assignment |
| 2026-08-28 | `839ab11` | feat(leads): add the lead overview summary |
| 2026-08-28 | `d2c6dba` | feat(leads): add the manager overview screen |
| 2026-08-28 | `c070839` | feat(leads): add navigation, alert settings, and changelog |
| 2026-08-28 | `cd7e7d0` | feat(leads): let admins configure statuses and interaction types |
| 2026-08-28 | `010cff3` | fix(leads): harden schema, alert filters, and validation |
| 2026-08-28 | `4abdb12` | docs(leads): finalize implementation progress |
| 2026-08-28 | `f4d0ed8` | fix(leads): clear stale callback flags, bound the overview, drop an alias trap |
| 2026-08-28 | `92ef81b` | fix(leads): widen the table-config scope constraint to the lead scopes |
| 2026-08-28 | `d9cdc70` | style(leads): align UI with task board |
| 2026-08-28 | `7ed54fb` | feat(leads): add single lead creation |
| 2026-08-28 | `91f8222` | style(leads): remove refresh button |
| 2026-08-28 | `8f8d10a` | fix(leads): make overview tab switch immediate |
| 2026-08-31 | `10e8f1b` | feat(leads): pick the agent from a roster instead of typing an address |
| 2026-08-31 | `51ca0d7` | fix(leads): key imported custom values the way Config Table keys columns |
| 2026-08-31 | `6ca7a09` | feat(leads): give leads their own table configuration screen |
| 2026-08-31 | `22831fa` | feat(leads): add Secondary Phone and make "In detail" mean something |
| 2026-08-31 | `8bbdf5d` | fix(leads): pick the agent from a list, and call Event what it is |
| 2026-08-31 | `a033140` | feat(leads): type the event name, and start every lead at New |
| 2026-08-31 | `9648085` | chore(leads): add sample data covering every alert state |
| 2026-08-31 | `133446c` | fix(leads): make the lead UI read as the same product as the task board |
| 2026-08-31 | `10a7990` | fix(leads): a locked interaction composer now says why |
| 2026-08-31 | `8053499` | fix(config): let the lead scopes past the table-config write RPCs |
| 2026-08-31 | `6676900` | fix(leads): give each interaction type its own coloured badge |
| 2026-08-31 | `6ab6728` | feat(leads): one Event Leads list with Product as a column |
| 2026-08-31 | `fe9a56d` | fix(leads): an empty product filter means all products, not P&C |
| 2026-08-31 | `4abe5ea` | chore(leads): collapse nine lead rollouts into one final state |
| 2026-09-01 | `6ce46b2` | feat(leads): search, filters and sortable column headers |
| 2026-09-01 | `69a9912` | feat(leads): mọi dropdown value về Lead Table Config → Values |
| 2026-09-01 | `b5c20a8` | fix(leads): modal chi tiết hiện đủ thông tin của lead |
| 2026-09-01 | `ee9b927` | refactor(leads): gộp hai bộ status thành một |
| 2026-09-01 | `bd4139f` | fix(sidebar): mục cha không nuốt link khi đang ở route con |
| 2026-09-01 | `fe5f0e5` | feat(leads): sửa giá trị ngay trên bảng + RBAC theo assistant membership |
| 2026-09-01 | `6af7cf9` | docs(leads): plan RBAC — ai thấy gì, ai sửa gì |
| 2026-09-01 | `8ae54e3` | fix(leads): admin nhận được lead + gộp luật năng lực về một nơi |
| 2026-09-01 | `4e9581c` | chore(leads): xoá lead.export, cho manager ghi tương tác |
| 2026-09-01 | `44a01eb` | docs(leads): audit module — 7 lỗi, 6 điểm chưa tối ưu, plan sửa |
| 2026-09-01 | `55a1b88` | fix(leads): đợt 1 theo audit — P0 (C1-C4, B2) + B1/B3/B4 |
| 2026-09-01 | `bce2b24` | fix(leads): đợt 2 theo audit — B5, B6, C10 |
| 2026-09-01 | `6cf173c` | feat(leads): cảnh báo lên bảng và chip lọc (O1 + O2) |
| 2026-09-01 | `ea0a246` | feat(leads): một bộ lọc Lead health phủ 100% danh sách |
| 2026-09-01 | `f0e5fc4` | fix(leads): healthFilterOptions dùng healthCounts trước khi nó tồn tại |
| 2026-09-01 | `5293165` | fix(leads): sự kiện, tải dữ liệu, và cơ chế refresh |
| 2026-09-01 | `81299a7` | feat(leads): modal chi tiết sửa tại chỗ + Details cho cột Imported |
| 2026-09-01 | `2a69842` | feat(leads): smooth weighted round-robin cho việc chia lead |
| 2026-09-01 | `eb0c190` | feat(leads): bảng trọng số + RPC chia lead theo tỉ lệ |
| 2026-09-01 | `1ecdebc` | feat(leads): tự chia lead theo tỉ lệ, xen kẽ, tách theo product |
| 2026-09-01 | `d43d65c` | feat(leads): UI đặt tỉ lệ ngay trong dialog Chia pool |
| 2026-09-01 | `0a959d4` | fix(leads): xoá được agent khỏi danh sách chia pool |
| 2026-09-01 | `6da1851` | fix(leads): danh sách Chia pool là nguồn duy nhất quyết ai nhận lead |
| 2026-09-01 | `e74f93b` | fix(leads): danh sách agent trong Chia pool lúc hiện lúc không |
| 2026-09-01 | `194d952` | refactor(leads): một bản fetch tỉ lệ dùng chung cho effect và nút Lưu |
| 2026-09-01 | `eea70d0` | fix(leads): nói lại phần tạm dừng/xoá agent cho dễ hiểu |
| 2026-09-01 | `ec91faf` | fix(leads): modal Chia pool sang tiếng Anh, kích thước cố định |
| 2026-09-01 | `6b9c149` | fix(leads): bỏ hai đoạn giải thích thừa trong modal Chia pool |
| 2026-09-01 | `d43a328` | feat(leads): modal Chia pool to hơn, bảng đẹp hơn, hiện thứ tự nhận |
| 2026-09-01 | `3a95c60` | fix(leads): ô Add agent dùng picker chung, chọn là thêm |
| 2026-09-01 | `e9f4d80` | feat(leads): Chia pool ba tab, tách ai khỏi bao nhiêu |
| 2026-09-01 | `05bfb6b` | fix(leads): Agent config đọc task_agents, không phải agent_members |
| 2026-09-01 | `8c867aa` | feat(leads): dãy round-robin cập nhật theo tỉ lệ đang gõ |
| 2026-09-01 | `dc97df7` | fix(ui): mở modal thì trang nền không cuộn theo nữa, toàn app |
| 2026-09-01 | `fa1014d` | fix(leads): Chia pool — dọn lại mô hình, một điều khiển một ý nghĩa |
| 2026-09-01 | `50dcfba` | fix(leads): danh sách agent trong Agent config cuộn được trở lại |
| 2026-09-01 | `2335dd0` | perf(leads): Chia pool phản hồi tức thì, đổi tab không chờ, có cache |
| 2026-09-01 | `0066e90` | feat(leads): một lead có thể thuộc nhiều product |
| 2026-09-01 | `98d127c` | fix(leads): ô Product chọn nhiều theo kiểu gán nhiều worker cho task |
| 2026-09-01 | `4ad6a80` | fix(leads): ô Product trở lại dáng dropdown, chọn được cả hai |
| 2026-09-01 | `633f029` | fix(leads): ô Product khớp cột Status, nới đủ rộng cho hai badge |
| 2026-09-01 | `ce89567` | fix(leads): nới cột Status cho vừa "Not interested" |
| 2026-09-01 | `7e86bd3` | perf(leads): vá theo id thay vì tải lại cả danh sách |
| 2026-09-01 | `229cd4d` | fix(tasks): xoá comment rỗng khi không tệp nào upload được |
| 2026-09-01 | `760d09a` | fix(leads): pool chia lead đọc theo products thay vì cột scalar |
| 2026-09-01 | `c85276b` | feat(tasks): Due Date gọn ở List, hiện trên card Board, chỉ agent/assistant/admin sửa |
| 2026-09-02 | `7afe5e2` | feat(tasks): bấm header cột custom để sắp xếp, gồm Due Date |
| 2026-09-02 | `fe287f8` | fix(build): commit hai file mà LeadsClient đang import |
| 2026-09-02 | `b84d234` | fix(leads): badge Interactions và danh sách đọc chung một nguồn |
| 2026-09-02 | `7c227ff` | chore: plan cuối cho đợt sửa lead + cổng kiểm import |
| 2026-09-02 | `780983d` | fix(leads): gán lead và ghi lịch sử trong cùng một giao dịch |
| 2026-09-02 | `50078b6` | fix(leads): PATCH dùng compare-and-swap trên updated_at |
| 2026-09-02 | `72923aa` | fix(leads): idempotency có index, chặn trùng số khi lead không có event |
| 2026-09-02 | `6322944` | fix(leads): status đã archive tra được ở list, Overview và drawer |
| 2026-09-02 | `75b0e6e` | fix(leads): một bộ luật trường cho Create, PATCH và Import |
| 2026-09-02 | `4d8c7ed` | fix(leads): tài khoản tắt rời pool, cờ auto-assign đúng product |
| 2026-09-02 | `a4ab647` | fix(leads): vá theo id giữ lịch sử mới, gán xong không reload cả danh sách |
| 2026-09-02 | `61cabc0` | fix(leads): lead nhiều product dùng ngưỡng cảnh báo chặt nhất |
| 2026-09-02 | `0c93f99` | fix(leads): lưu cấu hình chia pool trong một giao dịch |
| 2026-09-02 | `7fb87b8` | feat(tasks): overdue theo Due Date — thông báo, nền hồng, activity |
| 2026-09-02 | `06ca5e0` | feat(attachments): xoay ảnh trong khung xem trước |
| 2026-09-02 | `836efd6` | fix(comments): ảnh trong comment dùng chung khung xem trước |
| 2026-09-02 | `6f16537` | fix(attachments): xoay ảnh giữ nguyên kích thước |
| 2026-09-02 | `3278ddf` | feat(comments): dán ảnh thẳng vào ô soạn bằng Ctrl+V |
| 2026-09-02 | `a54312b` | fix(leads): nút "Chia pool" đổi thành "Distribute pool" |
| 2026-09-02 | `da93e0b` | feat(time-off): nghỉ phép — WIP từ phiên song song |
| 2026-09-02 | `49cb8ba` | feat(leads): bảng map cột khi import, Sonnet 5 gợi ý |
| 2026-09-02 | `1a22b1e` | feat(leads): ghép nhiều cột vào một trường, bảng xem trước hiện đúng giá trị |
| 2026-09-02 | `d7011a8` | fix(leads): dọn UI bước chọn file khi import, Event thành tuỳ chọn |
| 2026-09-02 | `159a7bc` | fix(leads): import trả 400 sau khi mapping đổi sang mảng |
| 2026-09-02 | `bfc8bd8` | feat(leads): import xong thì báo toast và tự đóng modal |
| 2026-09-02 | `c15686f` | fix(leads): Import và Add lead dùng chung một bộ mặc định |
| 2026-09-02 | `d064442` | fix(leads): sửa tỉ lệ xong vẫn bấm Distribute được |
| 2026-09-02 | `97928c6` | perf(leads): đổi tab List/Overview không nạp lại cả trang |
| 2026-09-02 | `caf1ef9` | fix(leads): lead hai product hiện hai badge xếp dọc |
| 2026-09-02 | `583da3e` | feat(leads): đổi sang status cần ngày hẹn thì hỏi ngày ngay |
| 2026-09-02 | `655c3be` | fix(leads): mở lead không còn chớp qua 'No interactions yet' |
| 2026-09-02 | `dc43386` | docs: plan gộp Leads vào Tasks, đã qua peer review |
| 2026-09-03 | `17d650b` | feat(time-off): separate admin workspace and harden calendar |
| 2026-09-03 | `8e29e74` | Merge branch 'time-off' |
| 2026-09-03 | `96ca720` | feat(config): quyền sửa cấu hình theo từng scope |
| 2026-09-03 | `578b5a8` | refactor(leads): chuyển Event Leads sang /tasks/leads |
| 2026-09-03 | `a87a210` | refactor(config): gộp cấu hình bảng lead vào /config, quyền vẫn tách |
| 2026-09-03 | `8e1f862` | fix(config): mở API cấu hình cho scope lead, giữ nguyên cổng Health |
| 2026-09-03 | `fe24ac5` | refactor(nav): gộp nhóm Lead Management vào Task Management |
| 2026-09-03 | `e5a6753` | merge: gộp Event Leads vào Task Management |
| 2026-09-03 | `a223177` | refactor(time-off): move calendar into overview |
| 2026-09-03 | `0f655d4` | feat(time-off): add company days off from overview |
| 2026-09-03 | `c6b69da` | feat(time-off): restore company day action in admin |
| 2026-09-03 | `67aa247` | feat(time-off): filter leave history by employee |
| 2026-09-03 | `3722c78` | refactor(time-off): combine approvals with leave history |
| 2026-09-03 | `1f71908` | fix(time-off): surface approval errors in modal |
| 2026-09-03 | `5361d6b` | fix(time-off): qualify approval balance query |
| 2026-09-03 | `7a1a396` | fix(time-off): preserve administration tab after approval |
| 2026-09-03 | `39a12db` | fix(time-off): show feedback as fixed toast |
| 2026-09-03 | `cd59547` | fix(time-off): show leave history across all years |
| 2026-09-03 | `c6e9a77` | feat(time-off): show recent requests in overview |
| 2026-09-03 | `5fc324a` | refactor(time-off): consolidate personal requests in overview |
| 2026-09-03 | `26e4d88` | feat(time-off): preview leave balance before request |
| 2026-09-03 | `b4b3bc7` | fix(time-off): make overview calendar personal |
| 2026-09-03 | `4d4b668` | feat(time-off): add dedicated approvals admin tab |
| 2026-09-03 | `fdad9a0` | fix(time-off): expose personal request cancellation |
| 2026-09-03 | `e0cc7f0` | fix(time-off): show all pending admin requests |
| 2026-09-03 | `eae72d9` | feat(time-off): tích luỹ ngày phép hằng tháng + điều chỉnh cả nhóm |
| 2026-09-03 | `a6597ad` | fix(time-off): rà soát logic đầu-cuối — độ bền, luật nghiệp vụ, test |
| 2026-09-03 | `8062857` | refactor(time-off): bỏ tiêu đề Leave administration |
| 2026-09-03 | `98ba9ed` | refactor(time-off): gộp tab quản trị vào một hàng, gọn lại thẻ số dư |
| 2026-09-03 | `363086e` | refactor(time-off): danh sách quản trị lấp một khung màn hình + tìm theo tên agent |
| 2026-09-03 | `c4f830c` | fix(tasks,time-off): cột ghim theo nền quá hạn; leave log dùng ô tìm tên |
| 2026-09-03 | `da1f745` | fix(time-off): capitalize page title |
