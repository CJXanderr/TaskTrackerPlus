import { run, get, all, placeholders, transaction } from "./db";
import {
  AccessLevel,
  Activity,
  ActivityKind,
  Assignee,
  AssigneeKind,
  Attachment,
  AttachmentKind,
  Comment,
  PhaseCounts,
  ProjectSummary,
  Tag,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from "@tasktrackerplus/gen-shared";
import type { StoredAsset } from "./assets";

// ============================================================================
// Data access. Plain SQL over the Root-provided SQLite file. Every function
// here is permission-agnostic — the service layer checks access first.
// ============================================================================

// --- Row types ------------------------------------------------------------------

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  identifier: string;
  image_uri: string;
  archived: number;
  next_number: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface TaskRow {
  id: number;
  project_id: number;
  number: number;
  name: string;
  description: string;
  status: number;
  priority: number;
  assignee_kind: number;
  assignee_id: string;
  due_date: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: number;
}

export interface CommentRow {
  id: number;
  task_id: number;
  author_id: string;
  body: string;
  created_at: number;
  edited_at: number;
}

export interface ActivityRow {
  id: number;
  task_id: number;
  actor_id: string;
  kind: number;
  from_value: string;
  to_value: string;
  created_at: number;
}

export interface AttachmentRow {
  id: number;
  project_id: number;
  task_id: number;
  comment_id: number;
  draft: number;
  asset_uri: string;
  file_name: string;
  mime_type: string;
  size: number;
  kind: number;
  uploaded_by: string;
  created_at: number;
}

// --- Projects ---------------------------------------------------------------------

export function getProject(id: number): Promise<ProjectRow | undefined> {
  return get<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
}

export function listProjects(archived?: boolean): Promise<ProjectRow[]> {
  if (archived === undefined) return all<ProjectRow>("SELECT * FROM projects");
  return all<ProjectRow>("SELECT * FROM projects WHERE archived = ?", [archived ? 1 : 0]);
}

export async function insertProject(p: {
  name: string;
  description: string;
  identifier: string;
  imageUri: string;
  createdBy: string;
  now: number;
}): Promise<number> {
  const res = await run(
    `INSERT INTO projects (name, description, identifier, image_uri, archived, next_number, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?)`,
    [p.name, p.description, p.identifier, p.imageUri, p.createdBy, p.now, p.now],
  );
  return res.lastID;
}

export async function updateProject(
  id: number,
  p: { name: string; description: string; identifier: string; imageUri: string; now: number },
): Promise<void> {
  await run(
    "UPDATE projects SET name = ?, description = ?, identifier = ?, image_uri = ?, updated_at = ? WHERE id = ?",
    [p.name, p.description, p.identifier, p.imageUri, p.now, id],
  );
}

export async function setProjectArchived(id: number, archivedFlag: boolean, now: number): Promise<void> {
  await run("UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?", [archivedFlag ? 1 : 0, now, id]);
}

export async function touchProject(id: number, now: number): Promise<void> {
  await run("UPDATE projects SET updated_at = ? WHERE id = ?", [now, id]);
}

export function deleteProjectCascade(id: number): Promise<void> {
  return transaction(async () => {
    const taskIds = (await all<{ id: number }>("SELECT id FROM tasks WHERE project_id = ?", [id])).map((r) => r.id);
    if (taskIds.length > 0) {
      const ph = placeholders(taskIds.length);
      await run(`DELETE FROM task_tags WHERE task_id IN (${ph})`, taskIds);
      await run(`DELETE FROM comments WHERE task_id IN (${ph})`, taskIds);
      await run(`DELETE FROM activity WHERE task_id IN (${ph})`, taskIds);
    }
    await run("DELETE FROM attachments WHERE project_id = ?", [id]);
    await run("DELETE FROM tasks WHERE project_id = ?", [id]);
    await run("DELETE FROM favorites WHERE project_id = ?", [id]);
    await run("DELETE FROM projects WHERE id = ?", [id]);
  });
}

export function emptyCounts(): PhaseCounts {
  return { backlog: 0, planned: 0, inProgress: 0, inReview: 0, done: 0, cancelled: 0 };
}

function addCount(c: PhaseCounts, status: number, n: number): void {
  switch (status) {
    case TaskStatus.BACKLOG: c.backlog += n; break;
    case TaskStatus.PLANNED: c.planned += n; break;
    case TaskStatus.IN_PROGRESS: c.inProgress += n; break;
    case TaskStatus.IN_REVIEW: c.inReview += n; break;
    case TaskStatus.DONE: c.done += n; break;
    case TaskStatus.CANCELLED: c.cancelled += n; break;
  }
}

export async function phaseCounts(projectIds: number[]): Promise<Map<number, PhaseCounts>> {
  const result = new Map<number, PhaseCounts>();
  for (const id of projectIds) result.set(id, emptyCounts());
  if (projectIds.length === 0) return result;
  const rows = await all<{ project_id: number; status: number; n: number }>(
    `SELECT project_id, status, COUNT(*) AS n FROM tasks
     WHERE project_id IN (${placeholders(projectIds.length)})
     GROUP BY project_id, status`,
    projectIds,
  );
  for (const r of rows) {
    const c = result.get(r.project_id);
    if (c) addCount(c, r.status, r.n);
  }
  return result;
}

export async function projectCounts(projectId: number): Promise<PhaseCounts> {
  return (await phaseCounts([projectId])).get(projectId) ?? emptyCounts();
}

export async function favoriteProjectIds(userId: string): Promise<Set<number>> {
  const rows = await all<{ project_id: number }>("SELECT project_id FROM favorites WHERE user_id = ?", [userId]);
  return new Set(rows.map((r) => r.project_id));
}

export async function setFavorite(userId: string, projectId: number, favorite: boolean): Promise<void> {
  if (favorite) {
    await run("INSERT OR IGNORE INTO favorites (user_id, project_id) VALUES (?, ?)", [userId, projectId]);
  } else {
    await run("DELETE FROM favorites WHERE user_id = ? AND project_id = ?", [userId, projectId]);
  }
}

// --- Tasks ------------------------------------------------------------------------

export function getTask(id: number): Promise<TaskRow | undefined> {
  return get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
}

export function listTasksByProject(projectId: number): Promise<TaskRow[]> {
  return all<TaskRow>("SELECT * FROM tasks WHERE project_id = ?", [projectId]);
}

// Open tasks (not Done / Cancelled) in non-archived projects that are
// assigned to the user directly or to one of their roles.
export function listOpenTasksForAssignee(userId: string, roleIds: string[]): Promise<TaskRow[]> {
  const params: unknown[] = [AssigneeKind.USER, userId];
  let roleClause = "";
  if (roleIds.length > 0) {
    roleClause = ` OR (t.assignee_kind = ? AND t.assignee_id IN (${placeholders(roleIds.length)}))`;
    params.push(AssigneeKind.ROLE, ...roleIds);
  }
  params.push(TaskStatus.DONE, TaskStatus.CANCELLED);
  return all<TaskRow>(
    `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE p.archived = 0
       AND ((t.assignee_kind = ? AND t.assignee_id = ?)${roleClause})
       AND t.status NOT IN (?, ?)`,
    params,
  );
}

export async function taskTagIds(taskIds: number[]): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (taskIds.length === 0) return result;
  const rows = await all<{ task_id: number; tag_id: number }>(
    `SELECT tt.task_id, tt.tag_id FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
     WHERE tt.task_id IN (${placeholders(taskIds.length)}) ORDER BY g.name COLLATE NOCASE`,
    taskIds,
  );
  for (const r of rows) {
    const list = result.get(r.task_id) ?? [];
    list.push(r.tag_id);
    result.set(r.task_id, list);
  }
  return result;
}

