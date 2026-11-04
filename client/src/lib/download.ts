import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import type { IRootSdkBridge } from "@rootsdk/client-app";
import { Attachment, AttachmentKind } from "@tasktrackerplus/gen-shared";

// ============================================================================
// Downloads for every posted file — images, music, video, documents.
//
// Inside Root the app runs in a sandboxed tab, so a plain <a download> may be
// ignored. Root's native bridge exposes downloadUri / downloadImageUri which
// hand the asset to the Root client's own download flow; we use those first
// and fall back to a browser download (devhost, or if the bridge declines).
// ============================================================================

function nativeBridge(): Partial<IRootSdkBridge> | undefined {
  try {
    const parent = window.parent as unknown as { rootSdk?: Partial<IRootSdkBridge> };
    return parent?.rootSdk;
  } catch {
    return undefined; // cross-origin parent
  }
}

export function attachmentUrl(att: Pick<Attachment, "assetUri" | "kind">): string {
  return att.kind === AttachmentKind.IMAGE
    ? rootClient.assets.toImageUrl(att.assetUri, ImageUriResolution.Original)
    : rootClient.assets.toUrl(att.assetUri);
}

async function browserDownload(url: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    let name = fileName || "download";
    if (!/\.[A-Za-z0-9]{1,10}$/.test(name)) {
      const ext = (blob.type.split("/")[1] ?? "").split(/[;+]/)[0];
      if (ext && /^[a-z0-9]{1,10}$/i.test(ext)) name = `${name}.${ext === "jpeg" ? "jpg" : ext}`;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    // Last resort: let the host open the file.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function downloadAttachment(att: Attachment): Promise<void> {
  const bridge = nativeBridge();
  if (bridge && rootClient.device.platform !== "devhost") {
    try {
      const started =
        att.kind === AttachmentKind.IMAGE && typeof bridge.downloadImageUri === "function"
          ? await bridge.downloadImageUri(att.assetUri, ImageUriResolution.Original)
          : typeof bridge.downloadUri === "function"
            ? await bridge.downloadUri(att.assetUri)
            : false;
      if (started) return;
    } catch (err) {
      console.warn("[download] native download failed, falling back", err);
    }
  }
  await browserDownload(attachmentUrl(att), att.fileName);
}
