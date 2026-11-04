import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  AccessLevel,
  Attachment,
  AttachTarget,
  GetTaskResponse,
  ProjectChangedEvent,
  TaskChangedEvent,
  TaskSummary,
} from "@tasktrackerplus/gen-shared";
import { api, TaskPatch, TrackerServiceClientEvent, updateTask, useQuery, useTrackerEvent } from "../lib/api";
import { dateTime, dueLabel, dueState, relativeTime, taskKey } from "../lib/format";
import { navigate } from "../lib/router";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { ConfirmDialog, IconButton, Spinner } from "../components/ui";
import { PriorityPicker, StatusPicker, TagChip, TagPicker } from "../components/pickers";
import { Avatar, UserName } from "../components/people";
import { RichText, DESCRIPTION_LIMIT } from "../components/RichText";
import { AssigneePicker } from "../components/AssigneePicker";
import { AttachButton, AttachmentList, useAttachmentUpload } from "../components/attachments";
import { ActivityFeed, CommentComposer, COMMENTS_PER_TASK } from "./TaskActivity";
import { Breadcrumbs, QueryErrorView } from "./common";
import { canEditTask } from "./ProjectBoard";

type SaveState = "idle" | "saving" | "saved" | "error";

const TitleEditor: React.FC<{ value: string; editable: boolean; onSave: (v: string) => Promise<boolean> }> = ({
  value,
  editable,
  onSave,
}) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  if (!editable) return <h1 className="task-title readonly">{value}</h1>;

  const commit = async () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value && !(await onSave(next))) setDraft(value);
  };

  return (
    <textarea
      ref={ref}
      className="task-title"
      rows={1}
      maxLength={512}
      value={draft}
      aria-label="Task name"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        void commit();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          setTimeout(() => ref.current?.blur());
        }
      }}
    />
  );
};

