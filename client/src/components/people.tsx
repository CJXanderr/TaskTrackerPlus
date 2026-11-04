import React, { useEffect, useState } from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { Assignee, AssigneeKind } from "@tasktrackerplus/gen-shared";
import { Users } from "lucide-react";
import { useProfiles } from "../state/ProfilesContext";
import { useRoles } from "../state/AppState";

export function useProfile(userId: string | undefined) {
  const { profiles, request } = useProfiles();
  useEffect(() => {
    if (userId) request([userId]);
  }, [userId, request]);
  return userId ? profiles[userId] : undefined;
}

export const Avatar: React.FC<{ userId: string; size?: number }> = ({ userId, size = 24 }) => {
  const profile = useProfile(userId);
  const [failed, setFailed] = useState(false);
  const src = profile?.profilePictureUri
    ? rootClient.assets.toImageUrl(profile.profilePictureUri, ImageUriResolution.Small)
    : undefined;
  useEffect(() => setFailed(false), [src]);
  const name = profile?.nickname ?? "";
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
      title={name}
      onClick={(e) => {
        e.stopPropagation();
        rootClient.users.showUserProfile(userId);
      }}
    >
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{(name.trim()[0] ?? "?").toUpperCase()}</span>
      )}
    </span>
  );
};

export const UserName: React.FC<{ userId: string }> = ({ userId }) => {
  const profile = useProfile(userId);
  return <span className="user-name">{profile?.nickname ?? "…"}</span>;
};

export const RoleBadge: React.FC<{ roleId: string }> = ({ roleId }) => {
  const roles = useRoles();
  const role = roles.get(roleId);
  const color = role?.color || "var(--rootsdk-text-secondary)";
  return (
    <span className="role-badge" style={{ color }}>
      <Users size={12} />
      <span>{role?.name ?? "Role"}</span>
    </span>
  );
};

// Compact assignee display: avatar for a member, role pill for a role.
export const AssigneeView: React.FC<{ assignee: Assignee | undefined; compact?: boolean }> = ({
  assignee,
  compact,
}) => {
  if (!assignee || assignee.kind === AssigneeKind.NONE || !assignee.id) {
    return compact ? <span className="avatar avatar-empty" title="Unassigned" /> : <span className="muted">Unassigned</span>;
  }
  if (assignee.kind === AssigneeKind.ROLE) {
    return <RoleBadge roleId={assignee.id} />;
  }
  return compact ? (
    <Avatar userId={assignee.id} size={22} />
  ) : (
    <span className="person">
      <Avatar userId={assignee.id} size={22} />
      <UserName userId={assignee.id} />
    </span>
  );
};
