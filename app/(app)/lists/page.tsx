import type { Metadata } from "next";
import { ListsView } from "@/components/views/lists-view";

export const metadata: Metadata = { title: "Lead Lists" };

export default function Page() {
  return <ListsView />;
}