export const TaskDetailView: React.FC<{ projectId: number; taskId: number }> = ({ projectId, taskId }) => {
  const { me, tags, tagsById } = useAppState();
  const toast = useToast();
  const q = useQuery<GetTaskResponse>(() => api.getTask({ taskId }), [taskId]);
  const { upload, uploading } = useAttachmentUpload();
  const [descSave, setDescSave] = useState<SaveState>("idle");
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const descTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingDesc = useRef<{ html: string; length: number } | null>(null);
  const deletedByMe = useRef(false);

  const detail = q.data?.task;
  const project = q.data?.project;
  const summary = detail?.summary;

  useTrackerEvent(TrackerServiceClientEvent.TaskChanged, (e: TaskChangedEvent) => {
    if (e.taskId !== taskId) return;
    if (e.deleted) {
      if (!deletedByMe.current) toast.show("This task was deleted", "info");
      navigate({ name: "project", projectId }, { replace: true });
      return;
    }
    q.reload();
  });
  useTrackerEvent(TrackerServiceClientEvent.ProjectChanged, (e: ProjectChangedEvent) => {
    if (e.projectId === projectId) q.reload();
  });
  useTrackerEvent(TrackerServiceClientEvent.AccessChanged, () => q.reload());

  // Keep the URL canonical if the task lives in a different project.
  useEffect(() => {
    if (summary && summary.projectId !== projectId) {
      navigate({ name: "task", projectId: summary.projectId, taskId }, { replace: true });
    }
  }, [summary, projectId, taskId]);

  const flushDescription = useCallback(async () => {
    if (descTimer.current) clearTimeout(descTimer.current);
    const pending = pendingDesc.current;
    if (!pending) return;
    pendingDesc.current = null;
    if (pending.length > DESCRIPTION_LIMIT) {
      setDescSave("error");
      toast.show("The description is over 10,000 characters and wasn't saved", "error");
      return;
    }
    setDescSave("saving");
    try {
      await updateTask(taskId, { description: pending.html });
      setDescSave("saved");
    } catch (err) {
      setDescSave("error");
      toast.error(err, "Couldn't save the description");
    }
  }, [taskId, toast]);

  // Save any unsaved description when leaving the page.
  useEffect(() => () => void flushDescription(), [flushDescription]);

  if (q.error) {
    return (
      <div className="page">
        <QueryErrorView error={q.error} onRetry={q.reload} what="This task" />
      </div>
    );
  }
  if (!detail || !summary || !project) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }

  const canEdit = canEditTask(project, summary, me.userId);
  const canContribute = !project.archived && project.myAccess >= AccessLevel.CONTRIBUTE;
  const key = taskKey(project.identifier, summary.number);

  const applyLocal = (patch: Partial<TaskSummary>) =>
    q.setData((d) => (d && d.task ? { ...d, task: { ...d.task, summary: { ...d.task.summary!, ...patch } } } : d));

  const update = async (req: TaskPatch, optimistic: Partial<TaskSummary>): Promise<boolean> => {
    applyLocal(optimistic);
    try {
      await updateTask(taskId, req);
      q.reload();
      return true;
    } catch (err) {
      toast.error(err);
      q.reload();
      return false;
    }
  };

  const attachFiles = async () => {
    const files = await upload({ projectId: project.id, taskId, target: AttachTarget.TASK });
    if (files.length) {
      q.setData((d) =>
        d && d.task
          ? {
              ...d,
              task: {
                ...d.task,
                attachments: [...d.task.attachments, ...files],
                summary: { ...d.task.summary!, attachmentCount: d.task.summary!.attachmentCount + files.length },
              },
            }
          : d,
      );
      toast.show(files.length === 1 ? "File attached" : `${files.length} files attached`, "success");
      q.reload();
    }
  };

  const due = summary.dueDate;

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          project.archived ? { label: "Archived projects", to: { name: "archived" } } : { label: "Projects", to: { name: "home" } },
          { label: project.name, to: { name: "project", projectId: project.id } },
          { label: key },
        ]}
      />

      {project.archived && (
        <div className="status-banner">
          <div className="status-banner-title">Archived</div>
          <div className="status-banner-body">This project is archived and read-only.</div>
        </div>
      )}

      <div className="task-layout">
        <div className="task-main">
          <div className="task-key-row">
            <span className="task-key">{key}</span>
            {canEdit && (
              <IconButton label="Delete task" danger className="task-delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} />
              </IconButton>
            )}
          </div>
          <TitleEditor value={summary.name} editable={canEdit} onSave={(name) => update({ name }, { name })} />

          <section className="detail-section">
            <div className="detail-head">
              <h2 className="subsection-label">Description</h2>
              {canEdit && descSave !== "idle" && (
                <span className={`save-state ${descSave}`}>
                  {descSave === "saving" ? "Saving…" : descSave === "saved" ? "Saved" : "Not saved"}
                </span>
              )}
            </div>
            <RichText
              value={detail.description}
              editable={canEdit}
              onChange={(html, length) => {
                pendingDesc.current = { html, length };
                setDescSave("idle");
                if (descTimer.current) clearTimeout(descTimer.current);
                descTimer.current = setTimeout(() => void flushDescription(), 1200);
              }}
              onBlur={() => void flushDescription()}
            />
          </section>

          <section className="detail-section">
            <div className="detail-head">
              <h2 className="subsection-label">
                Attachments {detail.attachments.length > 0 && <span className="count-badge">{detail.attachments.length}</span>}
              </h2>
              {canEdit && <AttachButton onClick={attachFiles} busy={uploading} />}
            </div>
            {detail.attachments.length === 0 ? (
              <div className="muted small">No files attached{canEdit ? " — add images, music, video or any other file." : "."}</div>
            ) : (
              <AttachmentList
                attachments={detail.attachments}
                showUploader
                canRemove={(a) => canEdit || (canContribute && a.uploadedBy === me.userId)}
                onRemove={setRemoving}
              />
            )}
          </section>

          <section className="detail-section">
            <div className="detail-head">
              <h2 className="subsection-label">Activity</h2>
              {detail.comments.length > 0 && (
                <span className="muted small">
                  {detail.comments.length}/{COMMENTS_PER_TASK} comments
                </span>
              )}
            </div>
            <ActivityFeed
              comments={detail.comments}
              activity={detail.activity}
              projectId={project.id}
              canModifyOwn={!project.archived}
              onChanged={q.reload}
            />
            {canContribute && (
              <CommentComposer
                taskId={taskId}
                projectId={project.id}
                full={detail.comments.length >= COMMENTS_PER_TASK}
                onPosted={q.reload}
              />
            )}
          </section>
        </div>

        <aside className="task-side">
          <div className="side-field">
            <span className="side-label">Status</span>
            <StatusPicker
              status={summary.status}
              variant="field"
              disabled={!canEdit}
              onChange={(status) => void update({ status }, { status })}
            />
          </div>
          <div className="side-field">
            <span className="side-label">Priority</span>
            <PriorityPicker
              priority={summary.priority}
              variant="field"
              disabled={!canEdit}
              onChange={(priority) => void update({ priority }, { priority })}
            />
          </div>
          <div className="side-field">
            <span className="side-label">Assignee</span>
            <AssigneePicker
              value={summary.assignee}
              disabled={!canEdit}
              onChange={(next) =>
                void (next
                  ? update({ assignee: next }, { assignee: next })
                  : update({ clearAssignee: true }, { assignee: undefined }))
              }
            />
          </div>
          <div className="side-field side-field-block">
            <span className="side-label">Tags</span>
            <div className="chips">
              {summary.tagIds.map((id) => {
                const t = tagsById.get(id);
                return t ? (
                  <TagChip
                    key={id}
                    tag={t}
                    onRemove={
                      canEdit
                        ? () => {
                            const next = summary.tagIds.filter((x) => x !== id);
                            void update({ setTags: true, tagIds: next }, { tagIds: next });
                          }
                        : undefined
                    }
                  />
                ) : null;
              })}
              {summary.tagIds.filter((id) => tagsById.has(id)).length === 0 && !canEdit && <span className="muted">No tags</span>}
              {canEdit && (
                <TagPicker
                  tags={tags}
                  selected={summary.tagIds.filter((id) => tagsById.has(id))}
                  canManageTags={me.canManageTags}
                  onChange={(next) => void update({ setTags: true, tagIds: next }, { tagIds: next })}
                />
              )}
            </div>
          </div>
          <div className="side-field">
            <span className="side-label">Due date</span>
            {canEdit ? (
              <div className="date-field">
                <input
                  type="date"
                  className={`input input-sm due-input due-${dueState(due)}`}
                  value={due}
                  onChange={(e) => void update({ dueDate: e.target.value }, { dueDate: e.target.value })}
                />
                {due && (
                  <button type="button" className="link-quiet" onClick={() => void update({ dueDate: "" }, { dueDate: "" })}>
                    Clear
                  </button>
                )}
              </div>
            ) : (
              <span className={due ? `due-text due-${dueState(due)}` : "muted"}>{due ? dueLabel(due) : "None"}</span>
            )}
          </div>
          <div className="side-divider" />
          <div className="side-field">
            <span className="side-label">Created by</span>
            <span className="person">
              <Avatar userId={summary.createdBy} size={20} />
              <UserName userId={summary.createdBy} />
            </span>
          </div>
          <div className="side-field">
            <span className="side-label">Created</span>
            <span title={dateTime(summary.createdAt)}>{relativeTime(summary.createdAt)}</span>
          </div>
          <div className="side-field">
            <span className="side-label">Updated</span>
            <span title={dateTime(summary.updatedAt)}>{relativeTime(summary.updatedAt)}</span>
          </div>
        </aside>
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove file?"
          message={
            <>
              <strong>{removing.fileName}</strong> will be removed from this task.
            </>
          }
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.deleteAttachment({ attachmentId: removing.id });
              q.reload();
            } catch (err) {
              toast.error(err);
              throw err;
            }
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete task?"
          message={
            <>
              <strong>{key}</strong> will be deleted along with its comments, attachments and history.
            </>
          }
          confirmLabel="Delete task"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              deletedByMe.current = true;
              await api.deleteTask({ taskId });
              toast.show("Task deleted", "success");
              navigate({ name: "project", projectId: project.id }, { replace: true });
            } catch (err) {
              deletedByMe.current = false;
              toast.error(err);
              throw err;
            }
          }}
        />
      )}
    </div>
  );
};
