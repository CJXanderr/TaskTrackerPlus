import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { Attachment, AttachmentKind, AttachTarget } from "@tasktrackerplus/gen-shared";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Paperclip,
  Play,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { attachmentUrl, downloadAttachment } from "../lib/download";
import { fileExtension, fileSize } from "../lib/format";
import { useToast } from "../state/Toasts";
import { IconButton } from "./ui";
import { UserName } from "./people";

// ============================================================================
// Attachments: upload (any file type), preview (images, video, audio) and
// download for every file posted on a task or in its comments.
// ============================================================================

// --- Upload ------------------------------------------------------------------

export function useAttachmentUpload() {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (opts: { projectId: number; taskId?: number; target: AttachTarget }): Promise<Attachment[]> => {
      let tokens: string[];
      try {
        const res = await rootClient.assets.fileUpload({ fileType: "all", multiple: true, windowTitle: "Attach files" });
        tokens = res.tokens ?? [];
      } catch (err) {
        toast.error(err, "Couldn't open the file picker");
        return [];
      }
      if (tokens.length === 0) return [];
      setUploading(true);
      try {
        const res = await api.uploadAttachments({
          projectId: opts.projectId,
          taskId: opts.taskId ?? 0,
          tokens,
          target: opts.target,
        });
        if (res.attachments.length < tokens.length) {
          toast.show(`${tokens.length - res.attachments.length} file(s) couldn't be attached`, "error");
        }
        return res.attachments;
      } catch (err) {
        toast.error(err, "Upload failed");
        return [];
      } finally {
        setUploading(false);
      }
    },
    [toast],
  );

  return { upload, uploading };
}

// --- Helpers -------------------------------------------------------------------

function kindIcon(att: Attachment, size = 18): React.ReactNode {
  switch (att.kind) {
    case AttachmentKind.IMAGE:
      return <ImageIcon size={size} />;
    case AttachmentKind.AUDIO:
      return <Music size={size} />;
    case AttachmentKind.VIDEO:
      return <Film size={size} />;
  }
  const ext = fileExtension(att.fileName);
  if (["pdf", "doc", "docx", "txt", "md", "rtf", "odt", "pages"].includes(ext)) return <FileText size={size} />;
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2"].includes(ext)) return <FileArchive size={size} />;
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)) return <FileSpreadsheet size={size} />;
  if (["js", "ts", "tsx", "jsx", "json", "html", "css", "py", "cs", "cpp", "c", "h", "java", "lua", "jsx", "xml", "yml", "yaml"].includes(ext)) {
    return <FileCode size={size} />;
  }
  return <FileIcon size={size} />;
}

function metaLine(att: Attachment): string {
  const ext = fileExtension(att.fileName).toUpperCase();
  return [fileSize(att.size), ext].filter(Boolean).join(" · ");
}

const isViewable = (a: Attachment) => a.kind === AttachmentKind.IMAGE || a.kind === AttachmentKind.VIDEO;

// --- Download button ----------------------------------------------------------------

export const DownloadButton: React.FC<{ att: Attachment; className?: string; withLabel?: boolean }> = ({
  att,
  className,
  withLabel,
}) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadAttachment(att);
    } catch (err) {
      toast.error(err, "Couldn't download the file");
    } finally {
      setBusy(false);
    }
  };
  if (withLabel) {
    return (
      <button type="button" className={`btn btn-quiet btn-sm ${className ?? ""}`} onClick={run} disabled={busy}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
        <span>Download</span>
      </button>
    );
  }
  return (
    <IconButton label={`Download ${att.fileName}`} className={className} onClick={run} disabled={busy}>
      {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
    </IconButton>
  );
};

// --- Lightbox -------------------------------------------------------------------------

export const Lightbox: React.FC<{ items: Attachment[]; index: number; onClose: () => void }> = ({
  items,
  index: start,
  onClose,
}) => {
  const [index, setIndex] = useState(start);
  const att = items[Math.min(index, items.length - 1)];
  const go = useCallback(
    (d: number) => setIndex((i) => (items.length === 0 ? 0 : (i + d + items.length) % items.length)),
    [items.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [go, onClose]);

  if (!att) return null;
  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-bar">
        <div className="lightbox-title">
          <span className="lightbox-name" title={att.fileName}>{att.fileName}</span>
          <span className="lightbox-meta">
            {metaLine(att)}
            {items.length > 1 && ` · ${index + 1} of ${items.length}`}
          </span>
        </div>
        <DownloadButton att={att} withLabel className="lightbox-download" />
        <IconButton label="Close" onClick={onClose} className="lightbox-close">
          <X size={20} />
        </IconButton>
      </div>
      <div className="lightbox-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {items.length > 1 && (
          <IconButton label="Previous" className="lightbox-nav prev" onClick={() => go(-1)}>
            <ChevronLeft size={24} />
          </IconButton>
        )}
        {att.kind === AttachmentKind.VIDEO ? (
          <video key={att.id} className="lightbox-media" src={rootClient.assets.toUrl(att.assetUri)} controls autoPlay playsInline />
        ) : (
          <img key={att.id} className="lightbox-media" src={attachmentUrl(att)} alt={att.fileName} />
        )}
        {items.length > 1 && (
          <IconButton label="Next" className="lightbox-nav next" onClick={() => go(1)}>
            <ChevronRight size={24} />
          </IconButton>
        )}
      </div>
    </div>,
    document.body,
  );
};

// --- Tiles ------------------------------------------------------------------------------