async function countBy(sql: string, ids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (ids.length === 0) return result;
  const rows = await all<{ id: number; n: number }>(sql.replace("%IDS%", placeholders(ids.length)), ids);
  for (const r of rows) result.set(r.id, r.n);
  return result;
}

export function commentCounts(taskIds: number[]): Promise<Map<number, number>> {
  return countBy("SELECT task_id AS id, COUNT(*) AS n FROM comments WHERE task_id IN (%IDS%) GROUP BY task_id", taskIds);
}

export function attachmentCounts(taskIds: number[]): Promise<Map<number, number>> {
  return countBy(
    "SELECT task_id AS id, COUNT(*) AS n FROM attachments WHERE draft = 0 AND task_id IN (%IDS%) GROUP BY task_id",
    taskIds,
  );
}

export function insertTask(t: {
  projectId: number;
  name: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeKind: AssigneeKind;
  assigneeId: string;
  dueDate: string;
  tagIds: number[];
  createdBy: string;
  now: number;
  attachmentIds: number[];
}): Promise<number> {
  return transaction(async () => {
    const project = await get<{ next_number: number }>("SELECT next_number FROM projects WHERE id = ?", [t.projectId]);
    const number = project?.next_number ?? 1;
    await run("UPDATE projects SET next_number = ?, updated_at = ? WHERE id = ?", [number + 1, t.now, t.projectId]);
    const res = await run(
      `INSERT INTO tasks (project_id, number, name, description, status, priority, assignee_kind, assignee_id, due_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.projectId, number, t.name, t.description, t.status, t.priority,
        t.assigneeKind, t.assigneeId, t.dueDate, t.createdBy, t.now, t.now,
      ],
    );
    const taskId = res.lastID;
    for (const tagId of t.tagIds) {
      await run("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)", [taskId, tagId]);
    }
    await run(
      "INSERT INTO activity (task_id, actor_id, kind, from_value, to_value, created_at) VALUES (?, ?, ?, '', '', ?)",
      [taskId, t.createdBy, ActivityKind.CREATED, t.now],
    );
    if (t.attachmentIds.length > 0) {
      await run(
        `UPDATE attachments SET task_id = ?, comment_id = 0, draft = 0
         WHERE draft = 1 AND task_id = 0 AND uploaded_by = ? AND project_id = ?
           AND id IN (${placeholders(t.attachmentIds.length)})`,
        [taskId, t.createdBy, t.projectId, ...t.attachmentIds],
      );
    }
    return taskId;
  });
}

export interface TaskChanges {
  name?: string;
  description?: string;
  status?: number;
  priority?: number;
  assigneeKind?: number;
  assigneeId?: string;
  dueDate?: string;
}

export async function updateTask(
  taskId: number,
  changes: TaskChanges,
  tagIds: number[] | undefined,
  activity: Array<{ kind: ActivityKind; from: string; to: string }>,
  actorId: string,
  projectId: number,
  now: number,
): Promise<void> {
  await transaction(async () => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if (changes.name !== undefined) add("name", changes.name);
    if (changes.description !== undefined) add("description", changes.description);
    if (changes.status !== undefined) add("status", changes.status);
    if (changes.priority !== undefined) add("priority", changes.priority);
    if (changes.assigneeKind !== undefined) add("assignee_kind", changes.assigneeKind);
    if (changes.assigneeId !== undefined) add("assignee_id", changes.assigneeId);
    if (changes.dueDate !== undefined) add("due_date", changes.dueDate);
    add("updated_at", now);
    await run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...params, taskId]);

    if (tagIds) {
      await run("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
      for (const tagId of tagIds) {
        await run("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)", [taskId, tagId]);
      }
    }
    for (const a of activity) {
      await run(
        "INSERT INTO activity (task_id, actor_id, kind, from_value, to_value, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [taskId, actorId, a.kind, a.from, a.to, now],
      );
    }
    await run("UPDATE projects SET updated_at = ? WHERE id = ?", [now, projectId]);
  });
}

export async function touchTask(taskId: number, projectId: number, now: number): Promise<void> {
  await run("UPDATE tasks SET updated_at = ? WHERE id = ?", [now, taskId]);
  await run("UPDATE projects SET updated_at = ? WHERE id = ?", [now, projectId]);
}

export function deleteTaskCascade(taskId: number, projectId: number, now: number): Promise<void> {
  return transaction(async () => {
    await run("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
    await run("DELETE FROM comments WHERE task_id = ?", [taskId]);
    await run("DELETE FROM activity WHERE task_id = ?", [taskId]);
    await run("DELETE FROM attachments WHERE task_id = ?", [taskId]);
    await run("DELETE FROM tasks WHERE id = ?", [taskId]);
    await run("UPDATE projects SET updated_at = ? WHERE id = ?", [now, projectId]);
  });
}

// --- Tags -------------------------------------------------------------------------

export function listTags(): Promise<TagRow[]> {
  return all<TagRow>("SELECT * FROM tags ORDER BY name COLLATE NOCASE");
}

export function getTag(id: number): Promise<TagRow | undefined> {
  return get<TagRow>("SELECT * FROM tags WHERE id = ?", [id]);
}

export async function existingTagIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await all<{ id: number }>(`SELECT id FROM tags WHERE id IN (${placeholders(ids.length)})`, ids);
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

export async function tagNames(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (ids.length === 0) return result;
  const rows = await all<{ id: number; name: string }>(
    `SELECT id, name FROM tags WHERE id IN (${placeholders(ids.length)})`,
    ids,
  );
  for (const r of rows) result.set(r.id, r.name);
  return result;
}

export async function insertTag(name: string, color: string, now: number): Promise<number> {
  return (await run("INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)", [name, color, now])).lastID;
}

export async function updateTag(id: number, name: string, color: string): Promise<void> {
  await run("UPDATE tags SET name = ?, color = ? WHERE id = ?", [name, color, id]);
}

export function deleteTag(id: number): Promise<void> {
  return transaction(async () => {
    await run("DELETE FROM task_tags WHERE tag_id = ?", [id]);
    await run("DELETE FROM tags WHERE id = ?", [id]);
  });
}

export function findTagByName(name: string): Promise<TagRow | undefined> {
  return get<TagRow>("SELECT * FROM tags WHERE name = ? COLLATE NOCASE", [name]);
}

// --- Comments -----------------------------------------------------------------------

export function listComments(taskId: number): Promise<CommentRow[]> {
  return all<CommentRow>("SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC, id ASC", [taskId]);
}

export function getComment(id: number): Promise<CommentRow | undefined> {
  return get<CommentRow>("SELECT * FROM comments WHERE id = ?", [id]);
}

export async function countComments(taskId: number): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM comments WHERE task_id = ?", [taskId]))?.n ?? 0;
}

export function insertComment(c: {
  taskId: number;
  projectId: number;
  authorId: string;
  body: string;
  attachmentIds: number[];
  now: number;
}): Promise<number> {
  return transaction(async () => {
    const res = await run(
      "INSERT INTO comments (task_id, author_id, body, created_at, edited_at) VALUES (?, ?, ?, ?, 0)",
      [c.taskId, c.authorId, c.body, c.now],
    );
    const commentId = res.lastID;
    if (c.attachmentIds.length > 0) {
      await claimDraftsForComment(c.attachmentIds, c.authorId, c.projectId, c.taskId, commentId);
    }
    await run("UPDATE tasks SET updated_at = ? WHERE id = ?", [c.now, c.taskId]);
    await run("UPDATE projects SET updated_at = ? WHERE id = ?", [c.now, c.projectId]);
    return commentId;
  });
}

async function claimDraftsForComment(
  ids: number[],
  userId: string,
  projectId: number,
  taskId: number,
  commentId: number,
): Promise<void> {
  await run(
    `UPDATE attachments SET task_id = ?, comment_id = ?, draft = 0
     WHERE draft = 1 AND uploaded_by = ? AND project_id = ? AND (task_id = 0 OR task_id = ?)
       AND id IN (${placeholders(ids.length)})`,
    [taskId, commentId, userId, projectId, taskId, ...ids],
  );
}

export function updateComment(c: {
  commentId: number;
  taskId: number;
  projectId: number;
  authorId: string;
  body: string;
  addIds: number[];
  removeIds: number[];
  now: number;
}): Promise<void> {
  return transaction(async () => {
    await run("UPDATE comments SET body = ?, edited_at = ? WHERE id = ?", [c.body, c.now, c.commentId]);
    if (c.removeIds.length > 0) {
      await run(
        `DELETE FROM attachments WHERE comment_id = ? AND id IN (${placeholders(c.removeIds.length)})`,
        [c.commentId, ...c.removeIds],
      );
    }
    if (c.addIds.length > 0) {
      await claimDraftsForComment(c.addIds, c.authorId, c.projectId, c.taskId, c.commentId);
    }
    await run("UPDATE tasks SET updated_at = ? WHERE id = ?", [c.now, c.taskId]);
  });
}

export function deleteComment(commentId: number): Promise<void> {
  return transaction(async () => {
    await run("DELETE FROM attachments WHERE comment_id = ?", [commentId]);
    await run("DELETE FROM comments WHERE id = ?", [commentId]);
  });
}

// --- Activity ---------------------------------------------------------------------

const ACTIVITY_LIMIT = 500;

export function listActivity(taskId: number): Promise<ActivityRow[]> {
  return all<ActivityRow>(
    `SELECT * FROM (SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT ${ACTIVITY_LIMIT})
     ORDER BY created_at ASC, id ASC`,
    [taskId],
  );
}

export async function addActivity(
  taskId: number,
  actorId: string,
  kind: ActivityKind,
  from: string,
  to: string,
  now: number,
): Promise<void> {
  await run(
    "INSERT INTO activity (task_id, actor_id, kind, from_value, to_value, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [taskId, actorId, kind, from, to, now],
  );
}

// --- Attachments ---------------------------------------------------------------------

export async function insertAttachments(
  assets: StoredAsset[],
  a: { projectId: number; taskId: number; draft: boolean; uploadedBy: string; now: number },
): Promise<number[]> {
  return transaction(async () => {
    const ids: number[] = [];
    for (const asset of assets) {
      const res = await run(
        `INSERT INTO attachments (project_id, task_id, comment_id, draft, asset_uri, file_name, mime_type, size, kind, uploaded_by, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.projectId, a.taskId, a.draft ? 1 : 0, asset.uri, asset.fileName,
          asset.mimeType, asset.size, asset.kind, a.uploadedBy, a.now,
        ],
      );
      ids.push(res.lastID);
    }
    return ids;
  });
}

