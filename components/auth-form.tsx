"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { call } from "./hooks";
import { Button, ErrorNote, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reg = mode === "register";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await call(`/api/auth/${mode}`, {
        method: "POST",
        body: reg
          ? { name: f.get("name"), email: f.get("email"), password: f.get("password"), orgName: f.get("orgName") || undefined }
          : { email: f.get("email"), password: f.get("password") },
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-base font-bold text-accent-fg">O</span>
          <div>
            <p className="text-base font-semibold leading-tight">OrbiTech Lead Intelligence</p>
            <p className="text-xs text-muted">by The OrbiTech Solution</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3.5 rounded-xl border border-line bg-surface p-5">
          <h1 className="text-lg font-semibold">{reg ? "Create your workspace" : "Sign in"}</h1>
          {error && <ErrorNote>{error}</ErrorNote>}
          {reg && <Field label="Your name"><Input name="name" required autoComplete="name" maxLength={100} /></Field>}
          {reg && <Field label="Company / workspace name" hint="Optional"><Input name="orgName" maxLength={100} autoComplete="organization" /></Field>}
          <Field label="Work email"><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Password" hint={reg ? "At least 10 characters, with letters and a number." : undefined}>
            <Input name="password" type="password" required minLength={reg ? 10 : 1} autoComplete={reg ? "new-password" : "current-password"} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{reg ? "Create account" : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {reg ? "Already have an account?" : "New here?"}{" "}
          <Link href={reg ? "/login" : "/register"} className="font-medium text-accent hover:underline">
            {reg ? "Sign in" : "Create a workspace"}
          </Link>
        </p>
      </div>
    </main>
  );
}
