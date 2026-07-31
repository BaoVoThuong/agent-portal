import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";

export async function broadcastTableConfigChanged(): Promise<void> {
  await Promise.all([broadcastEnrollmentChanged(), broadcastTasksChanged()]);
}
