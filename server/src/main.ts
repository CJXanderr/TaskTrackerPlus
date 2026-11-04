import { rootServer, RootAppStartState } from "@rootsdk/server-app";
import { openDatabase, migrate } from "./db";
import { initAccess, onAccessChanged, onProjectGroupChanged, preloadGroups } from "./access";
import * as store from "./store";
import { trackerService } from "./trackerService";
import { log, errFields } from "./lib/log";

// ============================================================================
// Startup order:
//   1. Database open + schema.
//   2. Access: community owner, admin / project-creator settings, listeners.
//   3. Warm the per-project member groups (View / Contribute / Manage).
//   4. Live-update wiring for settings and role-membership changes.
//   5. Hourly sweep of abandoned draft attachments.
//   6. Register the RPC service.
// ============================================================================

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

function debounce(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
}

async function sweepDrafts(): Promise<void> {
  try {
    const removed = await store.deleteStaleDrafts(Date.now() - DRAFT_TTL_MS);
    if (removed > 0) log("info", "removed abandoned draft attachments", { removed });
  } catch (err) {
    log("warn", "draft sweep failed", errFields(err));
  }
}

async function onStarting(state: RootAppStartState): Promise<void> {
  await openDatabase();
  await migrate();
  log("info", "database ready");

  await initAccess(state);
  const projects = await store.listProjects();
  await preloadGroups(projects.map((p) => p.id));

  onAccessChanged(debounce(() => trackerService.emitAccessChanged(), 500));

  const pendingProjects = new Set<number>();
  const flushProjects = debounce(() => {
    for (const id of pendingProjects) trackerService.emitProjectChanged(id);
    pendingProjects.clear();
  }, 500);
  onProjectGroupChanged((projectId) => {
    pendingProjects.add(projectId);
    flushProjects();
  });

  await sweepDrafts();
  setInterval(() => void sweepDrafts(), SWEEP_EVERY_MS).unref();

  rootServer.lifecycle.addService(trackerService);
  log("info", "Task Tracker+ started", { projects: projects.length });
}

(async () => {
  try {
    await rootServer.lifecycle.start(onStarting);
  } catch (err) {
    log("error", "lifecycle.start failed — app did not start", errFields(err));
    throw err;
  }
})();
