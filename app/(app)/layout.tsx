import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/shell";
import { requirePageAuth } from "@/lib/auth/guard";

// Every page behind this layout needs the signed-in user, so navigations legitimately wait on the session.
export const instant = false;

// The session is read at request time, so it lives behind a Suspense boundary (Cache Components).
// The static fallback below is what is prerendered.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted">Loading workspace…</div>}>
      <AuthShell>{children}</AuthShell>
    </Suspense>
  );
}

async function AuthShell({ children }: { children: ReactNode }) {
  const u = await requirePageAuth();
  return <Shell user={{ name: u.name, email: u.email, role: u.role, orgName: u.orgName }}>{children}</Shell>;
}
