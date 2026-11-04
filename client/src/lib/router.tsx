import React, { useSyncExternalStore } from "react";

// ============================================================================
// Minimal path router. Root opens deep links (notifications) by loading the
// app at a relative URL such as /project/4/task/12, so routes are real paths.
// ============================================================================

export type Route =
  | { name: "home" }
  | { name: "myTasks" }
  | { name: "archived" }
  | { name: "tags" }
  | { name: "project"; projectId: number }
  | { name: "task"; projectId: number; taskId: number };

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

function snapshot(): string {
  return window.location.pathname;
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const id = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : NaN);
  if (parts[0] === "my-tasks") return { name: "myTasks" };
  if (parts[0] === "archived") return { name: "archived" };
  if (parts[0] === "tags") return { name: "tags" };
  if (parts[0] === "project") {
    const projectId = id(parts[1]);
    if (!Number.isNaN(projectId)) {
      if (parts[2] === "task") {
        const taskId = id(parts[3]);
        if (!Number.isNaN(taskId)) return { name: "task", projectId, taskId };
      }
      return { name: "project", projectId };
    }
  }
  return { name: "home" };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case "home":
      return "/";
    case "myTasks":
      return "/my-tasks";
    case "archived":
      return "/archived";
    case "tags":
      return "/tags";
    case "project":
      return `/project/${route.projectId}`;
    case "task":
      return `/project/${route.projectId}/task/${route.taskId}`;
  }
}

export function navigate(to: Route | string, opts: { replace?: boolean } = {}): void {
  const path = typeof to === "string" ? to : routePath(to);
  if (path === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  for (const cb of listeners) cb();
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, snapshot, snapshot);
  return parseRoute(path);
}

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: Route;
}

export const Link: React.FC<LinkProps> = ({ to, onClick, children, ...rest }) => {
  const href = routePath(to);
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
};
