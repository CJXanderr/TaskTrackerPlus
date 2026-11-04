import {
  rootServer,
  RootAppStartState,
  ReadOnlyMemberGroup,
  MemberGroup,
  UserGuid,
  CommunityRoleGuid,
  CommunityEvent,
  GlobalSettingsEvent,
  MemberGroupEvent,
  WellKnownRootGuids,
  RootGuidUtils,
  RootGuidType,
} from "@rootsdk/server-app";
import { AccessLevel, MemberSelection, ProjectPermissions } from "@tasktrackerplus/gen-shared";
import { withRetry } from "./lib/retry";
import { log, errFields } from "./lib/log";

// ============================================================================
// Who can do what.
//
// Global (manifest settings, configured by the community in Root's app
// settings UI):
//   general.admins          -> "Task Tracker Admins": full access everywhere
//   general.projectCreators -> "Task Tracker Project Creators": may create projects
// The community owner is always treated as an admin so a fresh install is
// usable before anyone has been picked.
//
// Per project: three member groups (users + roles), exactly like Root's
// Task Tracker — View only, Contribute tasks, Manage all tasks. Someone in
// none of them cannot see the project at all.
// ============================================================================

const RESOURCE_TYPE = "project";
const GROUP_NAMES = ["view", "contribute", "manage"] as const;
type GroupName = (typeof GROUP_NAMES)[number];

export const EVERYONE_ROLE_ID: string = WellKnownRootGuids.CommunityRoles.EveryoneRole;

export interface Selection {
  userIds: string[];
  roleIds: string[];
}

export interface Permissions {
  view: Selection;
  contribute: Selection;
  manage: Selection;
}

type Groups = Record<GroupName, MemberGroup>;

let ownerUserId: string | undefined;
const groupCache = new Map<number, Promise<Groups>>();
const accessChangedListeners: Array<() => void> = [];
const projectGroupListeners: Array<(projectId: number) => void> = [];

// --- Startup -------------------------------------------------------------------

export async function initAccess(state: RootAppStartState): Promise<void> {
  const community = await withRetry("communities.get", () => rootServer.community.communities.get());
  ownerUserId = community.ownerUserId;

  rootServer.community.communities.on(CommunityEvent.CommunityEdited, (evt) => {
    if (evt.ownerUserId === ownerUserId) return;
    ownerUserId = evt.ownerUserId;
    fireAccessChanged();
  });

  const settings = rootServer.globalSettings ?? state.globalSettings;
  settings?.on(GlobalSettingsEvent.Update, () => fireAccessChanged());

  // Role membership shifts (someone gains/loses a role) change who is in a
  // group without any action inside the app; surface them as live updates.
  const onGroupChange = (group: { resourceType: string; resourceId: string }) => {
    if (group.resourceType === RESOURCE_TYPE) {
      const projectId = Number(group.resourceId);
      if (Number.isInteger(projectId)) for (const cb of projectGroupListeners) safeCall(() => cb(projectId));
    } else {
      fireAccessChanged();
    }
  };
  rootServer.memberGroups.on(MemberGroupEvent.MembersAdded, (e) => onGroupChange(e.memberGroup));
  rootServer.memberGroups.on(MemberGroupEvent.MembersRemoved, (e) => onGroupChange(e.memberGroup));
  rootServer.memberGroups.on(MemberGroupEvent.StateChanged, (e) => onGroupChange(e.memberGroup));
}

export function onAccessChanged(cb: () => void): void {
  accessChangedListeners.push(cb);
}

export function onProjectGroupChanged(cb: (projectId: number) => void): void {
  projectGroupListeners.push(cb);
}

function fireAccessChanged(): void {
  for (const cb of accessChangedListeners) safeCall(cb);
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log("error", "access listener threw", errFields(err));
  }
}

// --- Global roles ----------------------------------------------------------------

function settingGroup(key: "admins" | "projectCreators"): ReadOnlyMemberGroup | undefined {
  return rootServer.globalSettings?.general?.[key] as ReadOnlyMemberGroup | undefined;
}

async function inGroup(group: ReadOnlyMemberGroup | undefined, userId: string): Promise<boolean> {
  if (!group) return false;
  if ((group.communityRoleIds ?? []).includes(EVERYONE_ROLE_ID as CommunityRoleGuid)) return true;
  try {
    return await group.isMember({ userId: userId as UserGuid });
  } catch (err) {
    // Fail closed on a transient platform error.
    log("warn", "isMember failed; treating as not a member", { userId, ...errFields(err) });
    return false;
  }
}

export async function isAdmin(userId: string): Promise<boolean> {
  if (ownerUserId && userId === ownerUserId) return true;
  return inGroup(settingGroup("admins"), userId);
}

export async function isProjectCreator(userId: string): Promise<boolean> {
  if (await isAdmin(userId)) return true;
  return inGroup(settingGroup("projectCreators"), userId);
}

// --- Per-project groups ------------------------------------------------------------

async function getOrCreateGroup(projectId: number, name: GroupName, sel?: Selection): Promise<MemberGroup> {
  const key = { resourceType: RESOURCE_TYPE, resourceId: String(projectId), name };
  const existing = await rootServer.memberGroups.getByName(key);
  if (existing) {
    if (sel) await existing.update(toUpdate(sel));
    return existing;
  }
  return rootServer.memberGroups.create({ ...key, ...toUpdate(sel ?? { userIds: [], roleIds: [] }) });
}

