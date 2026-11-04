import {
  rootServer,
  RootApiException,
  ErrorCodeType,
  UserGuid,
  CommunityRoleGuid,
  NotificationSendRequest,
} from "@rootsdk/server-app";
import { AssigneeKind, TaskStatus } from "@tasktrackerplus/gen-shared";
import type { ProjectRow, TaskRow } from "./store";
import { log, errFields } from "./lib/log";

// ============================================================================
// Notifications, matching Root's Task Tracker:
//   * someone assigns you a task (directly or through a role)
//   * someone takes you off a task
//   * someone comments on a task you created or are assigned to
//   * a task you created or are assigned to moves to a different phase
// You aren't notified about your own changes, unless the task is assigned
// to a role you're in. Always best effort — never fails the user action.
// ============================================================================

interface Target {
  kind: AssigneeKind;
  id: string;
}

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 150;

export const STATUS_LABEL: Record<number, string> = {
  [TaskStatus.BACKLOG]: "Backlog",
  [TaskStatus.PLANNED]: "Planned",
  [TaskStatus.IN_PROGRESS]: "In Progress",
  [TaskStatus.IN_REVIEW]: "In Review",
  [TaskStatus.DONE]: "Done",
  [TaskStatus.CANCELLED]: "Cancelled",
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

const nameCache = new Map<string, { name: string; at: number }>();
const NAME_TTL_MS = 10 * 60 * 1000;

async function memberName(userId: string): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached && Date.now() - cached.at < NAME_TTL_MS) return cached.name;
  try {
    const member = await rootServer.community.communityMembers.get({ userId: userId as UserGuid });
    const name = member.nickname || "Someone";
    nameCache.set(userId, { name, at: Date.now() });
    return name;
  } catch {
    return "Someone";
  }
}

function taskKey(task: TaskRow, project: ProjectRow): string {
  return `${project.identifier}-${task.number}`;
}

function resolveTargets(targets: Array<Target | undefined>, actorId: string) {
  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  for (const t of targets) {
    if (!t || !t.id) continue;
    if (t.kind === AssigneeKind.USER && t.id !== actorId) userIds.add(t.id);
    if (t.kind === AssigneeKind.ROLE) roleIds.add(t.id);
  }
  return { userIds: [...userIds], roleIds: [...roleIds] };
}

function send(
  task: TaskRow,
  targets: Array<Target | undefined>,
  actorId: string,
  title: string,
  description: string,
): void {
  const { userIds, roleIds } = resolveTargets(targets, actorId);
  if (userIds.length === 0 && roleIds.length === 0) return;

  const request: NotificationSendRequest = {
    title: clip(title, TITLE_MAX),
    description: clip(description, DESCRIPTION_MAX),
    userIds: userIds as UserGuid[],
    communityRoleIds: roleIds as CommunityRoleGuid[],
    relativeUrl: `/project/${task.project_id}/task/${task.id}`,
  };

  void rootServer.community.notifications.send(request).catch(async (err) => {
    // Without a channel the deep link is refused; deliver without it.
    if (err instanceof RootApiException && err.errorCode === ErrorCodeType.NoPermissionToCreate) {
      try {
        await rootServer.community.notifications.send({ ...request, relativeUrl: undefined });
        return;
      } catch (retryErr) {
        log("warn", "notification failed", { taskId: task.id, ...errFields(retryErr) });
        return;
      }
    }
    log("warn", "notification failed", { taskId: task.id, ...errFields(err) });
  });
}

function assigneeOf(task: TaskRow): Target | undefined {
  return task.assignee_kind === AssigneeKind.NONE ? undefined : { kind: task.assignee_kind, id: task.assignee_id };
}

function creatorOf(task: TaskRow): Target {
  return { kind: AssigneeKind.USER, id: task.created_by };
}

export async function notifyAssigned(task: TaskRow, project: ProjectRow, actorId: string): Promise<void> {
  const target = assigneeOf(task);
  if (!target) return;
  const actor = await memberName(actorId);
  send(task, [target], actorId, `Assigned to you: ${taskKey(task, project)}`, `${actor} assigned you “${task.name}”`);
}

export async function notifyUnassigned(
  task: TaskRow,
  project: ProjectRow,
  actorId: string,
  previous: Target | undefined,
): Promise<void> {
  if (!previous || !previous.id) return;
  const actor = await memberName(actorId);
  send(
    task,
    [previous],
    actorId,
    `Removed from ${taskKey(task, project)}`,
    `${actor} took you off “${task.name}”`,
  );
}

export async function notifyCommented(
  task: TaskRow,
  project: ProjectRow,
  actorId: string,
  body: string,
  attachmentCount: number,
): Promise<void> {
  const actor = await memberName(actorId);
  const text =
    body.trim() ||
    (attachmentCount === 1 ? "shared a file" : attachmentCount > 1 ? `shared ${attachmentCount} files` : "");
  send(
    task,
    [creatorOf(task), assigneeOf(task)],
    actorId,
    `New comment on ${taskKey(task, project)}`,
    `${actor}: ${text}`,
  );
}

export async function notifyMoved(task: TaskRow, project: ProjectRow, actorId: string): Promise<void> {
  const label = STATUS_LABEL[task.status] ?? "a new phase";
  send(
    task,
    [creatorOf(task), assigneeOf(task)],
    actorId,
    `${taskKey(task, project)} moved to ${label}`,
    `“${task.name}”`,
  );
}
