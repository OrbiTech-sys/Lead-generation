import type { Metadata } from "next";
import { OutreachView } from "@/components/views/outreach-view";

export const metadata: Metadata = { title: "Outreach Tracker" };

export default function Page() {
  return <OutreachView />;
}
