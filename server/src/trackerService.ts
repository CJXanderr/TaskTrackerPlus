import { rootServer, Client, RootServerException, UserGuid } from "@rootsdk/server-app";
import { TrackerServiceBase } from "@tasktrackerplus/gen-server";
import {
  AccessLevel,
  ActivityKind,
  Assignee,
  AssigneeKind,
  AttachTarget,
  Comment,
  CreateCommentRequest,
  CreateCommentResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateTagRequest,
  CreateTagResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteAttachmentRequest,
  DeleteAttachmentResponse,
  DeleteCommentRequest,
  DeleteCommentResponse,
  DeleteProjectRequest,
  DeleteProjectResponse,
  DeleteTagRequest,
  DeleteTagResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetMeRequest,
  GetMeResponse,
  GetProjectRequest,
  GetProjectResponse,
  GetTaskRequest,
  GetTaskResponse,
  ListMyTasksRequest,
  ListMyTasksResponse,
  ListProjectsRequest,
  ListProjectsResponse,
  ListRolesRequest,
  ListRolesResponse,
  ListTagsRequest,
  ListTagsResponse,
  ListTasksRequest,
  ListTasksResponse,
  ProjectSummary,
  SetFavoriteRequest,
  SetFavoriteResponse,
  SetProjectArchivedRequest,
  SetProjectArchivedResponse,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  UpdateCommentRequest,
  UpdateCommentResponse,
  UpdateProjectRequest,
  UpdateProjectResponse,
  UpdateTagRequest,
  UpdateTagResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
  UploadAttachmentsRequest,
  UploadAttachmentsResponse,
  Role,
} from "@tasktrackerplus/gen-shared";
import * as store from "./store";
import {
  AccessContext,
  EVERYONE_ROLE_ID,
  Permissions,
  cleanPermissions,
  createProjectGroups,
  deleteProjectGroups,
  getProjectPermissions,
  isEmptySelection,
  isRoleId,
  isUserId,
  toProtoPermissions,
  updateProjectGroups,
} from "./access";
import { convertImageToken, convertUploadTokens } from "./assets";
import { notifyAssigned, notifyCommented, notifyMoved, notifyUnassigned } from "./notify";
import { archived, forbidden, invalid, limitReached, notFound } from "./errors";
import { withRetry } from "./lib/retry";
import { log, errFields } from "./lib/log";

// --- Limits (same as Root's Task Tracker, plus attachment caps) -----------------

const LIMITS = {
  projectName: 100,
  projectDescription: 5000,
  identifier: 4,
  taskName: 512,
  taskDescriptionText: 10000,
  taskDescriptionHtml: 60000,
  tagName: 80,
  tagsPerTask: 20,
  commentLength: 2000,
  commentsPerTask: 50,
  filesPerUpload: 20,
  attachmentsPerTask: 100,
  attachmentsPerComment: 10,
};

const DEFAULT_TAG_COLOR = "#84CC16"; // lime green, as in Root's Task Tracker

// --- Input helpers ------------------------------------------------------------------

function requiredText(value: string | undefined, max: number, label: string): string {
  const v = (value ?? "").trim();
  if (!v) invalid(`${label} is required`);
  if (v.length > max) invalid(`${label} is limited to ${max.toLocaleString("en-US")} characters`);
  return v;
}

function optionalText(value: string | undefined, max: number, label: string): string {
  const v = (value ?? "").trim();
  if (v.length > max) invalid(`${label} is limited to ${max.toLocaleString("en-US")} characters`);
  return v;
}

export function deriveIdentifier(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "PROJ";
  if (words.length === 1) return words[0].slice(0, LIMITS.identifier);
  return words.map((w) => w[0]).join("").slice(0, LIMITS.identifier);
}

function cleanIdentifier(value: string | undefined, name: string): string {
  const v = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!v) return deriveIdentifier(name);
  if (v.length > LIMITS.identifier) invalid("Project identifier is limited to 4 letters or numbers");
  return v;
}

// Defence in depth: the client renders descriptions through the editor's
// schema (which drops anything unknown), but strip active content anyway.
function cleanDescription(value: string | undefined): string {
  let html = (value ?? "").trim();
  if (html.length > LIMITS.taskDescriptionHtml) invalid("Description is too long");
  html = html
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|svg|math|link|meta|base|form|input)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, "x");
  if (text.length > LIMITS.taskDescriptionText) {
    invalid("Description is limited to 10,000 characters");
  }
  return text.trim() === "" ? "" : html;
}

