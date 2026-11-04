import React, { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Ellipsis, FolderKanban, Plus, Search, Settings, Star, Tags, Trash2 } from "lucide-react";
import { AccessLevel, ProjectSummary, TaskChangedEvent } from "@tasktrackerplus/gen-shared";
import { api, isNotFound, TrackerServiceClientEvent, useQuery, useTrackerEvent } from "../lib/api";
import { relativeTime, plural } from "../lib/format";
import { totalCount } from "../lib/phases";
import { Link, navigate } from "../lib/router";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/Toasts";
import { Button, ConfirmDialog, EmptyState, IconButton, MenuButton, MenuItem, Spinner } from "../components/ui";
import { AccessChip, PhaseBar, ProjectAvatar } from "../components/project";
import { ProjectDialog } from "./ProjectDialog";
import { QueryErrorView } from "./common";

// ---- project actions shared by the card and the board header ----

type Pending = "settings" | "archive" | "unarchive" | "delete" | null;

export function useProjectActions(project: ProjectSummary | undefined, after?: { deleted?: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const items: MenuItem[] = [];
  if (project && project.myAccess >= AccessLevel.MANAGE) {
    if (!project.archived) {
      items.push({ label: "Project Settings", icon: <Settings size={15} />, onSelect: () => setPending("settings") });
      items.push({ label: "Archive Project", icon: <Archive size={15} />, onSelect: () => setPending("archive") });
    } else {
      items.push({ label: "Unarchive Project", icon: <ArchiveRestore size={15} />, onSelect: () => setPending("unarchive") });
    }
    items.push({ label: "Delete Project", icon: <Trash2 size={15} />, danger: true, onSelect: () => setPending("delete") });
  }

  const dialogs = project ? (
    <>
      {pending === "settings" && <ProjectDialog project={project} onClose={() => setPending(null)} />}
      {(pending === "archive" || pending === "unarchive") && (
        <ConfirmDialog
          title={pending === "archive" ? "Archive project?" : "Unarchive project?"}
          message={
            pending === "archive" ? (
              <>
                <strong>{project.name}</strong> will leave the projects list and become read-only. Its tasks drop out
                of My tasks. You can unarchive it at any time from <em>Show archived projects</em>.
              </>
            ) : (
              <>
                <strong>{project.name}</strong> will return to the projects list and become editable again.
              </>
            )
          }
          confirmLabel={pending === "archive" ? "Archive" : "Unarchive"}
          danger={false}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            try {
              await api.setProjectArchived({ projectId: project.id, archived: pending === "archive" });
              toast.show(pending === "archive" ? "Project archived" : "Project restored", "success");
            } catch (err) {
              toast.error(err);
              throw err;
            }
          }}
        />
      )}
      {pending === "delete" && (
        <ConfirmDialog
          title="Delete project?"
          message={
            <>
              This permanently deletes <strong>{project.name}</strong> with all of its tasks, comments, attachments and
              history.
            </>
          }
          confirmLabel="Delete project"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            try {
              await api.deleteProject({ projectId: project.id });
              toast.show("Project deleted", "success");
              after?.deleted?.();
            } catch (err) {
              toast.error(err);
              throw err;
            }
          }}
        />
      )}
    </>
  ) : null;

  return { items, dialogs };
}

export async function toggleFavorite(project: ProjectSummary, toast: ReturnType<typeof useToast>): Promise<boolean> {
  try {
    await api.setFavorite({ projectId: project.id, favorite: !project.favorite });
    return true;
  } catch (err) {
    toast.error(err);
    return false;
  }
}

// ---- card ----

