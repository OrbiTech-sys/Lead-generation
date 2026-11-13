import type { Metadata } from "next";
import { VerificationView } from "@/components/views/verification-view";

export const metadata: Metadata = { title: "Verification Center" };

export default function Page() {
  return <VerificationView />;
}
