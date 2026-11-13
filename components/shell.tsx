"use client";
import {
  BarChart3, Compass, Database, FolderKanban, LayoutDashboard, ListChecks, LogOut, Map as MapIcon, Menu, Moon, PhoneCall, Plug, Search, Settings, ShieldCheck, Sun, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { call } from "./hooks";
import { cx } from "./ui";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Search }[] }[] = [
  {
    group: "Discover",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/find-leads", label: "Find Leads", icon: Search },
      { href: "/leads", label: "All Leads", icon: ListChecks },
      { href: "/lists", label: "Lead Lists", icon: FolderKanban },
      { href: "/saved-searches", label: "Saved Searches", icon: Compass },
      { href: "/map", label: "Map Explorer", icon: MapIcon },
    ],
  },
  {
    group: "Quality",
    items: [
      { href: "/sources", label: "Data Sources", icon: Database },
      { href: "/verification", label: "Verification Center", icon: ShieldCheck },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/outreach", label: "Outreach Tracker", icon: PhoneCall },
      { href: "/team", label: "Team", icon: Users },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  orgName: string;
}

export function Shell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setDark(!dark);
  }
  async function logout() {
    await call("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
      {NAV.map((g) => (
        <div key={g.group} className="mb-4">
          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">{g.group}</p>
          {g.items.map((it) => {
            const active = path === it.href || path.startsWith(it.href + "/");
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]", active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-ink")}
              >
                <it.icon className="size-4" aria-hidden />
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        {nav}
        <UserBox user={user} onLogout={logout} dark={dark} onTheme={toggleTheme} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-surface">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 text-muted hover:bg-surface-2">
                <X className="size-4" />
              </button>
            </div>
            {nav}
            <UserBox user={user} onLogout={logout} dark={dark} onTheme={toggleTheme} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 text-muted hover:bg-surface-2">
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">OrbiTech Leads</span>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex h-14 items-center gap-2.5 px-5">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">O</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">OrbiTech Leads</span>
        <span className="block text-[11px] text-muted">Lead Intelligence</span>
      </span>
    </Link>
  );
}

function UserBox({ user, onLogout, dark, onTheme }: { user: ShellUser; onLogout: () => void; dark: boolean; onTheme: () => void }) {
  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 px-1">
        <p className="truncate text-[13px] font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted">
          {user.orgName} · {user.role}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button onClick={onTheme} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-xs text-muted hover:bg-surface-2" aria-label="Toggle theme">
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          {dark ? "Light" : "Dark"}
        </button>
        <button onClick={onLogout} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-xs text-muted hover:bg-surface-2">
          <LogOut className="size-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
