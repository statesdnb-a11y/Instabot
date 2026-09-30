export type Motion = "zoom" | "pan";

export type ReelStatus = "draft" | "approved" | "posted" | "skipped";

export type RenderStatus = "pending" | "rendering" | "ready" | "error";

export type PostState = "not_connected" | "failed" | "posted" | null;

export type CatalogTrack = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  durationMs: number | null;
};

export type ReelDTO = {
  id: string;
  status: ReelStatus;
  line: string;
  caption: string;
  captionCustom: boolean;
  usedBefore: boolean;
  photo: {
    id: string;
    author: string;
    username: string;
    sourceUrl: string;
    license: string;
    licenseUrl: string;
  };
  audio: CatalogTrack | null;
  bedTrack: string | null;
  bedLabel: string | null;
  motion: Motion;
  durationSec: number;
  renderStatus: RenderStatus;
  renderError: string | null;
  videoUrl: string | null;
  posterUrl: string;
  inSync: boolean;
  postState: PostState;
  postError: string | null;
  igMediaId: string | null;
  stillMissing: boolean;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  postedAt: number | null;
};

export type InstagramDesk = {
  connected: boolean;
  username: string | null;
  stored: boolean;
  setupHint: string | null;
};

export type DeskPayload = {
  reels: ReelDTO[];
  instagramConnected: boolean;
  instagram: InstagramDesk;
  draftTarget: number;
};
