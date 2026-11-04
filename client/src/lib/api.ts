import { useCallback, useEffect, useRef, useState } from "react";
import { RootServerException } from "@rootsdk/client-app";
import {
  trackerServiceClient,
  TrackerServiceClientEvent,
  TrackerServiceClientEvents,
} from "@tasktrackerplus/gen-client";
import { TrackerError, UpdateTaskRequest } from "@tasktrackerplus/gen-shared";

export const api = trackerServiceClient;
export { TrackerServiceClientEvent };

// Partial task update: only the fields present are changed on the server.
export type TaskPatch = Partial<Omit<UpdateTaskRequest, "taskId">>;

export function updateTask(taskId: number, patch: TaskPatch) {
  return trackerServiceClient.updateTask({ taskId, clearAssignee: false, setTags: false, tagIds: [], ...patch });
}

export function errorCode(err: unknown): number | undefined {
  return err instanceof RootServerException ? err.code : undefined;
}

// Server-side app errors carry friendly messages; anything else is generic.
export function errorMessage(err: unknown): string {
  if (err instanceof RootServerException && err.code > 0 && err.message) return err.message;
  if (err instanceof RootServerException && err.code === -8) return "Too many requests — try again in a moment.";
  return "Something went wrong. Please try again.";
}

export function isNotFound(err: unknown): boolean {
  return errorCode(err) === TrackerError.NOT_FOUND;
}

type EventName = keyof TrackerServiceClientEvents;

// Subscribe to a broadcast event for the lifetime of the component. The
// handler is read through a ref so callers can pass inline functions.
export function useTrackerEvent<E extends EventName>(event: E, handler: TrackerServiceClientEvents[E]): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = ((...args: unknown[]) =>
      (ref.current as (...a: unknown[]) => void)(...args)) as TrackerServiceClientEvents[E];
    trackerServiceClient.on(event, listener);
    return () => {
      trackerServiceClient.off(event, listener);
    };
  }, [event]);
}

export interface Query<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (update: (prev: T | undefined) => T | undefined) => void;
}

// Fetch on mount / when deps change; reload() re-runs it (debounced so a
// burst of live events causes a single refetch). Stale responses are dropped.
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runNow = useCallback(() => {
    const mine = ++seq.current;
    fetcherRef.current().then(
      (result) => {
        if (mine !== seq.current) return;
        setDataState(result);
        setError(undefined);
        setLoading(false);
      },
      (err) => {
        if (mine !== seq.current) return;
        setError(err);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    setLoading(true);
    setDataState(undefined);
    setError(undefined);
    runNow();
    return () => {
      seq.current++;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(runNow, 150);
  }, [runNow]);

  const setData = useCallback((update: (prev: T | undefined) => T | undefined) => {
    setDataState((prev) => update(prev));
  }, []);

  return { data, error, loading, reload, setData };
}