export function getAttachment(id: number): Promise<AttachmentRow | undefined> {
  return get<AttachmentRow>("SELECT * FROM attachments WHERE id = ?", [id]);
}

export async function getAttachmentsByIds(ids: number[]): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];
  return all<AttachmentRow>(
    `SELECT * FROM attachments WHERE id IN (${placeholders(ids.length)}) ORDER BY id`,
    ids,
  );
}

export function listTaskAttachments(taskId: number): Promise<AttachmentRow[]> {
  return all<AttachmentRow>(
    "SELECT * FROM attachments WHERE task_id = ? AND comment_id = 0 AND draft = 0 ORDER BY created_at ASC, id ASC",
    [taskId],
  );
}

export async function listCommentAttachments(taskId: number): Promise<Map<number, AttachmentRow[]>> {
  const rows = await all<AttachmentRow>(
    "SELECT * FROM attachments WHERE task_id = ? AND comment_id <> 0 AND draft = 0 ORDER BY id ASC",
    [taskId],
  );
  const result = new Map<number, AttachmentRow[]>();
  for (const r of rows) {
    const list = result.get(r.comment_id) ?? [];
    list.push(r);
    result.set(r.comment_id, list);
  }
  return result;
}

export async function countTaskAttachments(taskId: number): Promise<number> {
  return (
    (await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM attachments WHERE task_id = ? AND comment_id = 0 AND draft = 0",
      [taskId],
    ))?.n ?? 0
  );
}

