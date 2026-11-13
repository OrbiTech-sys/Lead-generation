import type { Metadata } from "next";
import { LeadsView } from "@/components/views/leads-view";

export const metadata: Metadata = { title: "All Leads" };

export default function LeadsPage() {
  return <LeadsView />;
}
