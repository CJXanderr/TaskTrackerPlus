import React, { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  CirclePlus,
  Flag,
  Paperclip,
  Pencil,
  Tag as TagIcon,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  Activity,
  ActivityKind,
  Attachment,
  AttachTarget,
  Comment,
  TaskPriority,
  TaskStatus,
} from "@tasktrackerplus/gen-shared";
import { api } from "../lib/api";
import { dateTime, dueLabel, relativeTime } from "../lib/format";
import { phase, priorityMeta } from "../lib/phases";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, ConfirmDialog, IconButton } from "../components/ui";
import { Avatar, RoleBadge, UserName } from "../components/people";
import { PriorityIcon, StatusIcon } from "../components/icons";
import { AttachButton, AttachmentList, DraftChips, useAttachmentUpload } from "../components/attachments";

export const COMMENT_LIMIT = 2000;
export const COMMENTS_PER_TASK = 50;

// --- History entries -----------------------------------------------------------------

const AssigneeRef: React.FC<{ value: string }> = ({ value }) => {
  const [kind, id] = value.split(":");
  if (!id) return <span className="muted">nobody</span>;
  return kind === "role" ? <RoleBadge roleId={id} /> : <strong><UserName userId={id} /></strong>;
};

const HistoryText: React.FC<{ a: Activity }> = ({ a }) => {
  switch (a.kind) {
    case ActivityKind.CREATED:
      return <>created the task</>;
    case ActivityKind.STATUS: {
      const from = phase(Number(a.fromValue) as TaskStatus);
      const to = phase(Number(a.toValue) as TaskStatus);
      return (
        <>
          moved it from <span className="inline-status"><StatusIcon status={from.status} size={12} /> {from.label}</span> to{" "}
          <span className="inline-status"><StatusIcon status={to.status} size={12} /> {to.label}</span>
        </>
      );
    }
    case ActivityKind.PRIORITY: {
      const to = priorityMeta(Number(a.toValue) as TaskPriority);
      return (
        <>
          set priority to <span className="inline-status"><PriorityIcon priority={to.priority} size={12} /> {to.label}</span>
        </>
      );
    }
    case ActivityKind.ASSIGNEE:
      if (!a.toValue) return <>removed the assignee <AssigneeRef value={a.fromValue} /></>;
      return <>assigned <AssigneeRef value={a.toValue} /></>;
    case ActivityKind.TAG_ADDED:
      return <>added tag <strong>{a.toValue || "a deleted tag"}</strong></>;
    case ActivityKind.TAG_REMOVED:
      return <>removed tag <strong>{a.toValue || "a deleted tag"}</strong></>;
    case ActivityKind.DUE_DATE:
      return a.toValue ? <>set the due date to <strong>{dueLabel(a.toValue)}</strong></> : <>removed the due date</>;
    case ActivityKind.ATTACHMENT_ADDED:
      return <>attached <strong>{a.toValue}</strong></>;
    case ActivityKind.ATTACHMENT_REMOVED:
      return <>removed the file <strong>{a.toValue}</strong></>;
    default:
      return <>updated the task</>;
  }
};

function historyIcon(kind: ActivityKind): React.ReactNode {
  switch (kind) {
    case ActivityKind.CREATED:
      return <CirclePlus size={14} />;
    case ActivityKind.STATUS:
      return <ArrowRightLeft size={14} />;
    case ActivityKind.PRIORITY:
      return <Flag size={14} />;
    case ActivityKind.ASSIGNEE:
      return <UserRound size={14} />;
    case ActivityKind.TAG_ADDED:
    case ActivityKind.TAG_REMOVED:
      return <TagIcon size={14} />;
    case ActivityKind.DUE_DATE:
      return <CalendarDays size={14} />;
    default:
      return <Paperclip size={14} />;
  }
}

const HistoryItem: React.FC<{ a: Activity }> = ({ a }) => (
  <div className="history-item">
    <span className="history-icon">{historyIcon(a.kind)}</span>
    <span className="history-text">
      <strong><UserName userId={a.actorId} /></strong> <HistoryText a={a} />
      <span className="history-time" title={dateTime(a.createdAt)}> · {relativeTime(a.createdAt)}</span>
    </span>
  </div>
);

// --- Comments ----------------------------------------------------------------------------

const CommentEditor: React.FC<{
  comment: Comment;
  projectId: number;
  onDone: (saved: boolean) => void;
}> = ({ comment, projectId, onDone }) => {
  const toast = useToast();
  const { upload, uploading } = useAttachmentUpload();
  const [body, setBody] = useState(comment.body);
  const [removed, setRemoved] = useState<number[]>([]);
  const [added, setAdded] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);
  const kept = comment.attachments.filter((a) => !removed.includes(a.id));

  const cancel = () => {
    for (const d of added) void api.deleteAttachment({ attachmentId: d.id }).catch(() => undefined);
    onDone(false);
  };

  const save = async () => {
    if (!body.trim() && kept.length + added.length === 0) {
      toast.show("Write a comment or attach a file", "error");
      return;
    }
    setSaving(true);
    try {
      await api.updateComment({
        commentId: comment.id,
        body: body.trim(),
        addAttachmentIds: added.map((a) => a.id),
        removeAttachmentIds: removed,
      });
      onDone(true);
    } catch (err) {
      setSaving(false);
      toast.error(err);
    }
  };

  return (
    <div className="comment-editor">
      <textarea
        className="input textarea"
        autoFocus
        rows={3}
        maxLength={COMMENT_LIMIT}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") cancel();
        }}
      />
      <AttachmentList attachments={kept} onRemove={(a) => setRemoved((r) => [...r, a.id])} compact />
      <DraftChips
        drafts={added}
        onRemove={(d) => {
          setAdded((x) => x.filter((y) => y.id !== d.id));
          void api.deleteAttachment({ attachmentId: d.id }).catch(() => undefined);
        }}
      />
      <div className="composer-actions">
        <AttachButton
          iconOnly
          busy={uploading}
          disabled={kept.length + added.length >= 10}
          onClick={async () => {
            const files = await upload({ projectId, taskId: comment.taskId, target: AttachTarget.DRAFT });
            if (files.length) setAdded((x) => [...x, ...files]);
          }}
        />
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" busy={saving} disabled={uploading} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
};