const ProjectCard: React.FC<{ project: ProjectSummary; onFavorite: (p: ProjectSummary) => void }> = ({ project, onFavorite }) => {
  const { items, dialogs } = useProjectActions(project);
  const total = totalCount(project.counts);
  const done = project.counts?.done ?? 0;
  const open = () => navigate({ name: "project", projectId: project.id });
  return (
    <div
      className="project-card"
      role="link"
      tabIndex={0}
      onClick={(e) => {
        // Ignore clicks bubbling through React portals (menus, dialogs).
        if ((e.currentTarget as Node).contains(e.target as Node)) open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) open();
      }}
    >
      <div className="project-card-head">
        <ProjectAvatar imageUri={project.imageUri} />
        <div className="project-card-title">
          <div className="project-card-name">{project.name}</div>
          <div className="project-card-updated">Updated {relativeTime(project.updatedAt)}</div>
        </div>
        <div className="project-card-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <IconButton
            label={project.favorite ? "Remove from favorites" : "Add to favorites"}
            className={`star ${project.favorite ? "on" : ""}`}
            onClick={() => onFavorite(project)}
          >
            <Star size={16} />
          </IconButton>
          <MenuButton label="Project menu" items={items}>
            <Ellipsis size={16} />
          </MenuButton>
        </div>
      </div>
      {project.description && <div className="project-card-desc">{project.description}</div>}
      <div className="subsection-label">Project status</div>
      <PhaseBar counts={project.counts} />
      <div className="project-card-foot">
        <AccessChip access={project.myAccess} />
        <span className="muted small">
          {total === 0 ? "No tasks yet" : `${done}/${plural(total, "task")} done`}
        </span>
      </div>
      {/* Dialogs are portaled, but React events still bubble to the card. */}
      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {dialogs}
      </div>
    </div>
  );
};

// ---- section ----

export const ProjectsSection: React.FC<{ archived: boolean }> = ({ archived }) => {
  const { me } = useAppState();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const q = useQuery(() => api.listProjects({ archived }).then((r) => r.projects), [archived]);

  useTrackerEvent(TrackerServiceClientEvent.ProjectChanged, () => q.reload());
  useTrackerEvent(TrackerServiceClientEvent.AccessChanged, () => q.reload());
  useTrackerEvent(TrackerServiceClientEvent.TaskChanged, (e: TaskChangedEvent) => {
    q.setData((list) =>
      list?.map((p) => (p.id === e.projectId ? { ...p, counts: e.counts ?? p.counts, updatedAt: e.projectUpdatedAt || p.updatedAt } : p)),
    );
  });

  const projects = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...(q.data ?? [])]
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.identifier.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term),
      )
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }, [q.data, query]);

  const onFavorite = async (p: ProjectSummary) => {
    q.setData((list) => list?.map((x) => (x.id === p.id ? { ...x, favorite: !x.favorite } : x)));
    if (!(await toggleFavorite(p, toast))) q.reload();
  };

  return (
    <section className="projects">
      <div className="projects-bar">
        <h2 className="section-title">{archived ? "Archived projects" : "Projects"}</h2>
        <div className="search-box">
          <Search size={15} />
          <input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="projects-bar-actions">
          {!archived && me.canCreateProjects && (
            <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              New project
            </Button>
          )}
          {me.canManageTags && (
            <Link to={{ name: "tags" }} className="btn btn-outline btn-sm">
              <Tags size={15} />
              <span>Manage Tags</span>
            </Link>
          )}
          {archived ? (
            <Link to={{ name: "home" }} className="btn btn-ghost btn-sm">
              <FolderKanban size={15} />
              <span>Active projects</span>
            </Link>
          ) : (
            <Link to={{ name: "archived" }} className="btn btn-ghost btn-sm">
              <Archive size={15} />
              <span>Show archived projects</span>
            </Link>
          )}
        </div>
      </div>

      {q.loading ? (
        <Spinner />
      ) : q.error && !isNotFound(q.error) ? (
        <QueryErrorView error={q.error} onRetry={q.reload} />
      ) : projects.length === 0 ? (
        <EmptyState icon={<FolderKanban size={28} />} title={query ? "No matching projects" : archived ? "No archived projects" : "No projects yet"}>
          {!query && !archived && (me.canCreateProjects ? "Create your first project to start tracking tasks." : "Projects you have access to will show up here.")}
        </EmptyState>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onFavorite={onFavorite} />
          ))}
        </div>
      )}

      {creating && (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            q.reload();
            navigate({ name: "project", projectId: p.id });
          }}
        />
      )}
    </section>
  );
};
