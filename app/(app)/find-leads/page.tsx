import type { Metadata } from "next";
import { FindLeadsWizard } from "@/components/find/wizard";

export const metadata: Metadata = { title: "Find Leads" };

export default function FindLeadsPage() {
  return <FindLeadsWizard />;
}
