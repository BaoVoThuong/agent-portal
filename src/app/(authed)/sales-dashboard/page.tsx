import { redirect } from "next/navigation";

export default function SalesDashboardPage() {
  redirect("/dashboard/health?view=sales");
}