function toUpdate(sel: Selection): { userIds: UserGuid[]; communityRoleIds: CommunityRoleGuid[] } {
  return {
    userIds: sel.userIds as UserGuid[],
    communityRoleIds: sel.roleIds as CommunityRoleGuid[],
  };
}

function loadGroups(projectId: number): Promise<Groups> {
  let pending = groupCache.get(projectId);
  if (!pending) {
    pending = (async () => {
      const [view, contribute, manage] = await Promise.all(
        GROUP_NAMES.map((name) => getOrCreateGroup(projectId, name)),
      );
      return { view, contribute, manage };
    })();
    groupCache.set(projectId, pending);
    pending.catch(() => groupCache.delete(projectId));
  }
  return pending;
}

export async function preloadGroups(projectIds: number[]): Promise<void> {
  for (const id of projectIds) {
    try {
      await loadGroups(id);
    } catch (err) {
      log("error", "failed to load project member groups", { projectId: id, ...errFields(err) });
    }
  }
}

export async function createProjectGroups(projectId: number, perms: Permissions): Promise<void> {
  const pending = (async () => {
    const [view, contribute, manage] = await Promise.all(
      GROUP_NAMES.map((name) => getOrCreateGroup(projectId, name, perms[name])),
    );
    return { view, contribute, manage } as Groups;
  })();
  groupCache.set(projectId, pending);
  pending.catch(() => groupCache.delete(projectId));
  await pending;
}

export async function updateProjectGroups(projectId: number, perms: Permissions): Promise<void> {
  const groups = await loadGroups(projectId);
  await Promise.all(GROUP_NAMES.map((name) => groups[name].update(toUpdate(perms[name]))));
}

export async function deleteProjectGroups(projectId: number): Promise<void> {
  try {
    const groups = await loadGroups(projectId);
    for (const name of GROUP_NAMES) {
      try {
        await rootServer.memberGroups.delete(groups[name].id);
      } catch (err) {
        log("warn", "failed to delete member group", { projectId, name, ...errFields(err) });
      }
    }
  } finally {
    groupCache.delete(projectId);
  }
}

export async function getProjectPermissions(projectId: number): Promise<Permissions> {
  const groups = await loadGroups(projectId);
  const sel = (g: MemberGroup): Selection => ({
    userIds: [...(g.userIds ?? [])],
    roleIds: [...(g.communityRoleIds ?? [])],
  });
  return { view: sel(groups.view), contribute: sel(groups.contribute), manage: sel(groups.manage) };
}

// --- Access checks -------------------------------------------------------------------

// Resolves a member's access once per request; cheap to reuse across projects.
export class AccessContext {
  private adminPromise?: Promise<boolean>;
  private creatorPromise?: Promise<boolean>;
  private readonly perProject = new Map<number, Promise<AccessLevel>>();

  constructor(readonly userId: string) {}

  admin(): Promise<boolean> {
    return (this.adminPromise ??= isAdmin(this.userId));
  }

  projectCreator(): Promise<boolean> {
    return (this.creatorPromise ??= isProjectCreator(this.userId));
  }

  project(projectId: number): Promise<AccessLevel> {
    let level = this.perProject.get(projectId);
    if (!level) {
      level = this.resolve(projectId);
      this.perProject.set(projectId, level);
    }
    return level;
  }

  private async resolve(projectId: number): Promise<AccessLevel> {
    if (await this.admin()) return AccessLevel.MANAGE;
    let groups: Groups;
    try {
      groups = await loadGroups(projectId);
    } catch (err) {
      log("error", "member groups unavailable; denying access", { projectId, ...errFields(err) });
      return AccessLevel.NONE;
    }
    if (await inGroup(groups.manage, this.userId)) return AccessLevel.MANAGE;
    if (await inGroup(groups.contribute, this.userId)) return AccessLevel.CONTRIBUTE;
    if (await inGroup(groups.view, this.userId)) return AccessLevel.VIEW;
    return AccessLevel.NONE;
  }
}

// --- Input cleaning ----------------------------------------------------------------

function guidType(id: string): RootGuidType | undefined {
  try {
    return RootGuidUtils.toRootGuidType(id);
  } catch {
    return undefined;
  }
}

export function isUserId(id: string): boolean {
  const t = guidType(id);
  return t === RootGuidType.Person || t === RootGuidType.App;
}

export function isRoleId(id: string): boolean {
  return guidType(id) === RootGuidType.CommunityRole;
}

const MAX_SELECTION = 250;

export function cleanSelection(sel: MemberSelection | undefined): Selection {
  const userIds = [...new Set((sel?.userIds ?? []).filter((id) => typeof id === "string" && isUserId(id)))];
  const roleIds = [...new Set((sel?.roleIds ?? []).filter((id) => typeof id === "string" && isRoleId(id)))];
  return { userIds: userIds.slice(0, MAX_SELECTION), roleIds: roleIds.slice(0, MAX_SELECTION) };
}

export function cleanPermissions(p: ProjectPermissions | undefined): Permissions {
  return {
    view: cleanSelection(p?.view),
    contribute: cleanSelection(p?.contribute),
    manage: cleanSelection(p?.manage),
  };
}

export function isEmptySelection(sel: Selection): boolean {
  return sel.userIds.length === 0 && sel.roleIds.length === 0;
}

export function toProtoPermissions(p: Permissions): ProjectPermissions {
  return { view: { ...p.view }, contribute: { ...p.contribute }, manage: { ...p.manage } };
}
