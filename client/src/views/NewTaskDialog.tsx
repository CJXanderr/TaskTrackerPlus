import React, { useRef, useState } from "react";
import { Attachment, AssigneeKind, AttachTarget, ProjectSummary, TaskPriority, TaskStatus, TaskSummary } from "@tasktrackerplus/gen-shared";
import { api } from "../lib/api";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, Field, Modal } from "../components/ui";
import { PriorityPicker, StatusPicker, TagChip, TagPicker } from "../components/pickers";
import { RichText, DESCRIPTION_LIMIT } from "../components/RichText";
import { AssigneePicker } from "../components/AssigneePicker";
import { AttachButton, DraftChips, useAttachmentUpload } from "../components/attachments";

const NAME_LIMIT = 512;

export const NewTaskDialog: React.FC<{
  project: ProjectSummary;
  initialStatus?: TaskStatus;
  onClose: () => void;
  onCreated: (t: TaskSummary) => void;
}> = ({ project, initialStatus = TaskStatus.PLANNED, onClose, onCreated }) => {
  const { tags, tagsById, me } = useAppState();
  const toast = useToast();
  const { upload, uploading } = useAttachmentUpload();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [descLength, setDescLength] = useState(0);
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MID);
  const [assignee, setAssignee] = useState<{ kind: AssigneeKind; id: string }>({ kind: AssigneeKind.NONE, id: "" });
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [drafts, setDrafts] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const created = useRef(false);

  const discardDrafts = () => {
    if (created.current) return;
    for (const d of drafts) void api.deleteAttachment({ attachmentId: d.id }).catch(() => undefined);
  };

  const close = () => {
    discardDrafts();
    onClose();
  };

  const submit = async () => {
    setError(undefined);
    if (!name.trim()) return setError("Give the task a name");
    if (descLength > DESCRIPTION_LIMIT) return setError("The description is over 10,000 characters");
    setSaving(true);
    try {
      const res = await api.createTask({
        projectId: project.id,
        name: name.trim(),
        description,
        status,
        priority,
        assignee: assignee.kind === AssigneeKind.NONE ? undefined : assignee,
        tagIds,
        dueDate,
        attachmentIds: drafts.map((d) => d.id),
      });
      created.current = true;
      if (res.task) onCreated(res.task);
      toast.show("Task created", "success");
      onClose();
    } catch (err) {
      setSaving(false);
      toast.error(err);
    }
  };

  const attach = async () => {
    const added = await upload({ projectId: project.id, target: AttachTarget.DRAFT });
    if (added.length) setDrafts((d) => [...d, ...added]);
  };

  return (
    <Modal
      title={`New task · ${project.name}`}
      onClose={saving ? () => undefined : close}
      width={680}
      footer={
        <>
          {error && <span className="footer-error">{error}</span>}
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" busy={saving} disabled={uploading} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="Name" htmlFor="nt-name" counter={name.length > NAME_LIMIT - 60 ? `${name.length}/${NAME_LIMIT}` : undefined}>
          <input
            id="nt-name"
            className="input"
            data-autofocus
            maxLength={NAME_LIMIT}
            placeholder="A short summary of the work"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
        </Field>
        <Field label="Description">
          <RichText
            value={description}
            editable
            onChange={(html, len) => {
              setDescription(html);
              setDescLength(len);
            }}
          />
        </Field>

        <div className="form-grid">
          <Field label="Status">
            <StatusPicker status={status} onChange={setStatus} variant="field" />
          </Field>
          <Field label="Priority">
            <PriorityPicker priority={priority} onChange={setPriority} variant="field" />
          </Field>
          <Field label="Due date" htmlFor="nt-due">
            <div className="date-field">
              <input id="nt-due" type="date" className="input input-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {dueDate && (
                <button type="button" className="link-quiet" onClick={() => setDueDate("")}>
                  Clear
                </button>
              )}
            </div>
          </Field>
        </div>

        <Field label="Assignee" hint="A member or a role responsible for the task.">
          <AssigneePicker
            value={assignee.kind === AssigneeKind.NONE ? undefined : assignee}
            onChange={(next) => setAssignee(next ?? { kind: AssigneeKind.NONE, id: "" })}
          />
        </Field>

        <Field label="Tags">
          <div className="chips">
            {tagIds.map((id) => {
              const t = tagsById.get(id);
              return t ? <TagChip key={id} tag={t} onRemove={() => setTagIds((x) => x.filter((y) => y !== id))} /> : null;
            })}
            <TagPicker tags={tags} selected={tagIds} onChange={setTagIds} canManageTags={me.canManageTags} />
          </div>
        </Field>

        <Field label="Attachments" hint="Any file type — images, audio, video, documents.">
          <div className="attach-field">
            <DraftChips
              drafts={drafts}
              onRemove={(d) => {
                setDrafts((x) => x.filter((y) => y.id !== d.id));
                void api.deleteAttachment({ attachmentId: d.id }).catch(() => undefined);
              }}
            />
            <AttachButton onClick={attach} busy={uploading} />
          </div>
        </Field>
      </div>
    </Modal>
  );
};
