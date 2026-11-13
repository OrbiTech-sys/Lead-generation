import type { Metadata } from "next";
import { MapExplorer } from "@/components/views/map-view";

export const metadata: Metadata = { title: "Map Explorer" };

export default function Page() {
  return <MapExplorer />;
}
