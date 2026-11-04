import React, { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Archive, Ellipsis, Filter, MessageSquare, Paperclip, Plus, Search, Star, X } from "lucide-react";
import {
  AccessLevel,
  ProjectChangedEvent,
  ProjectSummary,
  TaskChangedEvent,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from "@tasktrackerplus/gen-shared";
import { api, TrackerServiceClientEvent, updateTask, useQuery, useTrackerEvent } from "../lib/api";
import { PHASES } from "../lib/phases";
import { taskKey } from "../lib/format";
import { navigate } from "../lib/router";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, EmptyState, IconButton, MenuButton, Popover, Spinner } from "../components/ui";
import { StatusIcon } from "../components/icons";
import { PriorityPicker, StatusPicker, TagChip } from "../components/pickers";
import { AssigneeView } from "../components/people";
import { AccessChip, PhaseBar, ProjectAvatar } from "../components/project";
import { NewTaskDialog } from "./NewTaskDialog";
import { DueChip } from "./MyTasks";
import { toggleFavorite, useProjectActions } from "./ProjectsSection";
import { Breadcrumbs, QueryErrorView } from "./common";

export function canEditTask(project: ProjectSummary, task: TaskSummary, userId: string): boolean {
  if (project.archived) return false;
  return (
    project.myAccess >= AccessLevel.MANAGE ||
    (project.myAccess >= AccessLevel.CONTRIBUTE && task.createdBy === userId)
  );
}

function sortTasks(a: TaskSummary, b: TaskSummary): number {
  return b.priority - a.priority || a.number - b.number;
}

// --- Row ------------------------------------------------------------------------

interface RowProps {
  task: TaskSummary;
  project: ProjectSummary;
  editable: boolean;
  onPatch: (task: TaskSummary, patch: { status?: TaskStatus; priority?: TaskPriority }) => void;
  overlay?: boolean;
}

const TaskRowView: React.FC<RowProps & { dragProps?: React.HTMLAttributes<HTMLDivElement>; dragRef?: (el: HTMLElement | null) => void; dragging?: boolean }> = ({
  task,
  project,
  editable,
  onPatch,
  overlay,
  dragProps,
  dragRef,
  dragging,
}) => {
  const { tagsById } = useAppState();
  const tags = task.tagIds.map((id) => tagsById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  const open = () => navigate({ name: "task", projectId: task.projectId, taskId: task.id });
  // Ignore events bubbling up (through React portals) from picker popovers.
  const fromRow = (e: React.SyntheticEvent) => (e.currentTarget as Node).contains(e.target as Node);
  return (
    <div
      ref={dragRef}
      className={`task-row ${dragging ? "dragging" : ""} ${overlay ? "overlay" : ""} ${editable ? "draggable" : ""}`}
      role="link"
      tabIndex={0}
      {...dragProps}
      onClick={(e) => {
        if (fromRow(e)) open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) open();
      }}
    >
      <PriorityPicker priority={task.priority} disabled={!editable} onChange={(priority) => onPatch(task, { priority })} />
      <span className="task-key">{taskKey(project.identifier, task.number)}</span>
      <span className="task-name">{task.name}</span>
      <span className="task-row-meta">
        {tags.slice(0, 3).map((t) => (
          <TagChip key={t.id} tag={t} />
        ))}
        {tags.length > 3 && <span className="more-chip">+{tags.length - 3}</span>}
        {task.attachmentCount > 0 && (
          <span className="count-chip" title={`${task.attachmentCount} attachment(s)`}>
            <Paperclip size={12} />
            {task.attachmentCount}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="count-chip" title={`${task.commentCount} comment(s)`}>
            <MessageSquare size={12} />
            {task.commentCount}
          </span>
        )}
        <DueChip due={task.dueDate} />
        <span className="hide-narrow">
          <StatusPicker status={task.status} disabled={!editable} onChange={(status) => onPatch(task, { status })} />
        </span>
        <AssigneeView assignee={task.assignee} compact />
      </span>
    </div>
  );
};

