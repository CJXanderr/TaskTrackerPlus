import {
  rootServer,
  AssetInformation,
  AssetPreviewType,
  RootApiException,
  ErrorCodeType,
} from "@rootsdk/server-app";
import { AttachmentKind } from "@tasktrackerplus/gen-shared";
import { withRetry } from "./lib/retry";
import { log, errFields } from "./lib/log";
import { uploadFailed } from "./errors";

// ============================================================================
// Upload tokens -> permanent asset URIs (+ best-effort file metadata).
//
// The client uploads through Root's native picker and receives temporary
// tokens. We convert them with dataStore.assets.create() and describe each
// asset with dataStore.assets.get() so the UI can show a name, size and the
// right preview (image / video / audio / generic file).
// ============================================================================

export interface StoredAsset {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
};

const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "aac", "m4a", "flac", "opus", "weba"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

function firstExtension(extensions: string | undefined): string {
  if (!extensions) return "";
  const first = extensions
    .split(/[\s,;|]+/)
    .map((e) => e.trim().replace(/^\.+/, "").toLowerCase())
    .find((e) => /^[a-z0-9]{1,10}$/.test(e));
  return first ?? "";
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

// Strip path separators and control characters; keep it readable.
function cleanFileName(name: string | undefined): string {
  if (!name) return "";
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 200);
}

// Returns null for assets Root marked invalid (deleted / blocked / errored).
function describe(uri: string, info: AssetInformation | undefined, index: number): StoredAsset | null {
  let kind = AttachmentKind.FILE;
  let mimeType = "";
  let size = 0;
  let ext = "";

  switch (info?.link.oneofKind) {
    case "image":
      kind = AttachmentKind.IMAGE;
      mimeType = info.link.image.isAnimated ? "image/gif" : "";
      break;
    case "video":
      kind = AttachmentKind.VIDEO;
      break;
    case "file": {
      const file = info.link.file;
      mimeType = (file.mimeType ?? "").toLowerCase();
      size = Number(file.length ?? 0n);
      ext = firstExtension(file.extensions) || MIME_EXT[mimeType] || "";
      if (mimeType.startsWith("audio/") || AUDIO_EXT.has(ext)) kind = AttachmentKind.AUDIO;
      else if (mimeType.startsWith("video/") || VIDEO_EXT.has(ext)) kind = AttachmentKind.VIDEO;
      break;
    }
    case "invalid":
      return null;
    default:
      break;
  }

  const preview = info?.preview;
  if (kind === AttachmentKind.FILE && preview) {
    // The SDK types preview.type with an internal copy of the enum; compare
    // the numeric values.
    const previewType = preview.type as number;
    if (previewType === (AssetPreviewType.Audio as number)) kind = AttachmentKind.AUDIO;
    else if (previewType === (AssetPreviewType.Video as number)) kind = AttachmentKind.VIDEO;
  }

  let fileName = cleanFileName(preview?.title);
  if (!fileName) {
    const base =
      kind === AttachmentKind.IMAGE ? "image" :
      kind === AttachmentKind.AUDIO ? "audio" :
      kind === AttachmentKind.VIDEO ? "video" : "file";
    fileName = index > 0 ? `${base}-${index + 1}` : base;
  }
  if (ext && !extensionOf(fileName)) fileName = `${fileName}.${ext}`;
  if (!ext) ext = extensionOf(fileName);
  if (!mimeType && kind === AttachmentKind.IMAGE && IMAGE_EXT.has(ext)) {
    mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  }

  return { uri, fileName, mimeType, size: Number.isFinite(size) ? size : 0, kind };
}

// Convert tokens in one call; returns assets in the same order as the tokens
// that converted successfully. Throws if none converted.
export async function convertUploadTokens(tokens: string[]): Promise<StoredAsset[]> {
  if (tokens.length === 0) return [];

  let created: Record<string, string>;
  try {
    // Not retried: tokens are single-use, a blind retry after a lost
    // response would fail anyway.
    created = (await rootServer.dataStore.assets.create({ tokens })).assets ?? {};
  } catch (err) {
    log("error", "assets.create failed", errFields(err));
    if (err instanceof RootApiException && err.errorCode === ErrorCodeType.TooManyRequests) {
      throw uploadFailed("Upload limit reached for now — try again in a little while");
    }
    throw uploadFailed("Root could not store the uploaded file(s)");
  }

  const uris = tokens.map((t) => created[t]).filter((u): u is string => typeof u === "string" && u.length > 0);
  if (uris.length === 0) throw uploadFailed("The upload expired or failed — please try again");
  if (uris.length < tokens.length) {
    log("warn", "some upload tokens did not convert", { requested: tokens.length, converted: uris.length });
  }

  let infos: Record<string, AssetInformation> = {};
  try {
    infos = (await withRetry("assets.get", () => rootServer.dataStore.assets.get({ uris }), { maxRetries: 2 }))
      .assets ?? {};
  } catch (err) {
    // Metadata is best effort: the files are stored either way.
    log("warn", "assets.get failed; storing attachments without metadata", errFields(err));
  }

  const assets = uris
    .map((uri, i) => describe(uri, infos[uri], i))
    .filter((a): a is StoredAsset => a !== null);
  if (assets.length === 0) throw uploadFailed("Root rejected the uploaded file(s)");
  return assets;
}

// Project images: converted the same way, must come back as an image.
export async function convertImageToken(token: string): Promise<string> {
  const [asset] = await convertUploadTokens([token]);
  if (!asset || (asset.kind !== AttachmentKind.IMAGE && !asset.mimeType.startsWith("image/"))) {
    throw uploadFailed("The project image must be an image file");
  }
  return asset.uri;
}
