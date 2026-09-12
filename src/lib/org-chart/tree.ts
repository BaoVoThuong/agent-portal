/**
 * Sơ đồ tổ chức: dựng cây từ danh sách phẳng, và quyết định phép kéo thả nào
 * là hợp lệ.
 *
 * Thuần tuý, không chạm database — giao diện kéo thả và API đều gọi chung
 * những hàm này, nên hai bên không thể bất đồng về việc thế nào là hợp lệ.
 */

export type OrgPerson = {
  id: string;
  name: string | null;
  email: string;
  manager_id: string | null;
  is_active: boolean;
};

export type OrgNode<T extends OrgPerson = OrgPerson> = {
  person: T;
  reports: OrgNode<T>[];
  /** 0 cho người đứng đầu. Dùng để thụt lề khi vẽ. */
  depth: number;
};

function displayName(person: OrgPerson): string {
  return person.name?.trim() || person.email;
}

function byName(a: OrgNode, b: OrgNode): number {
  return displayName(a.person).localeCompare(displayName(b.person));
}

/**
 * Toàn bộ cấp dưới của một người, mọi tầng.
 *
 * Đây là hàm chặn vòng lặp: không ai được nhận một trong những người dưới
 * quyền mình làm manager. Tự bảo vệ trước dữ liệu đã có vòng — `seen` khiến
 * hàm luôn dừng, kể cả khi cây đang hỏng.
 */
export function descendantIds(people: readonly OrgPerson[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const person of people) {
    if (!person.manager_id) continue;
    childrenOf.set(person.manager_id, [
      ...(childrenOf.get(person.manager_id) ?? []),
      person.id,
    ]);
  }

  const seen = new Set<string>();
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return seen;
}

/**
 * Có được đặt `managerId` làm manager của `personId` không?
 *
 * Ba điều bị cấm: không có người đó, tự làm manager của chính mình, và nhận cấp
 * dưới của mình làm cấp trên (tạo thành vòng). `managerId = null` luôn hợp lệ —
 * đó là thao tác gỡ một người ra khỏi cây.
 */
export function canAssignManager(
  people: readonly OrgPerson[],
  personId: string,
  managerId: string | null
):
  | { ok: true }
  | {
      ok: false;
      reason: "self" | "cycle" | "unknown_person" | "inactive_manager";
    } {
  const byId = new Map(people.map((person) => [person.id, person]));
  if (!byId.has(personId)) return { ok: false, reason: "unknown_person" };
  if (managerId === null) return { ok: true };
  const manager = byId.get(managerId);
  if (!manager) return { ok: false, reason: "unknown_person" };
  if (!manager.is_active) return { ok: false, reason: "inactive_manager" };
  if (managerId === personId) return { ok: false, reason: "self" };
  if (descendantIds(people, personId).has(managerId)) {
    return { ok: false, reason: "cycle" };
  }
  return { ok: true };
}

export const ORG_ASSIGN_MESSAGE: Record<
  "self" | "cycle" | "unknown_person" | "inactive_manager",
  string
> = {
  self: "Một người không thể là quản lý của chính mình.",
  cycle:
    "Không thể đặt người này làm quản lý: họ đang nằm dưới quyền người kia, nên sơ đồ sẽ thành vòng lặp.",
  unknown_person: "Không tìm thấy tài khoản.",
  inactive_manager: "Không thể đặt một tài khoản đã ngưng hoạt động làm quản lý.",
};

function findCycleIds<T extends OrgPerson>(people: readonly T[]): Set<string> {
  const byId = new Map(people.map((person) => [person.id, person]));
  const visited = new Set<string>();
  const cycleIds = new Set<string>();

  for (const start of people) {
    if (visited.has(start.id)) continue;

    const path: string[] = [];
    const indexInPath = new Map<string, number>();
    let cursor: T | undefined = start;

    while (cursor && !visited.has(cursor.id)) {
      const cycleStart = indexInPath.get(cursor.id);
      if (cycleStart !== undefined) {
        for (const id of path.slice(cycleStart)) cycleIds.add(id);
        break;
      }

      indexInPath.set(cursor.id, path.length);
      path.push(cursor.id);
      cursor = cursor.manager_id ? byId.get(cursor.manager_id) : undefined;
    }

    for (const id of path) visited.add(id);
  }

  return cycleIds;
}

/**
 * Dựng rừng cây từ danh sách phẳng.
 *
 * Người đứng đầu = không có manager, HOẶC manager trỏ tới một tài khoản không
 * còn trong danh sách (đã nghỉ, đã lọc bỏ). Vế thứ hai là điều quan trọng: bỏ
 * qua nó thì những người đó biến mất hoàn toàn khỏi sơ đồ thay vì nổi lên
 * thành gốc — và không ai biết là họ đã mất.
 *
 * Nếu dữ liệu có vòng lặp (đáng lẽ trigger đã chặn), những người trong vòng
 * không thể là gốc của ai cả, nên sẽ không hiện ra. `orphanedByCycle` gọi tên
 * đúng những người đó để giao diện báo được, thay vì im lặng bỏ sót.
 */
export function buildOrgForest<T extends OrgPerson>(
  people: readonly T[]
): { roots: OrgNode<T>[]; orphanedByCycle: T[] } {
  const byId = new Map(people.map((person) => [person.id, person]));
  const childrenOf = new Map<string | null, T[]>();

  for (const person of people) {
    const parent =
      person.manager_id && byId.has(person.manager_id) ? person.manager_id : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), person]);
  }

  const placed = new Set<string>();
  const build = (person: T, depth: number): OrgNode<T> => {
    placed.add(person.id);
    const reports = (childrenOf.get(person.id) ?? [])
      // Chặn đệ quy vô tận nếu dữ liệu có vòng.
      .filter((child) => !placed.has(child.id))
      .map((child) => build(child, depth + 1))
      .sort(byName);
    return { person, reports, depth };
  };

  const roots = (childrenOf.get(null) ?? [])
    .map((person) => build(person, 0))
    .sort(byName);

  // Nếu data cũ đã có vòng, đừng làm mất luôn các cấp dưới của vòng đó. Nâng
  // nhánh hỏng lên thành một root tạm để admin còn nhìn thấy và sửa được.
  for (const person of [...people].sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
    if (!placed.has(person.id)) roots.push(build(person, 0));
  }
  const cycleIds = findCycleIds(people);

  return {
    roots: roots.sort(byName),
    orphanedByCycle: people.filter((person) => cycleIds.has(person.id)),
  };
}

/** Duyệt cây theo thứ tự hiển thị, phẳng hoá để render bằng một vòng lặp. */
export function flattenForest<T extends OrgPerson>(roots: OrgNode<T>[]): OrgNode<T>[] {
  const out: OrgNode<T>[] = [];
  const walk = (node: OrgNode<T>) => {
    out.push(node);
    for (const child of node.reports) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Tổng số người dưới quyền, mọi tầng. Dùng cho nhãn "quản lý N người". */
export function countReports<T extends OrgPerson>(node: OrgNode<T>): number {
  return node.reports.reduce((sum, child) => sum + 1 + countReports(child), 0);
}

/** Số người báo cáo trực tiếp, tách riêng với tổng mọi cấp. */
export function countDirectReports<T extends OrgPerson>(node: OrgNode<T>): number {
  return node.reports.length;
}