const CommentItem: React.FC<{
  comment: Comment;
  projectId: number;
  canModify: boolean;
  onChanged: () => void;
}> = ({ comment, projectId, canModify, onChanged }) => {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="comment">
      <Avatar userId={comment.authorId} size={30} />
      <div className="comment-main">
        <div className="comment-head">
          <strong><UserName userId={comment.authorId} /></strong>
          <span className="comment-time" title={dateTime(comment.createdAt)}>
            {relativeTime(comment.createdAt)}
            {comment.editedAt > 0 && <span title={`Edited ${dateTime(comment.editedAt)}`}> · edited</span>}
          </span>
          {canModify && !editing && (
            <span className="comment-actions">
              <IconButton label="Edit comment" onClick={() => setEditing(true)}>
                <Pencil size={14} />
              </IconButton>
              <IconButton label="Delete comment" danger onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
              </IconButton>
            </span>
          )}
        </div>
        {editing ? (
          <CommentEditor
            comment={comment}
            projectId={projectId}
            onDone={(saved) => {
              setEditing(false);
              if (saved) onChanged();
            }}
          />
        ) : (
          <>
            {comment.body && <div className="comment-body">{comment.body}</div>}
            <AttachmentList attachments={comment.attachments} compact />
          </>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete comment?"
          message="The comment and any files attached to it will be removed."
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await api.deleteComment({ commentId: comment.id });
              onChanged();
            } catch (err) {
              toast.error(err);
              throw err;
            }
          }}
        />
      )}
    </div>
  );
};

// --- Composer ------------------------------------------------------------------------------

export const CommentComposer: React.FC<{
  taskId: number;
  projectId: number;
  full: boolean;
  onPosted: () => void;
}> = ({ taskId, projectId, full, onPosted }) => {
  const toast = useToast();
  const { me } = useAppState();
  const { upload, uploading } = useAttachmentUpload();
  const [body, setBody] = useState("");
  const [drafts, setDrafts] = useState<Attachment[]>([]);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!body.trim() && drafts.length === 0) return;
    setPosting(true);
    try {
      await api.createComment({ taskId, body: body.trim(), attachmentIds: drafts.map((d) => d.id) });
      setBody("");
      setDrafts([]);
      onPosted();
    } catch (err) {
      toast.error(err);
    } finally {
      setPosting(false);
    }
  };

  if (full) {
    return <div className="composer-full muted">This task has reached the limit of {COMMENTS_PER_TASK} comments.</div>;
  }

  return (
    <div className="composer">
      <Avatar userId={me.userId} size={30} />
      <div className="composer-box">
        <textarea
          className="composer-input"
          rows={2}
          maxLength={COMMENT_LIMIT}
          placeholder="Leave a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
          }}
        />
        <DraftChips
          drafts={drafts}
          onRemove={(d) => {
            setDrafts((x) => x.filter((y) => y.id !== d.id));
            void api.deleteAttachment({ attachmentId: d.id }).catch(() => undefined);
          }}
        />
        <div className="composer-actions">
          <AttachButton
            iconOnly
            label="Attach files to comment"
            busy={uploading}
            disabled={drafts.length >= 10}
            onClick={async () => {
              const files = await upload({ projectId, taskId, target: AttachTarget.DRAFT });
              if (files.length) setDrafts((x) => [...x, ...files].slice(0, 10));
            }}
          />
          {body.length > COMMENT_LIMIT - 200 && (
            <span className="field-counter">
              {body.length}/{COMMENT_LIMIT}
            </span>
          )}
          <span className="spacer" />
          <Button
            variant="primary"
            size="sm"
            busy={posting}
            disabled={uploading || (!body.trim() && drafts.length === 0)}
            onClick={post}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
};

// --- Feed --------------------------------------------------------------------------------------

export const ActivityFeed: React.FC<{
  comments: Comment[];
  activity: Activity[];
  projectId: number;
  canModifyOwn: boolean;
  onChanged: () => void;
}> = ({ comments, activity, projectId, canModifyOwn, onChanged }) => {
  const { me } = useAppState();
  const items = useMemo(() => {
    const all: Array<{ at: number; key: string; node: React.ReactNode }> = [
      ...activity.map((a) => ({ at: a.createdAt, key: `a${a.id}`, node: <HistoryItem key={`a${a.id}`} a={a} /> })),
      ...comments.map((c) => ({
        at: c.createdAt,
        key: `c${c.id}`,
        node: (
          <CommentItem
            key={`c${c.id}`}
            comment={c}
            projectId={projectId}
            canModify={canModifyOwn && c.authorId === me.userId}
            onChanged={onChanged}
          />
        ),
      })),
    ];
    return all.sort((x, y) => x.at - y.at);
  }, [activity, comments, projectId, canModifyOwn, me.userId, onChanged]);
  return <div className="feed">{items.map((i) => i.node)}</div>;
};