export async function countCommentAttachments(commentId: number): Promise<number> {
  return (
    (await get<{ n: number }>("SELECT COUNT(*) AS n FROM attachments WHERE comment_id = ? AND draft = 0", [commentId]))
      ?.n ?? 0
  );
}

export async function deleteAttachment(id: number): Promise<void> {
  await run("DELETE FROM attachments WHERE id = ?", [id]);
}

// Drafts nobody claimed (the composer was abandoned). The asset itself stays
// in Root's storage; only our reference is dropped.
export async function deleteStaleDrafts(olderThan: number): Promise<number> {
  return (await run("DELETE FROM attachments WHERE draft = 1 AND created_at < ?", [olderThan])).changes;
}

// --- Mapping to network types ------------------------------------------------------------

export function toProjectSummary(
  row: ProjectRow,
  counts: PhaseCounts,
  favorite: boolean,
  access: AccessLevel,
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    identifier: row.identifier,
    imageUri: row.image_uri,
    archived: row.archived === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts,
    favorite,
    myAccess: access,
  };
}

export function toAssignee(row: TaskRow): Assignee | undefined {
  if (row.assignee_kind === AssigneeKind.NONE || !row.assignee_id) return undefined;
  return { kind: row.assignee_kind as AssigneeKind, id: row.assignee_id };
}

export function toTaskSummary(
  row: TaskRow,
  extra: {
    tagIds?: number[];
    commentCount?: number;
    attachmentCount?: number;
    project?: Pick<ProjectRow, "identifier" | "name">;
  },
): TaskSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    name: row.name,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assignee: toAssignee(row),
    tagIds: extra.tagIds ?? [],
    dueDate: row.due_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: extra.commentCount ?? 0,
    attachmentCount: extra.attachmentCount ?? 0,
    projectIdentifier: extra.project?.identifier ?? "",
    projectName: extra.project?.name ?? "",
  };
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    commentId: row.comment_id,
    assetUri: row.asset_uri,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    kind: row.kind as AttachmentKind,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export function toComment(row: CommentRow, attachments: AttachmentRow[]): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    attachments: attachments.map(toAttachment),
  };
}

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    kind: row.kind as ActivityKind,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  };
}

export function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}
