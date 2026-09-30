"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MUSIC = [
  { id: "music-1", label: "Music 1" },
  { id: "music-2", label: "Music 2" },
  { id: "music-3", label: "Music 3" },
] as const;

type Still = {
  id: string;
  author: string;
  sourceUrl: string;
  license: string;
  imageUrl: string;
};

export function Creator({ onCreated }: { onCreated: () => Promise<void> }) {
  const [stills, setStills] = useState<Still[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [music, setMusic] = useState<(typeof MUSIC)[number]["id"]>("music-1");
  const [caption, setCaption] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string | null>(null);

  const loadStills = useCallback(async (exclude: string[], previous: string | null) => {
    const params = new URLSearchParams();
    if (exclude.length) params.set("exclude", exclude.join(","));
    if (previous) params.set("q", previous);
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    const response = await fetch(`/api/stills${query}`, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { stills?: Still[]; query?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "The stills could not load.");
    const next = data.stills ?? [];
    setStills(next);
    setSearchQuery(data.query ?? null);
    setSelectedId((current) => (current && next.some((still) => still.id === current) ? current : null));
  }, []);

  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        await loadStills([], null);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "The stills could not load.");
      } finally {
        if (!stop) setLoading(false);
      }
    };
    void run();
    return () => {
      stop = true;
    };
  }, [loadStills]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await loadStills(stills.map((still) => still.id), searchQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The stills could not load.");
    } finally {
      setRefreshing(false);
    }
  }

  async function generateLine() {
    setWriting(true);
    setError(null);
    try {
      const response = await fetch("/api/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", text: caption }),
      });
      const data = (await response.json().catch(() => ({}))) as { line?: string; error?: string };
      if (!response.ok || !data.line) throw new Error(data.error || "A line could not be written.");
      setCaption(data.line);
      setGenerated(data.line);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A line could not be written.");
    } finally {
      setWriting(false);
    }
  }

  async function create() {
    if (!selectedId) {
      setError("Pick a still.");
      return;
    }
    const text = caption.trim();
    if (!text) {
      setError("Write a caption, or generate one.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "create",
          photoId: selectedId,
          bedTrack: music,
          caption: text,
          manual: text !== generated,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "The reel could not be created.");
      setCaption("");
      setGenerated(null);
      setSelectedId(null);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The reel could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <h2 className="font-serif text-2xl">Creator</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A new white-studio search each time{searchQuery ? `: ${searchQuery}` : ""}. One photo per couple. Pick one, choose Music 1, Music 2, or Music 3, and burn in a line.
          </p>
        </div>
        <Button className="h-11" variant="outline" onClick={() => void refresh()} disabled={loading || refreshing || creating}>
          {refreshing ? "Loading stills…" : "New stills"}
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="aspect-[9/16] animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : stills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No white-studio stills are available.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stills.map((still) => {
            const selected = still.id === selectedId;
            return (
              <button
                key={still.id}
                type="button"
                onClick={() => setSelectedId(still.id)}
                className={`overflow-hidden rounded-xl border text-left ${selected ? "border-primary ring-2 ring-primary" : "border-border"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={still.imageUrl} alt={`Still by ${still.author}`} className="aspect-[9/16] w-full object-cover" />
                <span className="block truncate px-2 py-1.5 text-xs text-muted-foreground">{still.author}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-2">
        <p className="text-sm">Music</p>
        <div className="flex flex-wrap gap-2">
          {MUSIC.map((track) => (
            <Button
              key={track.id}
              type="button"
              variant={music === track.id ? "default" : "outline"}
              className="h-11"
              onClick={() => setMusic(track.id)}
            >
              {track.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Caption</p>
          <Button type="button" variant="outline" className="h-11" onClick={() => void generateLine()} disabled={writing || creating}>
            {writing ? "Writing…" : "Generate a line"}
          </Button>
        </div>
        <Textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Type a line, or generate one from the templates."
          maxLength={220}
          className="min-h-24"
        />
        <p className="text-sm leading-6 text-muted-foreground">
          Generate fills this from the templates and word banks. The text in the box is what gets burned in.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <Button className="h-11" onClick={() => void create()} disabled={creating || !selectedId || !caption.trim()}>
          {creating ? "Creating…" : "Create reel"}
        </Button>
      </div>
    </section>
  );
}
