import React, { useEffect, useMemo, useState } from "react";
import { rootClient } from "@rootsdk/client-app";
import { ImagePlus, Trash2 } from "lucide-react";
import { ProjectPermissions, ProjectSummary } from "@tasktrackerplus/gen-shared";
import { api } from "../lib/api";
import { deriveIdentifier } from "../lib/format";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, Field, Modal, Spinner } from "../components/ui";
import { ProjectAvatar } from "../components/project";
import { RootUserRoleSelector } from "../components/RootUserRoleSelector";

// Well-known Root GUID of the community's "Everyone" role (same value as
// WellKnownRootGuids.CommunityRoles.EveryoneRole in the server SDK).
export const EVERYONE_ROLE_ID = "ACTAwpQAgAuAAAAAAAAAAQ";

const LIMITS = { name: 100, description: 5000 };

type Tab = "general" | "permissions";

interface Props {
  project?: ProjectSummary; // edit mode when set
  onClose: () => void;
  onSaved?: (p: ProjectSummary) => void;
}

const ACCESS_SECTIONS: Array<{ key: keyof ProjectPermissions; title: string; description: string }> = [
  {
    key: "view",
    title: "View only",
    description: "Can view the project and its tasks but can't make changes.",
  },
  {
    key: "contribute",
    title: "Contribute tasks",
    description: "Can also create tasks and edit or delete their own tasks.",
  },
  {
    key: "manage",
    title: "Manage all tasks",
    description: "Full access: any task, project settings, and deleting the project.",
  },
];

