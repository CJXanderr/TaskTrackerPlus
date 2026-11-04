import React, { useMemo } from "react";
import { CalendarDays, CircleCheckBig, MessageSquare, Paperclip } from "lucide-react";
import { TaskSummary } from "@tasktrackerplus/gen-shared";
import { api, TrackerServiceClientEvent, useQuery, useTrackerEvent } from "../lib/api";
import { compareDue, dueLabel, dueState, taskKey } from "../lib/format";
import { Link } from "../lib/router";
import { PriorityIcon, StatusIcon } from "../components/icons";
import { EmptyState, Spinner } from "../components/ui";
import { QueryErrorView } from "./common";

// Overdue first, then due today / soon, then by due date, then undated.
function rank(t: TaskSummary): number {
  switch (dueState(t.dueDate)) {
    case "overdue":
      return 0;
    case "today":
      return 1;
    case "soon":
      return 2;
    case "later":
      return 3;
    default:
      return 4;
  }
}

export function sortMyTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compareDue(a.dueDate, b.dueDate) ||
      b.priority - a.priority ||
      b.updatedAt - a.updatedAt,
  );
}

export function useMyTasks() {
  const q = useQuery(() => api.listMyTasks({}).then((r) => sortMyTasks(r.tasks)), []);
  useTrackerEvent(TrackerServiceClientEvent.TaskChanged, () => q.reload());
  useTrackerEvent(TrackerServiceClientEvent.ProjectChanged, () => q.reload());
  useTrackerEvent(TrackerServiceClientEvent.AccessChanged, () => q.reload());
  return q;
}

export const DueChip: React.FC<{ due: string }> = ({ due }) => {
  if (!due) return null;
  const state = dueState(due);
  return (
    <span className={`due-chip due-${state}`} title={state === "overdue" ? "Overdue" : "Due date"}>
      <CalendarDays size={12} />
      {dueLabel(due)}
    </span>
  );
};

export const MyTaskRow: React.FC<{ task: TaskSummary }> = ({ task }) => (
  <Link to={{ name: "task", projectId: task.projectId, taskId: task.id }} className="my-task-row">
    <StatusIcon status={task.status} />
    <PriorityIcon priority={task.priority} />
    <span className="task-key">{taskKey(task.projectIdentifier, task.number)}</span>
    <span className="my-task-name">{task.name}</span>
    <span className="my-task-meta">
      {task.attachmentCount > 0 && (
        <span className="count-chip" title="Attachments">
          <Paperclip size={12} />
          {task.attachmentCount}
        </span>
      )}
      {task.commentCount > 0 && (
        <span className="count-chip" title="Comments">
          <MessageSquare size={12} />
          {task.commentCount}
        </span>
      )}
      <span className="project-pill" title={task.projectName}>
        {task.projectName}
      </span>
      <DueChip due={task.dueDate} />
    </span>
  </Link>
);

export const MyTasksView: React.FC = () => {
  const q = useMyTasks();
  const tasks = q.data ?? [];
  const overdue = useMemo(() => tasks.filter((t) => dueState(t.dueDate) === "overdue").length, [tasks]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">My tasks</h1>
          <p className="page-subtitle">
            Open tasks assigned to you or your roles, across every project.
            {overdue > 0 && <span className="text-error"> {overdue} overdue.</span>}
          </p>
        </div>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <QueryErrorView error={q.error} onRetry={q.reload} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={<CircleCheckBig size={28} />} title="You're all caught up">
          Nothing is assigned to you right now.
        </EmptyState>
      ) : (
        <div className="panel list-panel">
          {tasks.map((t) => (
            <MyTaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
};
