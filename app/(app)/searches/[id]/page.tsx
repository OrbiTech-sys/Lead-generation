import type { Metadata } from "next";
import { SearchMonitor } from "@/components/views/search-monitor";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SearchMonitor id={id} />;
}
