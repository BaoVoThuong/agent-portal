"use client";

import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { AcaOverviewDashboard } from "./AcaOverviewDashboard";

type OverviewProps = {
  program: EnrollmentProgram;
  from: string;
  to: string;
  isManager: boolean;
  onOpenRecord: (id: string) => void;
};

export function EnrollmentOverview({ program, from, to, isManager, onOpenRecord }: OverviewProps) {
  // Overview is manager-only, matching the CS board. Keep the guard here as
  // well as in the parent toolbar/API so a direct render fails closed.
  if (!isManager) return null;
  return <AcaOverviewDashboard program={program} from={from} to={to} onOpenRecord={onOpenRecord} />;
}
