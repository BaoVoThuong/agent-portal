# Health AI Chat — Bộ kiểm thử & đối chiếu số liệu

Mục tiêu: với mỗi chart/card trên dashboard Health, đối chiếu **3 nguồn** để biết
(1) dashboard có chuẩn không, (2) AI agent có hiểu nghiệp vụ không.

- **Dashboard**: số UI hiển thị + công thức (trích code).
- **SQL / Ground-truth**: SQL chạy trên Supabase (`health_mart`) — số "đúng" để so.
- **Agent**: câu hỏi tự nhiên → structured query agent sinh (gọi API thật) → số.

## Context cố định
- Phạm vi: **năm 2026** (report_month 2026-01 → 2026-12). Data thật chỉ có **2026-01, 02, 03**.
- Hầu hết câu = **company view** (toàn data). Số ground-truth dưới đây tao chạy thật,
  đã **validate khớp screenshot** (Jan 767/1385, Feb 837/1517, Mar 859/1567, Monthly
  Commission Mar = $29,255.10).
- Today (cho mốc tương đối) = 2026-06-21.

## Định nghĩa nghiệp vụ Health (khớp dashboard, đã xác minh trên data)
- **Eligible row**: có `report_month`, `primary_member_id`, `broker_effective_date`,
  và `effective_month <= report_month`; dedup theo `(report_month, member)` chọn
  effective mới nhất.
- **policy** = `primary_member_id` **UNIQUE xuyên kỳ** (member báo nhiều tháng = 1 policy).
- **client** = `Σ` của `max(num_client)` mỗi member (KHÔNG cộng dồn từng tháng).
- **paid** = `paid_to_date` có giá trị.
- **commission**: agent = `agent_received`; eps = `messer_paid − agent_received`;
  override = `eps_override_received`; split = `eps_split`.
- **rate** = commission / `carriers_messer_paid` × 100.

---

## SQL nền (eligible CTE) — dùng cho mọi câu
Chạy trong Supabase SQL editor. Đổi khoảng tháng ở `where` nếu cần.

```sql
with eligible as (
  select distinct on (to_char(report_month,'YYYY-MM'), upper(trim(primary_member_id)))
         *
  from health_mart
  where report_month >= '2026-01-01' and report_month <= '2026-12-31'
    and report_month is not null
    and broker_effective_date is not null
    and nullif(trim(primary_member_id),'') is not null
    and to_char(broker_effective_date,'YYYY-MM') <= to_char(report_month,'YYYY-MM')
  order by to_char(report_month,'YYYY-MM'), upper(trim(primary_member_id)),
           broker_effective_date desc, carriers_messer_paid desc nulls last
),
per_member as (   -- gộp member unique xuyên kỳ + max client
  select primary_member_id,
         max(num_client) as clients,
         bool_or(paid_to_date is not null) as paid
  from eligible group by primary_member_id
)
select 1;  -- thay bằng truy vấn từng metric bên dưới
```

---

# KẾT QUẢ TỪNG METRIC

> Ký hiệu verdict: ✅ khớp · ❌ lệch · ⚠️ đúng kỹ thuật nhưng lệch kỳ vọng UX.

### 1. Agent Commission (Portfolio Overview)
- **Dashboard**: `Σ agent_received` trên eligible. (HealthSalesDashboard `summarizeRows`)
- **SQL**: `select sum(agent_received) from eligible;`
- **Ground-truth**: **$74,504.43**
- **Agent hỏi**: "Total agent commission this year"
  - structured: `{metric: sum_agent_commission, monthStart:2026-01, monthEnd:2026-12}`
  - Agent trả: **74,504.43** → **✅**

### 2. EPS Commission
- **Dashboard**: `Σ (carriers_messer_paid − agent_received)`.
- **SQL**: `select sum(coalesce(carriers_messer_paid,0)-coalesce(agent_received,0)) from eligible;`
- **Ground-truth**: **$27,430.72**
- **Agent**: "EPS commission this year" → `sum_eps_commission` → **27,430.72** → **✅**

### 3. EPS Split
- **Dashboard**: `Σ eps_split`. · **SQL**: `select sum(eps_split) from eligible;`
- **Ground-truth**: **$24,508.83**
- **Agent**: "EPS split this year" → `sum_eps_split` → **24,508.83** → **✅**

### 4. EPS Override
- **Dashboard**: `Σ eps_override_received`. · **SQL**: `select sum(eps_override_received) from eligible;`
- **Ground-truth**: **$2,921.65**
- **Agent**: "EPS override this year" → `sum_eps_override` → **2,921.65** → **✅**

### 5. Agent Comm Rate
- **Dashboard**: `Σ agent_received / Σ carriers_messer_paid × 100`.
- **SQL**: `select sum(agent_received)/nullif(sum(carriers_messer_paid),0)*100 from eligible;`
- **Ground-truth**: **73.09%**
- **Agent**: "agent commission rate this year" → `agent_commission_rate` → **73.09** → **✅**

### 6. EPS Comm Rate
- **Dashboard**: `eps_commission / Σ messer_paid × 100`.
- **Ground-truth**: **26.91%**
- **Agent**: "EPS commission rate this year" → `eps_commission_rate` → **26.91** → **✅**