function cleanDueDate(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) invalid("Due date must be a date");
  const d = new Date(Date.UTC(Number(m![1]), Number(m![2]) - 1, Number(m![3])));
  if (
    d.getUTCFullYear() !== Number(m![1]) ||
    d.getUTCMonth() !== Number(m![2]) - 1 ||
    d.getUTCDate() !== Number(m![3])
  ) {
    invalid("Due date must be a real date");
  }
  return v;
}

function cleanStatus(value: TaskStatus | undefined, fallback: TaskStatus): TaskStatus {
  if (value === undefined || value === TaskStatus.UNSPECIFIED) return fallback;
  if (value < TaskStatus.BACKLOG || value > TaskStatus.CANCELLED) invalid("Unknown status");
  return value;
}

function cleanPriority(value: TaskPriority | undefined, fallback: TaskPriority): TaskPriority {
  if (value === undefined || value === TaskPriority.UNSPECIFIED) return fallback;
  if (value < TaskPriority.LOW || value > TaskPriority.HIGH) invalid("Unknown priority");
  return value;
}

function cleanAssignee(a: Assignee | undefined): { kind: AssigneeKind; id: string } {
  if (!a || a.kind === AssigneeKind.NONE || !a.id) return { kind: AssigneeKind.NONE, id: "" };
  if (a.kind === AssigneeKind.USER && isUserId(a.id)) return { kind: AssigneeKind.USER, id: a.id };
  if (a.kind === AssigneeKind.ROLE && isRoleId(a.id)) return { kind: AssigneeKind.ROLE, id: a.id };
  return invalid("Unknown assignee");
}

function uniqueIds(ids: number[] | undefined): number[] {
  return [...new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
}

function cleanTagName(value: string | undefined): string {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) invalid("Tag name is required");
  if (v.length > LIMITS.tagName) invalid("Tag name is limited to 80 characters");
  if (!/^[\p{L}\p{N} ]+$/u.test(v)) invalid("Tag names can only contain letters, numbers and spaces");
  return v;
}

function cleanColor(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return DEFAULT_TAG_COLOR;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (!/^#[0-9a-f]{6}$/i.test(v)) invalid("Color must be a hex color like #84CC16");
  return v.toUpperCase();
}

function assigneeValue(kind: number, id: string): string {
  if (kind === AssigneeKind.USER) return `user:${id}`;
  if (kind === AssigneeKind.ROLE) return `role:${id}`;
  return "";
}

function canEditTask(access: AccessLevel, task: store.TaskRow, userId: string): boolean {
  return access >= AccessLevel.MANAGE || (access >= AccessLevel.CONTRIBUTE && task.created_by === userId);
}

function assertWritable(project: store.ProjectRow): void {
  if (project.archived === 1) archived();
}

// Logs unexpected failures; app errors (RootServerException) pass through.
async function handle<T>(name: string, client: Client, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof RootServerException)) {
      log("error", `${name} failed`, { userId: client.userId, ...errFields(err) });
    }
    throw err;
  }
}

// --- Caches for community lookups ---------------------------------------------------------

let rolesCache: { at: number; roles: Role[] } | undefined;
const memberRolesCache = new Map<string, { at: number; roleIds: string[] }>();
const ROLES_TTL_MS = 60_000;
const MEMBER_ROLES_TTL_MS = 30_000;

async function rolesOfMember(userId: string): Promise<string[]> {
  const cached = memberRolesCache.get(userId);
  if (cached && Date.now() - cached.at < MEMBER_ROLES_TTL_MS) return cached.roleIds;
  let roleIds: string[] = [];
  try {
    const res = await withRetry("communityMemberRoles.list", () =>
      rootServer.community.communityMemberRoles.list({ userId: userId as UserGuid }),
    );
    roleIds = [...(res.communityRoleIds ?? [])];
  } catch (err) {
    log("warn", "could not list member roles", { userId, ...errFields(err) });
  }
  if (!roleIds.includes(EVERYONE_ROLE_ID)) roleIds.push(EVERYONE_ROLE_ID);
  memberRolesCache.set(userId, { at: Date.now(), roleIds });
  return roleIds;
}

// --- Service ------------------------------------------------------------------------------

export class TrackerService extends TrackerServiceBase {
  // ---- access helpers ----

  private async requireProject(ctx: AccessContext, projectId: number, min: AccessLevel) {
    const project = await store.getProject(projectId);
    if (!project) return notFound("Project");
    const access = await ctx.project(projectId);
    if (access < AccessLevel.VIEW) return notFound("Project"); // don't reveal it exists
    if (access < min) return forbidden();
    return { project, access };
  }

