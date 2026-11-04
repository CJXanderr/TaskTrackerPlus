import React, { useState } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { Tag } from "@tasktrackerplus/gen-shared";
import { api } from "../lib/api";
import { TAG_SWATCHES } from "../lib/phases";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, ConfirmDialog, EmptyState, IconButton } from "../components/ui";
import { TagChip } from "../components/pickers";
import { Breadcrumbs } from "./common";

const NAME_LIMIT = 80;
const DEFAULT_COLOR = "#84CC16";

const TagForm: React.FC<{
  initial?: Tag;
  onCancel: () => void;
  onSaved: () => void;
}> = ({ initial, onCancel, onSaved }) => {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return setError("Give the tag a name");
    if (!/^[\p{L}\p{N} ]+$/u.test(clean)) return setError("Use letters, numbers and spaces only");
    setSaving(true);
    try {
      if (initial) await api.updateTag({ tagId: initial.id, name: clean, color });
      else await api.createTag({ name: clean, color });
      onSaved();
    } catch (err) {
      setSaving(false);
      toast.error(err);
    }
  };

  return (
    <div className="tag-form">
      <div className="tag-form-row">
        <span className="tag-preview">
          <TagChip tag={{ id: 0, name: name.trim() || "Tag name", color }} />
        </span>
        <input
          className="input input-sm"
          autoFocus
          maxLength={NAME_LIMIT}
          placeholder="Tag name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {TAG_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color.toUpperCase() === c}
            aria-label={c}
            className={`swatch ${color.toUpperCase() === c ? "on" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <label className="swatch-custom" title="Custom color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} />
          <span>{color.toUpperCase()}</span>
        </label>
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="tag-form-actions">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" busy={saving} onClick={save}>
          {initial ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
};

export const TagsPage: React.FC = () => {
  const { tags, reloadTags, me } = useAppState();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const canManage = me.canManageTags;

  return (
    <div className="page page-narrow">
      <Breadcrumbs items={[{ label: "Projects", to: { name: "home" } }, { label: "Tags" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Tags</h1>
          <p className="page-subtitle">Colored labels shared across every project in this community.</p>
        </div>
        {canManage && !creating && (
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            New tag
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="status-banner">
          <div className="status-banner-body">
            Admins, project creators and members who can contribute to a project can manage tags.
          </div>
        </div>
      )}

      {creating && (
        <div className="panel">
          <TagForm
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              reloadTags();
              toast.show("Tag created", "success");
            }}
          />
        </div>
      )}

      {tags.length === 0 && !creating ? (
        <EmptyState icon={<Tags size={28} />} title="No tags yet">
          {canManage ? "Create tags like Bug, Feature or Design to categorize tasks." : "Tags will show up here."}
        </EmptyState>
      ) : (
        <div className="panel list-panel">
          {tags.map((t) =>
            editing === t.id ? (
              <div key={t.id} className="tag-row editing">
                <TagForm
                  initial={t}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    reloadTags();
                  }}
                />
              </div>
            ) : (
              <div key={t.id} className="tag-row">
                <TagChip tag={t} />
                <span className="spacer" />
                {canManage && (
                  <>
                    <IconButton label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={`Delete ${t.name}`} danger onClick={() => setDeleting(t)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete tag?"
          message={
            <>
              <strong>{deleting.name}</strong> will be removed from every task that uses it.
            </>
          }
          confirmLabel="Delete tag"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.deleteTag({ tagId: deleting.id });
              reloadTags();
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
