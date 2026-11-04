import React, { useMemo, useRef, useState } from "react";
import { Check, Plus, Search, Tag as TagIcon } from "lucide-react";
import { Tag, TaskPriority, TaskStatus } from "@tasktrackerplus/gen-shared";
import { PHASES, PRIORITIES, phase, priorityMeta } from "../lib/phases";
import { PriorityIcon, StatusIcon } from "./icons";
import { Popover } from "./ui";
import { Link } from "../lib/router";

// --- Status ---------------------------------------------------------------------

export const StatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const meta = phase(status);
  return (
    <span className="status-badge" style={{ "--phase": meta.color } as React.CSSProperties}>
      <StatusIcon status={status} size={12} />
      <span>{meta.label}</span>
    </span>
  );
};

export const StatusPicker: React.FC<{
  status: TaskStatus;
  onChange: (s: TaskStatus) => void;
  disabled?: boolean;
  variant?: "badge" | "field" | "icon";
}> = ({ status, onChange, disabled, variant = "badge" }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const meta = phase(status);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`picker-trigger picker-${variant}`}
        disabled={disabled}
        title={disabled ? meta.label : `Status: ${meta.label}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {variant === "icon" ? (
          <StatusIcon status={status} />
        ) : variant === "badge" ? (
          <StatusBadge status={status} />
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{meta.label}</span>
          </>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={200}>
        <div className="menu" role="menu">
          {PHASES.map((p) => (
            <button
              key={p.status}
              type="button"
              role="menuitemradio"
              aria-checked={p.status === status}
              className="menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (p.status !== status) onChange(p.status);
              }}
            >
              <span className="menu-icon">
                <StatusIcon status={p.status} />
              </span>
              <span className="menu-label">{p.label}</span>
              {p.status === status && <Check size={14} className="menu-check" />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
};

// --- Priority -----------------------------------------------------------------------

export const PriorityPicker: React.FC<{
  priority: TaskPriority;
  onChange: (p: TaskPriority) => void;
  disabled?: boolean;
  variant?: "icon" | "field";
}> = ({ priority, onChange, disabled, variant = "icon" }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const meta = priorityMeta(priority);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`picker-trigger picker-${variant}`}
        disabled={disabled}
        title={`Priority: ${meta.label}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <PriorityIcon priority={priority} />
        {variant === "field" && <span>{meta.label}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={230}>
        <div className="menu" role="menu">
          {PRIORITIES.map((p) => (
            <button
              key={p.priority}
              type="button"
              role="menuitemradio"
              aria-checked={p.priority === priority}
              className="menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (p.priority !== priority) onChange(p.priority);
              }}
            >
              <span className="menu-icon">
                <PriorityIcon priority={p.priority} />
              </span>
              <span className="menu-label">{p.label}</span>
              <span className="menu-hint">{p.description}</span>
              {p.priority === priority && <Check size={14} className="menu-check" />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
};

// --- Tags ----------------------------------------------------------------------------

export const TagChip: React.FC<{ tag: Tag; onRemove?: () => void }> = ({ tag, onRemove }) => (
  <span className="tag-chip" style={{ "--tag": tag.color } as React.CSSProperties}>
    <span className="tag-dot" />
    <span className="tag-name">{tag.name}</span>
    {onRemove && (
      <button
        type="button"
        className="tag-remove"
        aria-label={`Remove ${tag.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    )}
  </span>
);

export const TagPicker: React.FC<{
  tags: Tag[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  max?: number;
  canManageTags?: boolean;
  trigger?: "button" | "plus";
}> = ({ tags, selected, onChange, disabled, max = 20, canManageTags, trigger = "plus" }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(
    () => tags.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())),
    [tags, query],
  );
  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < max) onChange([...selected, id]);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={trigger === "plus" ? "chip-add" : "btn btn-quiet btn-sm"}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger === "plus" ? <Plus size={14} /> : <TagIcon size={14} />}
        <span>{trigger === "plus" ? "Add tag" : "Tags"}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={260}>
        <div className="picker-search">
          <Search size={14} />
          <input
            autoFocus
            placeholder="Search tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="menu" role="listbox" aria-multiselectable="true">
          {filtered.length === 0 && <div className="menu-empty">{tags.length === 0 ? "No tags yet" : "No matching tags"}</div>}
          {filtered.map((t) => {
            const on = selected.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={on}
                className="menu-item"
                disabled={!on && selected.length >= max}
                onClick={() => toggle(t.id)}
              >
                <span className={`check-box ${on ? "on" : ""}`}>{on && <Check size={12} />}</span>
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="menu-label">{t.name}</span>
              </button>
            );
          })}
        </div>
        {canManageTags && (
          <div className="menu-footer">
            <Link to={{ name: "tags" }} onClick={() => setOpen(false)}>
              Manage tags
            </Link>
          </div>
        )}
      </Popover>
    </>
  );
};
