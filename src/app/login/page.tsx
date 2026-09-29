"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; open?: boolean };
      if (!response.ok) throw new Error(data.error || "Could not unlock the desk.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock the desk.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Reels desk</p>
      <h1 className="mt-2 font-serif text-4xl">This desk is locked.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Enter the passphrase from INSTABOT_PASSWORD. Leave that variable unset and the desk stays open for a local demo.
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="password">Passphrase</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="h-11" disabled={busy}>
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
