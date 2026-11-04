import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { rootClient } from "@rootsdk/client-app";
import { GetMeResponse, Role, Tag } from "@tasktrackerplus/gen-shared";
import { api, TrackerServiceClientEvent, useTrackerEvent } from "../lib/api";

// ============================================================================
// App-wide state: who I am (capabilities), community tags, community roles.
// ============================================================================

interface AppState {
  me: GetMeResponse;
  meLoaded: boolean;
  reloadMe: () => void;
  tags: Tag[];
  tagsById: Map<number, Tag>;
  reloadTags: () => void;
  roles: Map<string, Role>;
  requestRoles: () => void;
}

const Ctx = createContext<AppState | undefined>(undefined);

const EMPTY_ME: GetMeResponse = {
  userId: "",
  isAdmin: false,
  canCreateProjects: false,
  canManageTags: false,
};

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [me, setMe] = useState<GetMeResponse>(() => ({ ...EMPTY_ME, userId: rootClient.users.getCurrentUserId() }));
  const [meLoaded, setMeLoaded] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [roles, setRoles] = useState<Map<string, Role>>(new Map());
  const rolesRequested = useRef(false);

  const reloadMe = useCallback(() => {
    api.getMe({}).then(
      (r) => {
        setMe(r);
        setMeLoaded(true);
      },
      (err) => {
        console.error("[getMe]", err);
        setMeLoaded(true);
      },
    );
  }, []);

  const reloadTags = useCallback(() => {
    api.listTags({}).then(
      (r) => setTags(r.tags),
      (err) => console.error("[listTags]", err),
    );
  }, []);

  const loadRoles = useCallback(() => {
    api.listRoles({}).then(
      (r) => setRoles(new Map(r.roles.map((role) => [role.id, role]))),
      (err) => {
        rolesRequested.current = false;
        console.error("[listRoles]", err);
      },
    );
  }, []);

  const requestRoles = useCallback(() => {
    if (rolesRequested.current) return;
    rolesRequested.current = true;
    loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    reloadMe();
    reloadTags();
  }, [reloadMe, reloadTags]);

  useTrackerEvent(TrackerServiceClientEvent.AccessChanged, () => reloadMe());
  useTrackerEvent(TrackerServiceClientEvent.TagsChanged, () => reloadTags());
  // Project access can change (e.g. first contribute access) which affects
  // whether tags may be managed.
  useTrackerEvent(TrackerServiceClientEvent.ProjectChanged, () => reloadMe());

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const value: AppState = { me, meLoaded, reloadMe, tags, tagsById, reloadTags, roles, requestRoles };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState must be used inside <AppStateProvider>");
  return v;
}

// Role lookup that lazily loads the community's roles the first time.
export function useRoles(): Map<string, Role> {
  const { roles, requestRoles } = useAppState();
  useEffect(() => requestRoles(), [requestRoles]);
  return roles;
}
