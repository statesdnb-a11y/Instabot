"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Creator } from "@/components/creator";
import type { CatalogTrack, DeskPayload, ReelDTO } from "@/lib/types";

type Tab = "creator" | "drafts" | "approved";

async function postAction(id: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/reels/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "The desk could not do that.");
  return data;
}

function motionLabel(motion: ReelDTO["motion"]) {
  return motion === "pan" ? "Slow pan" : "Slow zoom";
}

function downloadHref(videoUrl: string) {
  try {
    const url = new URL(videoUrl);
    if (url.hostname.endsWith(".public.blob.vercel-storage.com")) {
      url.searchParams.set("download", "1");
      return url.toString();
    }
    if (url.hostname.endsWith(".blob.vercel-storage.com")) return videoUrl;
  } catch {
    // Relative file routes keep the query they already have.
  }
  return videoUrl.includes("?") ? `${videoUrl}&download=1` : `${videoUrl}?download=1`;
}

export function Portal({
  initial,
  instagramNotice = null,
}: {
  initial: DeskPayload;
  instagramNotice?: string | null;
}) {
  const [payload, setPayload] = useState<DeskPayload | null>(initial);
  const [loaded, setLoaded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("creator");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/reels", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as DeskPayload & { error?: string };
    if (!response.ok) throw new Error(data.error || "The desk could not load.");
    setPayload(data);
    setError(null);
  }, []);

  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        await load();
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "The desk could not load.");
      } finally {
        if (!stop) setLoaded(true);
      }
    };
    void run();
    return () => {
      stop = true;
    };
  }, [load]);

  const busy = payload?.reels.some(
    (reel) => reel.renderStatus === "pending" || reel.renderStatus === "rendering",
  );

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      void load().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "The desk could not load.");
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "fill" }),
      });
      const data = (await response.json()) as DeskPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not generate.");
      setPayload(data);
      setTab("drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate.");
    } finally {
      setGenerating(false);
    }
  }

  const reels = payload?.reels ?? [];
  const drafts = reels.filter((reel) => reel.status === "draft");
  const approved = reels
    .filter((reel) => reel.status === "approved")
    .sort((a, b) => (a.approvedAt ?? a.createdAt) - (b.approvedAt ?? b.createdAt));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="border-b border-border pb-6">
        <a
          href="/api/instagram/connect"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Connect Instagram
        </a>
        {payload?.instagram?.setupHint ? (
          <p className="mt-3 max-w-xl text-sm leading-5 text-foreground">{payload.instagram.setupHint}</p>
        ) : null}
        {instagramNotice ? <p className="mt-3 max-w-xl text-sm leading-5 text-destructive">{instagramNotice}</p> : null}
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Reels desk</p>
            <h1 className="mt-2 font-serif text-4xl tracking-tight sm:text-5xl">stockimgcouplegoals</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              You only approve. New reels and the ones already on the desk play Music 1, Music 2, or Music 3 from the file.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CaptionEditor />
            <Button className="h-11 px-4" onClick={() => void generate()} disabled={generating}>
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <p>{error}</p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      {!loaded ? (
        <div className="mt-8 grid gap-4">
          <div className="h-40 animate-pulse rounded-2xl bg-card" />
          <div className="h-40 animate-pulse rounded-2xl bg-card" />
          <p className="text-sm text-muted-foreground">Pulling the queue…</p>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="mt-6">
          <TabsList className="grid !h-11 w-full grid-cols-3">
            <TabsTrigger value="creator">Creator</TabsTrigger>
            <TabsTrigger value="drafts">Drafts {drafts.length}</TabsTrigger>
            <TabsTrigger value="approved">Approved {approved.length}</TabsTrigger>
          </TabsList>

          <TabsContent value="creator" className="mt-5">
            <Creator
              onCreated={async () => {
                await load();
                setTab("drafts");
              }}
            />
          </TabsContent>

          <TabsContent value="drafts" className="mt-5 grid gap-4">
            <p className="text-sm text-muted-foreground">
              {drafts.length} on the desk. Generate renders a silent cut before it shows up. The queue holds about {payload?.draftTarget ?? 5} drafts.
            </p>
            {drafts.length === 0 ? (
              <Empty
                title="The desk is clear."
                body="Generate a reel and it will land here with a line, a still, and Music 1, Music 2, or Music 3 in the file."
                action={
                  <Button className="h-11" onClick={() => void generate()} disabled={generating}>
                    Generate
                  </Button>
                }
              />
            ) : (
              drafts.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  connected={Boolean(payload?.instagramConnected)}
                  onChange={() => void load()}
                  onApproved={() => {
                    setTab("approved");
                    void load();
                  }}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="approved" className="mt-5 grid gap-4">
            {!payload?.instagramConnected ? (
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
                Instagram isn&apos;t connected, so approving keeps the file here and does not post.
                The music is already in the mp4. Publish does not swap it for a catalog track.
              </p>
            ) : (
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
                A published media id removes the reel. A failed publish stays here with the error.
              </p>
            )}
            {approved.length === 0 ? (
              <Empty
                title="Nothing is waiting."
                body="Approve a draft and it publishes immediately. If Instagram accepts it, the reel leaves the desk. If the post fails, it stays here. Nothing is filed as posted."
              />
            ) : (
              approved.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  connected={Boolean(payload?.instagramConnected)}
                  onChange={() => void load()}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-10">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function ReelCard({
  reel,
  connected,
  onChange,
  onApproved,
}: {
  reel: ReelDTO;
  connected: boolean;
  onChange: () => void;
  onApproved?: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const cutting = reel.renderStatus === "pending" || reel.renderStatus === "rendering";

  async function run(label: string, body: Record<string, unknown>, after?: () => void) {
    setWorking(label);
    setNote(null);
    try {
      await postAction(reel.id, body);
      after?.();
      onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That didn't take.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <article className="grid gap-5 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,280px)_1fr] md:p-5">
      <div className="relative mx-auto w-full max-w-[280px]">
        {reel.videoUrl ? (
          <video
            key={reel.videoUrl}
            className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
            src={reel.videoUrl}
            poster={reel.posterUrl}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={reel.posterUrl}
            alt={`Still by ${reel.photo.author}`}
            className="aspect-[9/16] w-full rounded-xl object-cover"
          />
        )}
        {cutting ? (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/50 px-4 text-center text-sm text-white">
            Cutting this reel…
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {reel.usedBefore ? <Badge>Used before</Badge> : null}
          <Badge variant="secondary">{motionLabel(reel.motion)}</Badge>
          {reel.bedLabel ? <Badge>{reel.bedLabel}</Badge> : null}
          <Badge variant="outline">{reel.durationSec}s</Badge>
          {reel.status === "approved" && reel.postState === "not_connected" ? (
            <Badge variant="outline">Not connected</Badge>
          ) : null}
          {reel.postState === "failed" ? <Badge variant="destructive">Post failed</Badge> : null}
          {!reel.inSync && reel.status === "draft" && !cutting ? (
            <Badge variant="outline">Needs a new cut</Badge>
          ) : null}
        </div>

        <p className="font-serif text-2xl leading-snug italic">{reel.line}</p>
        {reel.caption !== reel.line ? (
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="text-foreground">Caption. </span>
            {reel.caption}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Caption matches the on-screen line.</p>
        )}

        <p className="text-xs leading-5 text-muted-foreground">
          Still ·{" "}
          <a className="underline underline-offset-2" href={reel.photo.sourceUrl} target="_blank" rel="noreferrer">
            {reel.photo.author}
          </a>{" "}
          · {reel.photo.license}
        </p>

        {reel.bedLabel ? (
          <p className="text-sm leading-6">
            <span className="text-foreground">{reel.bedLabel}. </span>
            <span className="text-muted-foreground">Play uses the audio in this file. Publish keeps it and does not attach a catalog track.</span>
          </p>
        ) : (
          <MusicChoice
            reel={reel}
            connected={connected}
            disabled={Boolean(working)}
            onPick={(track) => void run("audio", { action: "set-audio", audio: track })}
          />
        )}

        {reel.renderError ? (
          <p className="text-sm text-destructive">{reel.renderError}</p>
        ) : null}
        {reel.postError ? <p className="text-sm text-destructive">{reel.postError}</p> : null}
        {note ? <p className="text-sm text-destructive">{note}</p> : null}

        {reel.status === "approved" && reel.postState === "not_connected" ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Saved as approved. Nothing was posted. The music in the file stays with the reel. Approve does not schedule a later send.
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2">
          {reel.status === "draft" ? (
            <>
              <EditLine reel={reel} disabled={Boolean(working)} onSaved={onChange} />
              <Button
                variant="outline"
                className="h-11"
                disabled={Boolean(working)}
                onClick={() => void run("line", { action: "regenerate-line" })}
              >
                {working === "line" ? "Writing…" : "New line"}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={Boolean(working)}
                onClick={() => void run("motion", { action: "regenerate-motion" })}
              >
                {working === "motion" ? "Recutting…" : "New motion"}
              </Button>
              {reel.renderStatus === "error" ? (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={Boolean(working)}
                  onClick={() => void run("render", { action: "retry-render" })}
                >
                  Try the cut again
                </Button>
              ) : null}
              <Button
                className="h-11"
                disabled={Boolean(working) || !reel.inSync}
                onClick={() => void run("approve", { action: "approve" }, onApproved)}
              >
                {working === "approve" ? "Approving…" : "Approve"}
              </Button>
              <Button
                variant="ghost"
                className="h-11"
                disabled={Boolean(working)}
                onClick={() => void run("skip", { action: "skip" })}
              >
                Skip
              </Button>
            </>
          ) : null}
          {reel.status === "approved" ? (
            <Button
              className="h-11"
              disabled={Boolean(working)}
              onClick={() => void run("publish", { action: "retry-publish" })}
            >
              {working === "publish" ? "Posting…" : "Try posting again"}
            </Button>
          ) : null}
          {reel.videoUrl ? (
            <Button variant="outline" className="h-11" asChild>
              <a href={downloadHref(reel.videoUrl)}>Download mp4</a>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function MusicChoice({
  reel,
  connected,
  disabled,
  onPick,
}: {
  reel: ReelDTO;
  connected: boolean;
  disabled: boolean;
  onPick: (track: CatalogTrack) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!connected) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        Music attaches once a professional account is connected via Facebook Login (instagram_basic,
        instagram_content_publish, and a linked Page). This file stays silent.
      </p>
    );
  }

  async function search(nextQuery?: string) {
    setSearching(true);
    setCatalogError(null);
    setOpen(true);
    try {
      const trimmed = nextQuery?.trim();
      const url = trimmed ? `/api/audio?q=${encodeURIComponent(trimmed)}` : "/api/audio";
      const response = await fetch(url, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        tracks?: CatalogTrack[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "The catalog could not be loaded.");
      setResults(data.tracks ?? []);
      if (data.error) setCatalogError(data.error);
    } catch (error) {
      setResults([]);
      setCatalogError(error instanceof Error ? error.message : "The catalog could not be loaded.");
    } finally {
      setSearching(false);
    }
  }

  const audio = reel.audio;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        {audio?.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={audio.artworkUrl} alt="" className="size-12 rounded-md object-cover" />
        ) : (
          <div className="size-12 shrink-0 rounded-md bg-muted" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm">{audio ? audio.title : "No track chosen yet"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {audio?.artist || "Instagram catalog · attaches when you post"}
          </p>
        </div>
      </div>
      {audio?.previewUrl ? (
        <audio controls preload="none" src={audio.previewUrl} className="h-9 w-full max-w-sm" />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the catalog"
          className="h-11 w-full max-w-xs"
          disabled={disabled || searching}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search(query);
          }}
        />
        <Button
          variant="outline"
          className="h-11"
          disabled={disabled || searching}
          onClick={() => void search(query)}
        >
          {searching ? "Searching…" : "Search"}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={disabled || searching}
          onClick={() => void search()}
        >
          Trending
        </Button>
      </div>
      {catalogError ? <p className="text-sm text-destructive">{catalogError}</p> : null}
      {open && results.length > 0 ? (
        <ul className="grid max-h-48 gap-1 overflow-auto rounded-xl border border-border p-1">
          {results.map((track) => (
            <li key={track.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                disabled={disabled}
                onClick={() => {
                  onPick(track);
                  setOpen(false);
                }}
              >
                {track.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.artworkUrl} alt="" className="size-8 rounded object-cover" />
                ) : (
                  <span className="size-8 shrink-0 rounded bg-muted" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{track.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{track.artist}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !searching && results.length === 0 && !catalogError ? (
        <p className="text-sm text-muted-foreground">Nothing matched.</p>
      ) : null}
    </div>
  );
}

function EditLine({
  reel,
  disabled,
  onSaved,
}: {
  reel: ReelDTO;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState(reel.line);
  const [caption, setCaption] = useState(reel.caption);
  const [custom, setCustom] = useState(reel.captionCustom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineChanged = line.trim().replace(/\s+/g, " ") !== reel.line;
  const captionValue = custom ? caption : line;
  const captionChanged = captionValue.trim().replace(/\s+/g, " ") !== reel.caption || custom !== reel.captionCustom;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLine(reel.line);
      setCaption(reel.caption);
      setCustom(reel.captionCustom);
      setError(null);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await postAction(reel.id, {
        action: "update",
        line,
        caption: custom ? caption : line,
        captionCustom: custom,
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" className="h-11" disabled={disabled} onClick={() => onOpenChange(true)}>
        Edit text
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rewrite the line</DialogTitle>
          <DialogDescription>
            The on-screen line is burned into the video. Saving a new one cuts the reel again before it can be approved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`line-${reel.id}`}>On-screen line</Label>
            <Textarea
              id={`line-${reel.id}`}
              value={line}
              onChange={(event) => setLine(event.target.value)}
              rows={4}
              maxLength={220}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={custom}
              onChange={(event) => setCustom(event.target.checked)}
            />
            Use a different Instagram caption
          </label>
          {custom ? (
            <div className="grid gap-2">
              <Label htmlFor={`caption-${reel.id}`}>Caption</Label>
              <Textarea
                id={`caption-${reel.id}`}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={4}
                maxLength={2200}
              />
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || (!lineChanged && !captionChanged)}>
            {busy ? "Saving…" : lineChanged ? "Save and re-render" : "Save caption"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CaptionEntry = { id: string; text: string };
type CaptionDesk = { templates: CaptionEntry[]; nouns: CaptionEntry[]; verbs: CaptionEntry[] };

function CaptionEditor() {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState<CaptionDesk | null>(null);
  const [template, setTemplate] = useState("");
  const [noun, setNoun] = useState("");
  const [verb, setVerb] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadDesk() {
    const response = await fetch("/api/captions", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as CaptionDesk & { error?: string };
    if (!response.ok) throw new Error(data.error || "The captions could not load.");
    setDesk(data);
    setError(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    void loadDesk().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "The captions could not load.");
    });
  }

  async function send(body: Record<string, unknown>, clear: () => void) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as CaptionDesk & { error?: string };
      if (!response.ok) throw new Error(data.error || "That didn't take.");
      setDesk(data);
      clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't take.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" className="h-11" onClick={() => onOpenChange(true)}>
        Captions
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Caption templates</DialogTitle>
          <DialogDescription>
            New drafts and New line fill these in. {"{noun}"} and {"{verb}"} come from the banks.{" "}
            {"{him/her}"} picks him or her. {"{he/she}"} picks he or she. {"{his/her}"} picks his or her.
            Saving a custom line keeps that exact line on the reel and adds a template here. Click a noun or verb blank to flip it.
          </DialogDescription>
        </DialogHeader>
        <CaptionGroup
          label="Templates"
          placeholder="Add a template"
          value={template}
          entries={desk?.templates ?? []}
          busy={busy || !desk}
          blanks
          onChange={setTemplate}
          onAdd={() => void send({ action: "add-template", text: template }, () => setTemplate(""))}
          onDelete={(id) => void send({ action: "delete-template", id }, () => undefined)}
          onFlipBlank={(id, index) => void send({ action: "flip-blank", id, index }, () => undefined)}
        />
        <CaptionGroup
          label="Verbs"
          placeholder="Add a verb"
          value={verb}
          entries={desk?.verbs ?? []}
          busy={busy || !desk}
          onChange={setVerb}
          onAdd={() => void send({ action: "add-word", bank: "verb", text: verb }, () => setVerb(""))}
          onDelete={(id) => void send({ action: "delete-word", id }, () => undefined)}
          onFlipWord={(id) => void send({ action: "flip-word", id }, () => undefined)}
        />
        <CaptionGroup
          label="Nouns"
          placeholder="Add a noun"
          value={noun}
          entries={desk?.nouns ?? []}
          busy={busy || !desk}
          onChange={setNoun}
          onAdd={() => void send({ action: "add-word", bank: "noun", text: noun }, () => setNoun(""))}
          onDelete={(id) => void send({ action: "delete-word", id }, () => undefined)}
          onFlipWord={(id) => void send({ action: "flip-word", id }, () => undefined)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function CaptionGroup({
  label,
  placeholder,
  value,
  entries,
  busy,
  blanks = false,
  onChange,
  onAdd,
  onDelete,
  onFlipBlank,
  onFlipWord,
}: {
  label: string;
  placeholder: string;
  value: string;
  entries: CaptionEntry[];
  busy: boolean;
  blanks?: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onFlipBlank?: (id: string, index: number) => void;
  onFlipWord?: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="grid gap-1">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              {blanks ? (
                <TemplateText text={entry.text} disabled={busy} onFlip={(index) => onFlipBlank?.(entry.id, index)} />
              ) : (
                <span className="min-w-0 text-sm">{entry.text}</span>
              )}
              <span className="flex shrink-0 gap-1">
                {onFlipWord ? (
                  <Button variant="ghost" className="h-9" disabled={busy} onClick={() => onFlipWord(entry.id)}>
                    Flip
                  </Button>
                ) : null}
                <Button variant="ghost" className="h-9" disabled={busy} onClick={() => onDelete(entry.id)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder={placeholder}
          className="h-11"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAdd();
          }}
        />
        <Button variant="outline" className="h-11" disabled={busy || !value.trim()} onClick={onAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}

function TemplateText({
  text,
  disabled,
  onFlip,
}: {
  text: string;
  disabled: boolean;
  onFlip: (index: number) => void;
}) {
  const parts = text.split(/(\{(?:noun|verb)\})/g);
  const rendered = parts.reduce<{ part: string; tokenIndex: number | null }[]>((items, part) => {
    if (part !== "{noun}" && part !== "{verb}") return [...items, { part, tokenIndex: null }];
    const tokenIndex = items.filter((item) => item.tokenIndex !== null).length;
    return [...items, { part, tokenIndex }];
  }, []);
  return (
    <span className="min-w-0 text-sm">
      {rendered.map((item, index) => {
        if (item.tokenIndex === null) return <span key={index}>{item.part}</span>;
        const next = item.part === "{noun}" ? "verb" : "noun";
        return (
          <button
            key={index}
            type="button"
            className="underline decoration-dotted underline-offset-4"
            disabled={disabled}
            onClick={() => onFlip(item.tokenIndex as number)}
          >
            <span className="sr-only">Flip to {next}: </span>
            {item.part}
          </button>
        );
      })}
    </span>
  );
}
