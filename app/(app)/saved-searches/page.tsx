import type { Metadata } from "next";
import { SavedSearchesView } from "@/components/views/saved-searches-view";

export const metadata: Metadata = { title: "Saved Searches" };

export default function Page() {
  return <SavedSearchesView />;
}