export const ProjectDialog: React.FC<Props> = ({ project, onClose, onSaved }) => {
  const { me } = useAppState();
  const toast = useToast();
  const editing = !!project;
  const [tab, setTab] = useState<Tab>("general");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [identifier, setIdentifier] = useState(project?.identifier ?? "");
  const [identifierTouched, setIdentifierTouched] = useState(editing);
  const [imageToken, setImageToken] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [permissions, setPermissions] = useState<ProjectPermissions | undefined>(
    editing
      ? undefined
      : {
          view: { userIds: [], roleIds: [] },
          contribute: { userIds: [], roleIds: [EVERYONE_ROLE_ID] },
          manage: { userIds: me.userId ? [me.userId] : [], roleIds: [] },
        },
  );
  const [loadingPerms, setLoadingPerms] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!project) return;
    let alive = true;
    api.getProject({ projectId: project.id }).then(
      (r) => {
        if (!alive) return;
        setPermissions(
          r.permissions ?? {
            view: { userIds: [], roleIds: [] },
            contribute: { userIds: [], roleIds: [] },
            manage: { userIds: [], roleIds: [] },
          },
        );
        setLoadingPerms(false);
      },
      (err) => {
        if (!alive) return;
        toast.error(err);
        setLoadingPerms(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [project, toast]);

  const effectiveIdentifier = identifierTouched ? identifier : deriveIdentifier(name);
  const previewUrl = useMemo(() => (imageToken ? rootClient.assets.toUploadImagePreview(imageToken) : undefined), [imageToken]);
  const currentImage = removeImage ? "" : project?.imageUri ?? "";

  const pickImage = async () => {
    try {
      const res = await rootClient.assets.fileUpload({ fileType: "imageAll", multiple: false, windowTitle: "Project image" });
      if (res.tokens?.[0]) {
        setImageToken(res.tokens[0]);
        setRemoveImage(false);
      }
    } catch (err) {
      toast.error(err, "Couldn't open the file picker");
    }
  };

  const manageEmpty =
    !!permissions && permissions.manage!.userIds.length === 0 && permissions.manage!.roleIds.length === 0;

  const submit = async () => {
    setError(undefined);
    if (!name.trim()) {
      setTab("general");
      return setError("Project name is required");
    }
    if (!/^[A-Za-z0-9]{1,4}$/.test(effectiveIdentifier)) {
      setTab("general");
      return setError("The identifier needs 1–4 letters or numbers");
    }
    if (manageEmpty) {
      setTab("permissions");
      return setError("Manage all tasks needs at least one member or role");
    }
    setSaving(true);
    try {
      const common = {
        name: name.trim(),
        description: description.trim(),
        identifier: effectiveIdentifier.toUpperCase(),
        imageToken,
        permissions,
      };
      const saved = editing
        ? (await api.updateProject({ projectId: project!.id, ...common, removeImage })).project
        : (await api.createProject(common)).project;
      if (saved) onSaved?.(saved);
      toast.show(editing ? "Project updated" : "Project created", "success");
      onClose();
    } catch (err) {
      setSaving(false);
      toast.error(err);
    }
  };

  const setSelection = (key: keyof ProjectPermissions, userIds: string[], roleIds: string[]) =>
    setPermissions((p) => (p ? { ...p, [key]: { userIds, roleIds } } : p));

  return (
    <Modal
      title={editing ? "Project settings" : "New project"}
      onClose={saving ? () => undefined : onClose}
      width={620}
      footer={
        <>
          {error && <span className="footer-error">{error}</span>}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" busy={saving} onClick={submit} disabled={loadingPerms}>
            {editing ? "Update" : "Create"}
          </Button>
        </>
      }
    >
      <div className="tab-bar" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === "general"} onClick={() => setTab("general")}>
          General
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === "permissions"} onClick={() => setTab("permissions")}>
          Permissions
        </button>
      </div>

      {tab === "general" && (
        <div className="form-stack">
          <Field label="Project name" htmlFor="pd-name" counter={`${name.length}/${LIMITS.name}`}>
            <input
              id="pd-name"
              className="input"
              data-autofocus
              maxLength={LIMITS.name}
              value={name}
              placeholder="e.g. Website Redesign"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="pd-desc" counter={description.length > 4000 ? `${description.length}/${LIMITS.description}` : undefined}>
            <textarea
              id="pd-desc"
              className="input textarea"
              rows={3}
              maxLength={LIMITS.description}
              value={description}
              placeholder="What is this project about? (optional)"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Project identifier"
            htmlFor="pd-id"
            hint={`Used to label tasks, e.g. ${effectiveIdentifier || "PROJ"}-1. Up to 4 letters or numbers.`}
          >
            <input
              id="pd-id"
              className="input input-identifier"
              maxLength={4}
              value={effectiveIdentifier}
              placeholder="PROJ"
              onChange={(e) => {
                setIdentifierTouched(true);
                setIdentifier(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4));
              }}
            />
          </Field>
          <Field label="Project image">
            <div className="image-field">
              {previewUrl ? (
                <img className="project-avatar" style={{ width: 56, height: 56 }} src={previewUrl} alt="" />
              ) : (
                <ProjectAvatar imageUri={imageToken ? "" : currentImage} size={56} />
              )}
              <Button variant="quiet" size="sm" icon={<ImagePlus size={15} />} onClick={pickImage}>
                {currentImage || imageToken ? "Change image" : "Upload image"}
              </Button>
              {(currentImage || imageToken) && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={15} />}
                  onClick={() => {
                    setImageToken("");
                    setRemoveImage(true);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </Field>
        </div>
      )}

      {tab === "permissions" && (
        <div className="form-stack">
          {loadingPerms || !permissions ? (
            <Spinner />
          ) : (
            ACCESS_SECTIONS.map((s) => (
              <div key={s.key} className="perm-section">
                <div className="perm-title">{s.title}</div>
                <div className="perm-desc">{s.description}</div>
                <RootUserRoleSelector
                  mode="multi"
                  selectedUserIds={permissions[s.key]!.userIds}
                  selectedRoleIds={permissions[s.key]!.roleIds}
                  onSelectionChange={(d) => setSelection(s.key, d.selectedUserIds, d.selectedRoleIds)}
                />
                {s.key === "manage" && manageEmpty && <div className="field-error">Pick at least one member or role.</div>}
              </div>
            ))
          )}
          <p className="perm-note">Members who aren't in any of these groups can't see the project.</p>
        </div>
      )}
    </Modal>
  );
};
