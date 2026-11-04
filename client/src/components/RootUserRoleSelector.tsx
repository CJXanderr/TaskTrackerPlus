import React, { useEffect, useRef } from "react";
import "@rootsdk/client-app-ui";

// ============================================================================
// Thin React wrapper around Root's <rootsdk-user-role-selector> web component
// (searchable member + role picker from @rootsdk/client-app-ui).
// ============================================================================

interface SelectorElement extends HTMLElement {
  selectedUserIds: string[];
  selectedRoleIds: string[];
  mode?: "single" | "multi";
  view?: "both" | "roles" | "members";
}

interface SelectorAttributes
  extends Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>, "className" | "ref"> {
  class?: string;
  mode?: "single" | "multi";
  view?: "both" | "roles" | "members";
  ref?: React.Ref<SelectorElement>;
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "rootsdk-user-role-selector": SelectorAttributes;
    }
  }
}

export interface Selection {
  selectedUserIds: string[];
  selectedRoleIds: string[];
}

interface Props {
  selectedUserIds?: string[];
  selectedRoleIds?: string[];
  onSelectionChange?: (detail: Selection) => void;
  mode?: "single" | "multi";
  view?: "both" | "roles" | "members";
  className?: string;
}

export const RootUserRoleSelector: React.FC<Props> = ({
  selectedUserIds = [],
  selectedRoleIds = [],
  onSelectionChange,
  mode = "multi",
  view = "both",
  className,
}) => {
  const ref = useRef<SelectorElement>(null);
  const onChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onSelectionChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => onChangeRef.current?.((e as CustomEvent<Selection>).detail);
    el.addEventListener("rootsdk-user-role-selector:selection-change", handler);
    return () => el.removeEventListener("rootsdk-user-role-selector:selection-change", handler);
  }, []);

  // Push selections only when their contents change (callers pass fresh arrays).
  const usersKey = selectedUserIds.join("\u0000");
  const rolesKey = selectedRoleIds.join("\u0000");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.selectedUserIds = [...selectedUserIds];
    el.selectedRoleIds = [...selectedRoleIds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersKey, rolesKey]);

  return <rootsdk-user-role-selector ref={ref} class={className} mode={mode} view={view} />;
};