### 7. Policies (unique member)
- **Dashboard**: số `primary_member_id` unique xuyên kỳ.
- **SQL**: `select count(distinct primary_member_id) from eligible;`
- **Ground-truth**: **859**
- **Agent**: "How many policies this year?" → `policy_count` → **859** → **✅**

### 8. Clients (Σ max num_client)
- **Dashboard**: `Σ max(num_client)` mỗi member.
- **SQL**: `select sum(clients) from per_member;`
- **Ground-truth**: **1,570**
- **Agent**: "How many clients do we have this year?" → `client_count` → **1,570** → **✅**

### 9. Agent Performance (theo agent)
- **Dashboard**: group theo `agent`, mỗi agent `Σ agent_received`.
- **SQL**: `select agent, sum(agent_received) from eligible group by agent order by 2 desc;`
- **Ground-truth (top)**: KHANG NGUYEN 32,290.02 · ANN STRAMBLER 22,397.94 · TRISH NGUYEN 9,600.24 · THUY MAI 4,552.80 · LINH LE 2,150.44
- **Agent**: "Agent commission by agent this year" → `sum_agent_commission groupBy agent`
  - groups khớp đúng thứ tự & số trên → **✅**

### 10. Carrier Performance (theo carrier)
- **Dashboard**: group theo `carrier`.
- **SQL**: `select carrier, count(distinct primary_member_id), sum(num_client_max...) group by carrier;`
- **Ground-truth (clients top)**: CHC 439 · OSCAR 408 · AMBETTER 290 · UHC 162 · BCBS 121 · ANTHEM 51 · CHRISTUS 49 · IMPERIAL 12
- **Agent**: "How many clients by carrier this year?" → `client_count groupBy carrier`
  - groups khớp đúng → **✅**

### 11. State Distribution (theo state)
- **Dashboard**: group theo `state`.
- **Ground-truth (policy top)**: TX 705 · FL 75 · AZ 10 · MI 9 · MS 8 · AR 6 · AL 6 · NC 6
- **Agent**: "How many policies by state this year?" → `policy_count groupBy state`
  - groups khớp đúng → **✅**
  - *Lưu ý: cột `state` có cả giá trị phi-địa-lý như "TERMINATED" trong data thô;
    eligible-filter loại bớt nên không lọt vào top.*

### 12. Policy Paid Rate
- **Dashboard**: `paid_policy / policy × 100`.
- **SQL**: `select 100.0*sum(case when paid then 1 else 0 end)/count(*) from per_member;`
- **Ground-truth**: **93.36%** (802/859)
- **Agent**: "policy paid rate this year" → `policy_paid_rate` → **93.36** → **✅**

---

# CÁC CÂU LỖI / CẦN CHÚ Ý

### 13. Active Clients "this month" ⚠️ LỆCH
- **Dashboard card "ACTIVE CLIENTS"** = client của **report month mới nhất CÓ DATA** (Mar 2026) = **1,567**.
- **Agent**: "How many active clients this month?"
  - structured: `{client_count, monthStart:2026-06, monthEnd:2026-06}` (today=June)
  - Agent trả: **0** (vì tháng 6 chưa có data)
- **Verdict**: ⚠️ Agent hiểu "this month" = tháng hiện tại theo lịch (đúng nghĩa đen),
  nhưng dashboard "Active" = **tháng report gần nhất có data**. → cần dạy prompt:
  "active / latest" = tháng mới nhất có dữ liệu, không phải tháng lịch khi tháng đó rỗng.

### 14. "How many policies does KHANG NGUYEN have" ❌ SAI
- **Ground-truth**: KHANG NGUYEN là **AGENT** → 344 policies (xem mục 9, agent filter).
- **Agent**: structured: `{policy_count, memberName:"KHANG NGUYEN"}`
  - Agent trả: **0**
- **2 nguyên nhân**:
  1. Agent gán nhầm tên người vào `memberName` thay vì `agent` (KHANG là agent, không phải khách).
  2. **Bug builder**: `memberName` đang `ilike` trên `primary_member_id` (cột này là **mã số**
     như "944101131", không phải tên) → tên người **không bao giờ** khớp. Tên khách thật
     nằm ở cột `deal_name`.
- **Verdict**: ❌ — cần (a) prompt phân biệt agent-name vs customer-name; (b) builder cho
  `memberName` khớp `deal_name` (tên khách) chứ không chỉ `primary_member_id`.

### 15. "How many cars did I sell" ✅ (từ chối đúng)
- Agent: `{unsupported:true}` → trả lời từ chối lịch sự. **✅** (đúng — Health không có "cars").

---

# TỔNG KẾT
- **Dashboard**: tất cả số ground-truth khớp screenshot → **dashboard chuẩn**.
- **Agent**: **13/15 đúng** (gồm groupBy carrier/agent/state, rate, commission, từ chối lạc đề).
- **2 vấn đề cần sửa**:
  - #13 "active/this month" khi tháng hiện tại rỗng → nên trỏ tháng mới nhất có data.
  - #14 `memberName` khớp sai cột (phải là `deal_name`) + lẫn agent-name vs customer-name.