  private async requireTask(ctx: AccessContext, taskId: number, min: AccessLevel) {
    const task = await store.getTask(taskId);
    if (!task) return notFound("Task");
    const project = await store.getProject(task.project_id);
    if (!project) return notFound("Task");
    const access = await ctx.project(project.id);
    if (access < AccessLevel.VIEW) return notFound("Task");
    if (access < min) return forbidden();
    return { task, project, access };
  }

  private async canManageTags(ctx: AccessContext): Promise<boolean> {
    if (await ctx.projectCreator()) return true;
    for (const p of await store.listProjects()) {
      if ((await ctx.project(p.id)) >= AccessLevel.CONTRIBUTE) return true;
    }
    return false;
  }

  private async summarize(row: store.TaskRow, project?: store.ProjectRow): Promise<TaskSummary> {
    const [tags, comments, files] = await Promise.all([
      store.taskTagIds([row.id]),
      store.commentCounts([row.id]),
      store.attachmentCounts([row.id]),
    ]);
    return store.toTaskSummary(row, {
      tagIds: tags.get(row.id),
      commentCount: comments.get(row.id),
      attachmentCount: files.get(row.id),
      project,
    });
  }

  private async summarizeMany(rows: store.TaskRow[], projects?: Map<number, store.ProjectRow>): Promise<TaskSummary[]> {
    const ids = rows.map((r) => r.id);
    const [tags, comments, files] = await Promise.all([
      store.taskTagIds(ids),
      store.commentCounts(ids),
      store.attachmentCounts(ids),
    ]);
    return rows.map((r) =>
      store.toTaskSummary(r, {
        tagIds: tags.get(r.id),
        commentCount: comments.get(r.id),
        attachmentCount: files.get(r.id),
        project: projects?.get(r.project_id),
      }),
    );
  }

  private async projectSummary(
    row: store.ProjectRow,
    userId: string,
    access: AccessLevel,
  ): Promise<ProjectSummary> {
    const [counts, favorites] = await Promise.all([store.projectCounts(row.id), store.favoriteProjectIds(userId)]);
    return store.toProjectSummary(row, counts, favorites.has(row.id), access);
  }

  private async loadComment(commentId: number): Promise<Comment | undefined> {
    const row = await store.getComment(commentId);
    if (!row) return undefined;
    const attachments = (await store.listCommentAttachments(row.task_id)).get(row.id) ?? [];
    return store.toComment(row, attachments);
  }

  // ---- broadcasts (never throw) ----

  private async projectAudience(projectId: number): Promise<Client[]> {
    const clients = rootServer.clients.getClients();
    const audience: Client[] = [];
    for (const c of clients) {
      if ((await new AccessContext(c.userId).project(projectId)) >= AccessLevel.VIEW) audience.push(c);
    }
    return audience;
  }

  emitProjectChanged(projectId: number, deleted = false): void {
    try {
      this.broadcastProjectChanged({ projectId, deleted }, "all");
    } catch (err) {
      log("error", "broadcast ProjectChanged failed", { projectId, ...errFields(err) });
    }
  }

  emitAccessChanged(): void {
    try {
      this.broadcastAccessChanged({}, "all");
    } catch (err) {
      log("error", "broadcast AccessChanged failed", errFields(err));
    }
  }

  private emitTagsChanged(): void {
    try {
      this.broadcastTagsChanged({}, "all");
    } catch (err) {
      log("error", "broadcast TagsChanged failed", errFields(err));
    }
  }

  private emitTaskChanged(projectId: number, taskId: number, deleted = false): void {
    void (async () => {
      try {
        const [task, project, counts] = await Promise.all([
          deleted ? Promise.resolve(undefined) : store.getTask(taskId),
          store.getProject(projectId),
          store.projectCounts(projectId),
        ]);
        if (!project) return;
        const summary = task ? await this.summarize(task, project) : undefined;
        const audience = await this.projectAudience(projectId);
        if (audience.length === 0) return;
        this.broadcastTaskChanged(
          {
            projectId,
            taskId,
            deleted: deleted || !task,
            task: summary,
            counts,
            projectUpdatedAt: project.updated_at,
          },
          audience,
        );
      } catch (err) {
        log("error", "broadcast TaskChanged failed", { projectId, taskId, ...errFields(err) });
      }
    })();
  }

  // ---- me / roles ----

  async getMe(_request: GetMeRequest, client: Client): Promise<GetMeResponse> {
    return handle("getMe", client, async () => {
      const ctx = new AccessContext(client.userId);
      return {
        userId: client.userId,
        isAdmin: await ctx.admin(),
        canCreateProjects: await ctx.projectCreator(),
        canManageTags: await this.canManageTags(ctx),
      };
    });
  }