const DraggableRow: React.FC<RowProps> = (props) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${props.task.id}`,
    data: { task: props.task },
    disabled: !props.editable,
  });
  // Keep the row a link for keyboard users; dnd-kit's role="button" would override it.
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;
  void _role;
  void _tabIndex;
  // Only start drags from the row itself, not from a picker popover rendered
  // through a portal (React still bubbles those events to the row).
  const safeListeners = useMemo(() => {
    const out: Record<string, (e: React.SyntheticEvent) => void> = {};
    for (const [name, fn] of Object.entries(listeners ?? {})) {
      out[name] = (e) => {
        if ((e.currentTarget as Node).contains(e.target as Node)) (fn as (ev: React.SyntheticEvent) => void)(e);
      };
    }
    return out as React.HTMLAttributes<HTMLDivElement>;
  }, [listeners]);
  return (
    <TaskRowView
      {...props}
      dragRef={setNodeRef}
      dragging={isDragging}
      dragProps={{ ...dragAttributes, ...safeListeners }}
    />
  );
};

// --- Phase group -------------------------------------------------------------------------

const PhaseGroup: React.FC<{
  status: TaskStatus;
  label: string;
  tasks: TaskSummary[];
  project: ProjectSummary;
  userId: string;
  canAdd: boolean;
  onAdd: (status: TaskStatus) => void;
  onPatch: RowProps["onPatch"];
  dragging: boolean;
}> = ({ status, label, tasks, project, userId, canAdd, onAdd, onPatch, dragging }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `phase-${status}`, data: { status } });
  return (
    <section ref={setNodeRef} className={`phase-group ${isOver ? "drop-over" : ""} ${dragging ? "drop-ready" : ""}`}>
      <div className="phase-head">
        <StatusIcon status={status} />
        <span className="phase-label">{label}</span>
        <span className="phase-count">{tasks.length}</span>
        {canAdd && (
          <IconButton label={`New task in ${label}`} className="phase-add" onClick={() => onAdd(status)}>
            <Plus size={15} />
          </IconButton>
        )}
      </div>
      {tasks.length > 0 && (
        <div className="phase-rows">
          {tasks.map((t) => (
            <DraggableRow key={t.id} task={t} project={project} editable={canEditTask(project, t, userId)} onPatch={onPatch} />
          ))}
        </div>
      )}
    </section>
  );
};

// --- Tag filter -----------------------------------------------------------------------------

const TagFilter: React.FC<{ selected: number[]; onChange: (ids: number[]) => void }> = ({ selected, onChange }) => {
  const { tags } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`btn btn-outline btn-sm ${selected.length ? "btn-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Filter size={14} />
        <span>{selected.length ? `Tags · ${selected.length}` : "Tags"}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={240}>
        <div className="menu">
          {tags.length === 0 && <div className="menu-empty">No tags yet</div>}
          {tags.map((t) => {
            const on = selected.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className="menu-item"
                role="option"
                aria-selected={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              >
                <span className={`check-box ${on ? "on" : ""}`}>{on && "✓"}</span>
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="menu-label">{t.name}</span>
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="menu-footer">
            <button type="button" className="link-quiet" onClick={() => onChange([])}>
              Clear filter
            </button>
          </div>
        )}
      </Popover>
    </>
  );
};

// --- Board ------------------------------------------------------------------------------------

export const ProjectBoard: React.FC<{ projectId: number }> = ({ projectId }) => {
  const { me } = useAppState();
  const toast = useToast();
  const projectQ = useQuery(() => api.getProject({ projectId }).then((r) => r.project!), [projectId]);
  const tasksQ = useQuery(() => api.listTasks({ projectId }).then((r) => r.tasks), [projectId]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus | null>(null);
  const [active, setActive] = useState<TaskSummary | null>(null);
  const project = projectQ.data;
  const { items, dialogs } = useProjectActions(project, { deleted: () => navigate({ name: "home" }) });

  useTrackerEvent(TrackerServiceClientEvent.TaskChanged, (e: TaskChangedEvent) => {
    if (e.projectId !== projectId) return;
    tasksQ.setData((list) => {
      if (!list) return list;
      if (e.deleted || !e.task) return list.filter((t) => t.id !== e.taskId);
      const exists = list.some((t) => t.id === e.taskId);
      return exists ? list.map((t) => (t.id === e.taskId ? e.task! : t)) : [...list, e.task];
    });
    projectQ.setData((p) => (p ? { ...p, counts: e.counts ?? p.counts, updatedAt: e.projectUpdatedAt || p.updatedAt } : p));
  });
  useTrackerEvent(TrackerServiceClientEvent.ProjectChanged, (e: ProjectChangedEvent) => {
    if (e.projectId !== projectId) return;
    projectQ.reload();
    tasksQ.reload();
  });
  useTrackerEvent(TrackerServiceClientEvent.AccessChanged, () => {
    projectQ.reload();
    tasksQ.reload();
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tasksQ.data ?? []).filter((t) => {
      if (tagFilter.length && !t.tagIds.some((id) => tagFilter.includes(id))) return false;
      if (!term) return true;
      return (
        t.name.toLowerCase().includes(term) ||
        (project ? taskKey(project.identifier, t.number).toLowerCase().includes(term) : false)
      );
    });
  }, [tasksQ.data, search, tagFilter, project]);

  const groups = useMemo(() => {
    const map = new Map<TaskStatus, TaskSummary[]>();
    for (const p of PHASES) map.set(p.status, []);
    for (const t of filtered) map.get(t.status)?.push(t);
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [filtered]);

  const patchTask = async (task: TaskSummary, patch: { status?: TaskStatus; priority?: TaskPriority }) => {
    tasksQ.setData((list) => list?.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    try {
      const res = await updateTask(task.id, patch);
      if (res.task) tasksQ.setData((list) => list?.map((t) => (t.id === task.id ? res.task! : t)));
    } catch (err) {
      toast.error(err);
      tasksQ.reload();
    }
  };

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current?.task as TaskSummary) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const task = e.active.data.current?.task as TaskSummary | undefined;
    const status = e.over?.data.current?.status as TaskStatus | undefined;
    if (task && status && status !== task.status) void patchTask(task, { status });
  };

  if (projectQ.error) {
    return (
      <div className="page">
        <QueryErrorView error={projectQ.error} onRetry={projectQ.reload} what="This project" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }

  const canContribute = !project.archived && project.myAccess >= AccessLevel.CONTRIBUTE;
  const onFavorite = async () => {
    projectQ.setData((p) => (p ? { ...p, favorite: !p.favorite } : p));
    if (!(await toggleFavorite(project, toast))) projectQ.reload();
  };

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          project.archived ? { label: "Archived projects", to: { name: "archived" } } : { label: "Projects", to: { name: "home" } },
          { label: project.name },
        ]}
      />

      <div className="board-head">
        <ProjectAvatar imageUri={project.imageUri} size={44} />
        <div className="board-title">
          <div className="board-name-row">
            <h1 className="page-title">{project.name}</h1>
            <span className="identifier-pill">{project.identifier}</span>
          </div>
          {project.description && <p className="board-desc">{project.description}</p>}
        </div>
        <div className="board-actions">
          <AccessChip access={project.myAccess} />
          <IconButton
            label={project.favorite ? "Remove from favorites" : "Add to favorites"}
            className={`star ${project.favorite ? "on" : ""}`}
            onClick={onFavorite}
          >
            <Star size={17} />
          </IconButton>
          <MenuButton label="Project menu" items={items}>
            <Ellipsis size={17} />
          </MenuButton>
        </div>
      </div>
      <PhaseBar counts={project.counts} showLegend />

      {project.archived && (
        <div className="status-banner">
          <div className="status-banner-title">
            <Archive size={13} /> Archived
          </div>
          <div className="status-banner-body">This project is archived and read-only.</div>
        </div>
      )}

      <div className="board-toolbar">
        <div className="search-box">
          <Search size={15} />
          <input placeholder="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <TagFilter selected={tagFilter} onChange={setTagFilter} />
        <div className="spacer" />
        {canContribute && (
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setNewTaskStatus(TaskStatus.PLANNED)}>
            New task
          </Button>
        )}
      </div>

      {tasksQ.loading ? (
        <Spinner />
      ) : tasksQ.error ? (
        <QueryErrorView error={tasksQ.error} onRetry={tasksQ.reload} />
      ) : (tasksQ.data ?? []).length === 0 ? (
        <EmptyState icon={<StatusIcon status={TaskStatus.PLANNED} size={26} />} title="No tasks yet">
          {canContribute ? (
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setNewTaskStatus(TaskStatus.PLANNED)}>
              Create the first task
            </Button>
          ) : (
            "Tasks in this project will show up here."
          )}
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="board">
            {PHASES.map((p) => (
              <PhaseGroup
                key={p.status}
                status={p.status}
                label={p.label}
                tasks={groups.get(p.status) ?? []}
                project={project}
                userId={me.userId}
                canAdd={canContribute}
                onAdd={setNewTaskStatus}
                onPatch={patchTask}
                dragging={!!active}
              />
            ))}
            {filtered.length === 0 && <div className="muted board-nomatch">No tasks match your filters.</div>}
          </div>
          <DragOverlay dropAnimation={null}>
            {active ? <TaskRowView task={active} project={project} editable={false} onPatch={() => undefined} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {newTaskStatus !== null && (
        <NewTaskDialog
          project={project}
          initialStatus={newTaskStatus}
          onClose={() => setNewTaskStatus(null)}
          onCreated={(t) =>
            tasksQ.setData((list) => (list && !list.some((x) => x.id === t.id) ? [...list, t] : list))
          }
        />
      )}
      {dialogs}
    </div>
  );
};