const RemoveButton: React.FC<{ att: Attachment; onRemove: (a: Attachment) => void }> = ({ att, onRemove }) => (
  <IconButton
    label={`Remove ${att.fileName}`}
    danger
    onClick={(e) => {
      e.stopPropagation();
      onRemove(att);
    }}
  >
    <X size={16} />
  </IconButton>
);

const ImageTile: React.FC<{
  att: Attachment;
  onOpen: () => void;
  onRemove?: (a: Attachment) => void;
  compact?: boolean;
}> = ({ att, onOpen, onRemove, compact }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`att-thumb ${compact ? "compact" : ""}`} title={att.fileName}>
      <button type="button" className="att-thumb-open" onClick={onOpen} aria-label={`Open ${att.fileName}`}>
        {failed ? (
          <span className="att-thumb-fallback">
            <ImageIcon size={22} />
          </span>
        ) : (
          <img src={rootClient.assets.toImageUrl(att.assetUri, ImageUriResolution.Medium)} alt="" loading="lazy" onError={() => setFailed(true)} />
        )}
      </button>
      <div className="att-thumb-actions">
        <DownloadButton att={att} />
        {onRemove && <RemoveButton att={att} onRemove={onRemove} />}
      </div>
      {!compact && <div className="att-thumb-name">{att.fileName}</div>}
    </div>
  );
};

const FileRow: React.FC<{
  att: Attachment;
  onOpen?: () => void;
  onRemove?: (a: Attachment) => void;
  showUploader?: boolean;
}> = ({ att, onOpen, onRemove, showUploader }) => (
  <div className={`att-row kind-${AttachmentKind[att.kind]?.toLowerCase()}`}>
    <div className="att-row-main">
      <button
        type="button"
        className="att-row-icon"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={onOpen ? `Play ${att.fileName}` : undefined}
      >
        {att.kind === AttachmentKind.VIDEO ? <Play size={18} /> : kindIcon(att)}
      </button>
      <div className="att-row-text">
        <div className="att-row-name" title={att.fileName}>
          {att.fileName}
        </div>
        <div className="att-row-meta">
          {metaLine(att)}
          {showUploader && (
            <>
              {metaLine(att) && " · "}
              <UserName userId={att.uploadedBy} />
            </>
          )}
        </div>
      </div>
      <div className="att-row-actions">
        <DownloadButton att={att} />
        {onRemove && <RemoveButton att={att} onRemove={onRemove} />}
      </div>
    </div>
    {att.kind === AttachmentKind.AUDIO && (
      <audio className="att-audio" controls preload="none" src={rootClient.assets.toUrl(att.assetUri)} />
    )}
  </div>
);

export const AttachmentList: React.FC<{
  attachments: Attachment[];
  canRemove?: (a: Attachment) => boolean;
  onRemove?: (a: Attachment) => void;
  compact?: boolean;
  showUploader?: boolean;
}> = ({ attachments, canRemove, onRemove, compact, showUploader }) => {
  const [viewer, setViewer] = useState<number | null>(null);
  const viewable = attachments.filter(isViewable);
  const images = attachments.filter((a) => a.kind === AttachmentKind.IMAGE);
  const others = attachments.filter((a) => a.kind !== AttachmentKind.IMAGE);
  const removeFor = (a: Attachment) => (onRemove && (!canRemove || canRemove(a)) ? onRemove : undefined);
  if (attachments.length === 0) return null;
  return (
    <div className={`att-list ${compact ? "compact" : ""}`}>
      {images.length > 0 && (
        <div className="att-thumbs">
          {images.map((a) => (
            <ImageTile
              key={a.id}
              att={a}
              compact={compact}
              onOpen={() => setViewer(viewable.findIndex((v) => v.id === a.id))}
              onRemove={removeFor(a)}
            />
          ))}
        </div>
      )}
      {others.map((a) => (
        <FileRow
          key={a.id}
          att={a}
          showUploader={showUploader}
          onOpen={a.kind === AttachmentKind.VIDEO ? () => setViewer(viewable.findIndex((v) => v.id === a.id)) : undefined}
          onRemove={removeFor(a)}
        />
      ))}
      {viewer !== null && viewer >= 0 && <Lightbox items={viewable} index={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
};

// Pending (draft) files in a composer or the new-task form.
export const DraftChips: React.FC<{ drafts: Attachment[]; onRemove: (a: Attachment) => void }> = ({ drafts, onRemove }) => {
  if (drafts.length === 0) return null;
  return (
    <div className="draft-chips">
      {drafts.map((d) => (
        <span key={d.id} className="draft-chip" title={d.fileName}>
          {d.kind === AttachmentKind.IMAGE ? (
            <img src={rootClient.assets.toImageUrl(d.assetUri, ImageUriResolution.Small)} alt="" />
          ) : (
            <span className="draft-chip-icon">{kindIcon(d, 14)}</span>
          )}
          <span className="draft-chip-name">{d.fileName}</span>
          {d.size > 0 && <span className="draft-chip-size">{fileSize(d.size)}</span>}
          <button type="button" className="draft-chip-remove" aria-label={`Remove ${d.fileName}`} onClick={() => onRemove(d)}>
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
};

export const AttachButton: React.FC<{
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  iconOnly?: boolean;
}> = ({ onClick, busy, disabled, label = "Attach files", iconOnly }) =>
  iconOnly ? (
    <IconButton label={label} onClick={onClick} disabled={disabled || busy}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <Paperclip size={17} />}
    </IconButton>
  ) : (
    <button type="button" className="btn btn-quiet btn-sm" onClick={onClick} disabled={disabled || busy}>
      {busy ? <LoaderCircle size={15} className="spin" /> : <Paperclip size={15} />}
      <span>{busy ? "Uploading…" : label}</span>
    </button>
  );