  async listRoles(_request: ListRolesRequest, client: Client): Promise<ListRolesResponse> {
    return handle("listRoles", client, async () => {
      if (!rolesCache || Date.now() - rolesCache.at > ROLES_TTL_MS) {
        const roles = await withRetry("communityRoles.list", () => rootServer.community.communityRoles.list());
        rolesCache = {
          at: Date.now(),
          roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.colorHex ?? "" })),
        };
      }
      return { roles: rolesCache.roles };
    });
  }

  // ---- projects ----

  async listProjects(request: ListProjectsRequest, client: Client): Promise<ListProjectsResponse> {
    return handle("listProjects", client, async () => {
      const ctx = new AccessContext(client.userId);
      const rows = await store.listProjects(request.archived);
      const visible: Array<{ row: store.ProjectRow; access: AccessLevel }> = [];
      for (const row of rows) {
        const access = await ctx.project(row.id);
        if (access >= AccessLevel.VIEW) visible.push({ row, access });
      }
      const [counts, favorites] = await Promise.all([
        store.phaseCounts(visible.map((v) => v.row.id)),
        store.favoriteProjectIds(client.userId),
      ]);
      return {
        projects: visible.map(({ row, access }) =>
          store.toProjectSummary(row, counts.get(row.id) ?? store.emptyCounts(), favorites.has(row.id), access),
        ),
      };
    });
  }

  async getProject(request: GetProjectRequest, client: Client): Promise<GetProjectResponse> {
    return handle("getProject", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project, access } = await this.requireProject(ctx, request.projectId, AccessLevel.VIEW);
      const summary = await this.projectSummary(project, client.userId, access);
      const permissions =
        access >= AccessLevel.MANAGE ? toProtoPermissions(await getProjectPermissions(project.id)) : undefined;
      return { project: summary, permissions };
    });
  }

  async createProject(request: CreateProjectRequest, client: Client): Promise<CreateProjectResponse> {
    return handle("createProject", client, async () => {
      const ctx = new AccessContext(client.userId);
      if (!(await ctx.projectCreator())) forbidden("Only Task Tracker project creators can create projects");

      const name = requiredText(request.name, LIMITS.projectName, "Project name");
      const description = optionalText(request.description, LIMITS.projectDescription, "Description");
      const identifier = cleanIdentifier(request.identifier, name);

      let perms: Permissions;
      if (request.permissions) {
        perms = cleanPermissions(request.permissions);
      } else {
        perms = {
          view: { userIds: [], roleIds: [] },
          contribute: { userIds: [], roleIds: [EVERYONE_ROLE_ID] },
          manage: { userIds: [], roleIds: [] },
        };
      }
      if (isEmptySelection(perms.manage)) perms.manage = { userIds: [client.userId], roleIds: [] };

      const imageUri = request.imageToken ? await convertImageToken(request.imageToken) : "";
      const now = Date.now();
      const id = await store.insertProject({ name, description, identifier, imageUri, createdBy: client.userId, now });
      try {
        await createProjectGroups(id, perms);
      } catch (err) {
        await store.deleteProjectCascade(id).catch(() => undefined);
        throw err;
      }

      const row = (await store.getProject(id))!;
      const access = await new AccessContext(client.userId).project(id);
      this.emitProjectChanged(id);
      return { project: await this.projectSummary(row, client.userId, access) };
    });
  }

  async updateProject(request: UpdateProjectRequest, client: Client): Promise<UpdateProjectResponse> {
    return handle("updateProject", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.MANAGE);
      assertWritable(project);

      const name = requiredText(request.name, LIMITS.projectName, "Project name");
      const description = optionalText(request.description, LIMITS.projectDescription, "Description");
      const identifier = cleanIdentifier(request.identifier, name);

      let perms: Permissions | undefined;
      if (request.permissions) {
        perms = cleanPermissions(request.permissions);
        if (isEmptySelection(perms.manage)) invalid("Manage all tasks needs at least one member or role");
      }

      let imageUri = project.image_uri;
      if (request.removeImage) imageUri = "";
      else if (request.imageToken) imageUri = await convertImageToken(request.imageToken);

      const now = Date.now();
      await store.updateProject(project.id, { name, description, identifier, imageUri, now });
      if (perms) await updateProjectGroups(project.id, perms);

      const row = (await store.getProject(project.id))!;
      const access = await new AccessContext(client.userId).project(project.id);
      this.emitProjectChanged(project.id);
      return { project: await this.projectSummary(row, client.userId, access) };
    });
  }

  async setProjectArchived(request: SetProjectArchivedRequest, client: Client): Promise<SetProjectArchivedResponse> {
    return handle("setProjectArchived", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.MANAGE);
      if ((project.archived === 1) !== request.archived) {
        await store.setProjectArchived(project.id, request.archived, Date.now());
        this.emitProjectChanged(project.id);
      }
      return {};
    });
  }

  async deleteProject(request: DeleteProjectRequest, client: Client): Promise<DeleteProjectResponse> {
    return handle("deleteProject", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.MANAGE);
      await store.deleteProjectCascade(project.id);
      await deleteProjectGroups(project.id);
      this.emitProjectChanged(project.id, true);
      return {};
    });
  }

  async setFavorite(request: SetFavoriteRequest, client: Client): Promise<SetFavoriteResponse> {
    return handle("setFavorite", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.VIEW);
      await store.setFavorite(client.userId, project.id, request.favorite);
      return {};
    });
  }

  // ---- tasks ----

  async listTasks(request: ListTasksRequest, client: Client): Promise<ListTasksResponse> {
    return handle("listTasks", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.VIEW);
      const rows = await store.listTasksByProject(project.id);
      return { tasks: await this.summarizeMany(rows, new Map([[project.id, project]])) };
    });
  }

  async listMyTasks(_request: ListMyTasksRequest, client: Client): Promise<ListMyTasksResponse> {
    return handle("listMyTasks", client, async () => {
      const ctx = new AccessContext(client.userId);
      const roleIds = await rolesOfMember(client.userId);
      const rows = await store.listOpenTasksForAssignee(client.userId, roleIds);
      const projects = new Map<number, store.ProjectRow>();
      const visible: store.TaskRow[] = [];
      for (const row of rows) {
        if ((await ctx.project(row.project_id)) < AccessLevel.VIEW) continue;
        if (!projects.has(row.project_id)) {
          const p = await store.getProject(row.project_id);
          if (!p) continue;
          projects.set(p.id, p);
        }
        visible.push(row);
      }
      return { tasks: await this.summarizeMany(visible, projects) };
    });
  }

  async getTask(request: GetTaskRequest, client: Client): Promise<GetTaskResponse> {
    return handle("getTask", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { task, project, access } = await this.requireTask(ctx, request.taskId, AccessLevel.VIEW);
      const [summary, attachments, comments, commentFiles, activity, projectSummary] = await Promise.all([
        this.summarize(task, project),
        store.listTaskAttachments(task.id),
        store.listComments(task.id),
        store.listCommentAttachments(task.id),
        store.listActivity(task.id),
        this.projectSummary(project, client.userId, access),
      ]);
      return {
        task: {
          summary,
          description: task.description,
          attachments: attachments.map(store.toAttachment),
          comments: comments.map((c) => store.toComment(c, commentFiles.get(c.id) ?? [])),
          activity: activity.map(store.toActivity),
        },
        project: projectSummary,
      };
    });
  }

  async createTask(request: CreateTaskRequest, client: Client): Promise<CreateTaskResponse> {
    return handle("createTask", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.CONTRIBUTE);
      assertWritable(project);

      const name = requiredText(request.name, LIMITS.taskName, "Task name");
      const description = cleanDescription(request.description);
      const status = cleanStatus(request.status, TaskStatus.PLANNED);
      const priority = cleanPriority(request.priority, TaskPriority.MID);
      const assignee = cleanAssignee(request.assignee);
      const dueDate = cleanDueDate(request.dueDate);
      const requestedTags = uniqueIds(request.tagIds);
      if (requestedTags.length > LIMITS.tagsPerTask) limitReached("A task can have up to 20 tags");
      const tagIds = await store.existingTagIds(requestedTags);
      const attachmentIds = uniqueIds(request.attachmentIds).slice(0, LIMITS.attachmentsPerTask);

      const taskId = await store.insertTask({
        projectId: project.id,
        name,
        description,
        status,
        priority,
        assigneeKind: assignee.kind,
        assigneeId: assignee.id,
        dueDate,
        tagIds,
        createdBy: client.userId,
        now: Date.now(),
        attachmentIds,
      });

      const row = (await store.getTask(taskId))!;
      this.emitTaskChanged(project.id, taskId);
      if (assignee.kind !== AssigneeKind.NONE) void notifyAssigned(row, project, client.userId);
      return { task: await this.summarize(row, project) };
    });
  }

  async updateTask(request: UpdateTaskRequest, client: Client): Promise<UpdateTaskResponse> {
    return handle("updateTask", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { task, project, access } = await this.requireTask(ctx, request.taskId, AccessLevel.CONTRIBUTE);
      if (!canEditTask(access, task, client.userId)) forbidden("You can only edit tasks you created");
      assertWritable(project);

      const changes: store.TaskChanges = {};
      const activity: Array<{ kind: ActivityKind; from: string; to: string }> = [];

      if (request.name !== undefined) {
        const name = requiredText(request.name, LIMITS.taskName, "Task name");
        if (name !== task.name) changes.name = name;
      }
      if (request.description !== undefined) {
        const description = cleanDescription(request.description);
        if (description !== task.description) changes.description = description;
      }
      if (request.status !== undefined) {
        const status = cleanStatus(request.status, task.status as TaskStatus);
        if (status !== task.status) {
          changes.status = status;
          activity.push({ kind: ActivityKind.STATUS, from: String(task.status), to: String(status) });
        }
      }
      if (request.priority !== undefined) {
        const priority = cleanPriority(request.priority, task.priority as TaskPriority);
        if (priority !== task.priority) {
          changes.priority = priority;
          activity.push({ kind: ActivityKind.PRIORITY, from: String(task.priority), to: String(priority) });
        }
      }
      let assigneeChanged = false;
      if (request.clearAssignee || request.assignee) {
        const next = request.clearAssignee ? { kind: AssigneeKind.NONE, id: "" } : cleanAssignee(request.assignee);
        if (next.kind !== task.assignee_kind || next.id !== task.assignee_id) {
          assigneeChanged = true;
          changes.assigneeKind = next.kind;
          changes.assigneeId = next.id;
          activity.push({
            kind: ActivityKind.ASSIGNEE,
            from: assigneeValue(task.assignee_kind, task.assignee_id),
            to: assigneeValue(next.kind, next.id),
          });
        }
      }
      if (request.dueDate !== undefined) {
        const dueDate = cleanDueDate(request.dueDate);
        if (dueDate !== task.due_date) {
          changes.dueDate = dueDate;
          activity.push({ kind: ActivityKind.DUE_DATE, from: task.due_date, to: dueDate });
        }
      }

      let tagIds: number[] | undefined;
      if (request.setTags) {
        const requested = uniqueIds(request.tagIds);
        if (requested.length > LIMITS.tagsPerTask) limitReached("A task can have up to 20 tags");
        const next = await store.existingTagIds(requested);
        const current = (await store.taskTagIds([task.id])).get(task.id) ?? [];
        const added = next.filter((id) => !current.includes(id));
        const removed = current.filter((id) => !next.includes(id));
        if (added.length > 0 || removed.length > 0) {
          tagIds = next;
          const names = await store.tagNames([...added, ...removed]);
          for (const id of added) {
            activity.push({ kind: ActivityKind.TAG_ADDED, from: String(id), to: names.get(id) ?? "" });
          }
          for (const id of removed) {
            activity.push({ kind: ActivityKind.TAG_REMOVED, from: String(id), to: names.get(id) ?? "" });
          }
        }
      }

      if (Object.keys(changes).length === 0 && !tagIds) {
        return { task: await this.summarize(task, project) };
      }

      await store.updateTask(task.id, changes, tagIds, activity, client.userId, project.id, Date.now());
      const updated = (await store.getTask(task.id))!;
      this.emitTaskChanged(project.id, task.id);

      if (assigneeChanged) {
        const previous =
          task.assignee_kind === AssigneeKind.NONE
            ? undefined
            : { kind: task.assignee_kind as AssigneeKind, id: task.assignee_id };
        void notifyUnassigned(updated, project, client.userId, previous);
        void notifyAssigned(updated, project, client.userId);
      }
      if (changes.status !== undefined) void notifyMoved(updated, project, client.userId);

      return { task: await this.summarize(updated, project) };
    });
  }

  async deleteTask(request: DeleteTaskRequest, client: Client): Promise<DeleteTaskResponse> {
    return handle("deleteTask", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { task, project, access } = await this.requireTask(ctx, request.taskId, AccessLevel.CONTRIBUTE);
      if (!canEditTask(access, task, client.userId)) forbidden("You can only delete tasks you created");
      assertWritable(project);
      await store.deleteTaskCascade(task.id, project.id, Date.now());
      this.emitTaskChanged(project.id, task.id, true);
      return {};
    });
  }

  // ---- attachments ----

  async uploadAttachments(request: UploadAttachmentsRequest, client: Client): Promise<UploadAttachmentsResponse> {
    return handle("uploadAttachments", client, async () => {
      const ctx = new AccessContext(client.userId);
      const tokens = [...new Set((request.tokens ?? []).filter((t) => typeof t === "string" && t.length > 0))];
      if (tokens.length === 0) invalid("No files were uploaded");
      if (tokens.length > LIMITS.filesPerUpload) limitReached("You can attach up to 20 files at a time");

      const now = Date.now();

      if (request.target === AttachTarget.TASK) {
        const { task, project, access } = await this.requireTask(ctx, request.taskId, AccessLevel.CONTRIBUTE);
        if (!canEditTask(access, task, client.userId)) forbidden("You can only attach files to tasks you can edit");
        assertWritable(project);
        const existing = await store.countTaskAttachments(task.id);
        if (existing + tokens.length > LIMITS.attachmentsPerTask) {
          limitReached("A task can have up to 100 attachments");
        }
        const assets = await convertUploadTokens(tokens);
        const ids = await store.insertAttachments(assets, {
          projectId: project.id,
          taskId: task.id,
          draft: false,
          uploadedBy: client.userId,
          now,
        });
        for (const asset of assets) {
          await store.addActivity(task.id, client.userId, ActivityKind.ATTACHMENT_ADDED, "", asset.fileName, now);
        }
        await store.touchTask(task.id, project.id, now);
        this.emitTaskChanged(project.id, task.id);
        return { attachments: (await store.getAttachmentsByIds(ids)).map(store.toAttachment) };
      }

      if (request.target === AttachTarget.DRAFT) {
        let projectId: number;
        let taskId = 0;
        if (request.taskId) {
          const { task, project } = await this.requireTask(ctx, request.taskId, AccessLevel.CONTRIBUTE);
          assertWritable(project);
          projectId = project.id;
          taskId = task.id;
        } else {
          const { project } = await this.requireProject(ctx, request.projectId, AccessLevel.CONTRIBUTE);
          assertWritable(project);
          projectId = project.id;
        }
        const assets = await convertUploadTokens(tokens);
        const ids = await store.insertAttachments(assets, {
          projectId,
          taskId,
          draft: true,
          uploadedBy: client.userId,
          now,
        });
        return { attachments: (await store.getAttachmentsByIds(ids)).map(store.toAttachment) };
      }

      return invalid("Unknown upload target");
    });
  }

  async deleteAttachment(request: DeleteAttachmentRequest, client: Client): Promise<DeleteAttachmentResponse> {
    return handle("deleteAttachment", client, async () => {
      const att = await store.getAttachment(request.attachmentId);
      if (!att) return notFound("Attachment");

      if (att.draft === 1) {
        if (att.uploaded_by !== client.userId) return notFound("Attachment");
        await store.deleteAttachment(att.id);
        return {};
      }

      const ctx = new AccessContext(client.userId);
      const { task, project, access } = await this.requireTask(ctx, att.task_id, AccessLevel.VIEW);
      assertWritable(project);

      if (att.comment_id) {
        const comment = await store.getComment(att.comment_id);
        if (!comment || comment.author_id !== client.userId) {
          forbidden("Only the comment's author can remove its files");
        }
        await store.deleteAttachment(att.id);
        await store.touchTask(task.id, project.id, Date.now());
      } else {
        const allowed =
          canEditTask(access, task, client.userId) ||
          (access >= AccessLevel.CONTRIBUTE && att.uploaded_by === client.userId);
        if (!allowed) forbidden("You can't remove this file");
        const now = Date.now();
        await store.deleteAttachment(att.id);
        await store.addActivity(task.id, client.userId, ActivityKind.ATTACHMENT_REMOVED, "", att.file_name, now);
        await store.touchTask(task.id, project.id, now);
      }
      this.emitTaskChanged(project.id, task.id);
      return {};
    });
  }

  // ---- comments ----

  private async validDraftIds(
    ids: number[],
    userId: string,
    projectId: number,
    taskId: number,
  ): Promise<number[]> {
    const rows = await store.getAttachmentsByIds(ids);
    return rows
      .filter(
        (a) =>
          a.draft === 1 &&
          a.uploaded_by === userId &&
          a.project_id === projectId &&
          (a.task_id === 0 || a.task_id === taskId),
      )
      .map((a) => a.id);
  }

  async createComment(request: CreateCommentRequest, client: Client): Promise<CreateCommentResponse> {
    return handle("createComment", client, async () => {
      const ctx = new AccessContext(client.userId);
      const { task, project } = await this.requireTask(ctx, request.taskId, AccessLevel.CONTRIBUTE);
      assertWritable(project);

      const body = optionalText(request.body, LIMITS.commentLength, "Comment");
      const requested = uniqueIds(request.attachmentIds);
      if (requested.length > LIMITS.attachmentsPerComment) limitReached("A comment can have up to 10 files");
      const attachmentIds = await this.validDraftIds(requested, client.userId, project.id, task.id);
      if (!body && attachmentIds.length === 0) invalid("Write a comment or attach a file");
      if ((await store.countComments(task.id)) >= LIMITS.commentsPerTask) {
        limitReached("This task has reached the 50 comment limit");
      }

      const commentId = await store.insertComment({
        taskId: task.id,
        projectId: project.id,
        authorId: client.userId,
        body,
        attachmentIds,
        now: Date.now(),
      });

      this.emitTaskChanged(project.id, task.id);
      void notifyCommented(task, project, client.userId, body, attachmentIds.length);
      return { comment: await this.loadComment(commentId) };
    });
  }

  async updateComment(request: UpdateCommentRequest, client: Client): Promise<UpdateCommentResponse> {
    return handle("updateComment", client, async () => {
      const comment = await store.getComment(request.commentId);
      if (!comment) return notFound("Comment");
      const ctx = new AccessContext(client.userId);
      const { task, project } = await this.requireTask(ctx, comment.task_id, AccessLevel.VIEW);
      if (comment.author_id !== client.userId) forbidden("You can only edit your own comments");
      assertWritable(project);

      const body = optionalText(request.body, LIMITS.commentLength, "Comment");
      const current = (await store.listCommentAttachments(task.id)).get(comment.id) ?? [];
      const removeIds = uniqueIds(request.removeAttachmentIds).filter((id) => current.some((a) => a.id === id));
      const addIds = await this.validDraftIds(
        uniqueIds(request.addAttachmentIds),
        client.userId,
        project.id,
        task.id,
      );
      const remaining = current.length - removeIds.length + addIds.length;
      if (remaining > LIMITS.attachmentsPerComment) limitReached("A comment can have up to 10 files");
      if (!body && remaining === 0) invalid("Write a comment or attach a file");

      await store.updateComment({
        commentId: comment.id,
        taskId: task.id,
        projectId: project.id,
        authorId: client.userId,
        body,
        addIds,
        removeIds,
        now: Date.now(),
      });

      this.emitTaskChanged(project.id, task.id);
      return { comment: await this.loadComment(comment.id) };
    });
  }

  async deleteComment(request: DeleteCommentRequest, client: Client): Promise<DeleteCommentResponse> {
    return handle("deleteComment", client, async () => {
      const comment = await store.getComment(request.commentId);
      if (!comment) return notFound("Comment");
      const ctx = new AccessContext(client.userId);
      const { task, project } = await this.requireTask(ctx, comment.task_id, AccessLevel.VIEW);
      if (comment.author_id !== client.userId) forbidden("You can only delete your own comments");
      assertWritable(project);
      await store.deleteComment(comment.id);
      await store.touchTask(task.id, project.id, Date.now());
      this.emitTaskChanged(project.id, task.id);
      return {};
    });
  }

  // ---- tags ----

  async listTags(_request: ListTagsRequest, client: Client): Promise<ListTagsResponse> {
    return handle("listTags", client, async () => ({ tags: (await store.listTags()).map(store.toTag) }));
  }

  async createTag(request: CreateTagRequest, client: Client): Promise<CreateTagResponse> {
    return handle("createTag", client, async () => {
      if (!(await this.canManageTags(new AccessContext(client.userId)))) forbidden();
      const name = cleanTagName(request.name);
      const color = cleanColor(request.color);
      if (await store.findTagByName(name)) invalid("A tag with that name already exists");
      const id = await store.insertTag(name, color, Date.now());
      this.emitTagsChanged();
      return { tag: store.toTag((await store.getTag(id))!) };
    });
  }

  async updateTag(request: UpdateTagRequest, client: Client): Promise<UpdateTagResponse> {
    return handle("updateTag", client, async () => {
      if (!(await this.canManageTags(new AccessContext(client.userId)))) forbidden();
      const tag = await store.getTag(request.tagId);
      if (!tag) return notFound("Tag");
      const name = cleanTagName(request.name);
      const color = cleanColor(request.color);
      const clash = await store.findTagByName(name);
      if (clash && clash.id !== tag.id) invalid("A tag with that name already exists");
      await store.updateTag(tag.id, name, color);
      this.emitTagsChanged();
      return { tag: store.toTag((await store.getTag(tag.id))!) };
    });
  }

  async deleteTag(request: DeleteTagRequest, client: Client): Promise<DeleteTagResponse> {
    return handle("deleteTag", client, async () => {
      if (!(await this.canManageTags(new AccessContext(client.userId)))) forbidden();
      const tag = await store.getTag(request.tagId);
      if (!tag) return notFound("Tag");
      await store.deleteTag(tag.id);
      this.emitTagsChanged();
      return {};
    });
  }
}

export const trackerService = new TrackerService();
