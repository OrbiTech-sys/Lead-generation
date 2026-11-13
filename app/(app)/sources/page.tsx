import type { Metadata } from "next";
import { SourcesView } from "@/components/views/sources-view";

export const metadata: Metadata = { title: "Data Sources" };

export default function Page() {
  return <SourcesView />;
}
