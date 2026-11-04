import { AccessLevel, PhaseCounts, TaskPriority, TaskStatus } from "@tasktrackerplus/gen-shared";

export interface PhaseMeta {
  status: TaskStatus;
  label: string;
  color: string;
  countKey: keyof PhaseCounts;
}

// Board order (stacked top to bottom), same as Root's Task Tracker.
export const PHASES: PhaseMeta[] = [
  { status: TaskStatus.BACKLOG, label: "Backlog", color: "#9AA0A6", countKey: "backlog" },
  { status: TaskStatus.PLANNED, label: "Planned", color: "#3B82F6", countKey: "planned" },
  { status: TaskStatus.IN_PROGRESS, label: "In Progress", color: "#F59E0B", countKey: "inProgress" },
  { status: TaskStatus.IN_REVIEW, label: "In Review", color: "#A855F7", countKey: "inReview" },
  { status: TaskStatus.DONE, label: "Done", color: "#22C55E", countKey: "done" },
  { status: TaskStatus.CANCELLED, label: "Cancelled", color: "#6B7280", countKey: "cancelled" },
];

export function phase(status: TaskStatus): PhaseMeta {
  return PHASES.find((p) => p.status === status) ?? PHASES[1];
}

export function isOpen(status: TaskStatus): boolean {
  return status !== TaskStatus.DONE && status !== TaskStatus.CANCELLED;
}

export interface PriorityMeta {
  priority: TaskPriority;
  label: string;
  description: string;
  color: string;
  bars: number;
}

export const PRIORITIES: PriorityMeta[] = [
  { priority: TaskPriority.HIGH, label: "High", description: "Needs immediate attention", color: "#F97316", bars: 3 },
  { priority: TaskPriority.MID, label: "Mid", description: "Normal importance", color: "#EAB308", bars: 2 },
  { priority: TaskPriority.LOW, label: "Low", description: "Can wait", color: "#9AA0A6", bars: 1 },
];

export function priorityMeta(p: TaskPriority): PriorityMeta {
  return PRIORITIES.find((x) => x.priority === p) ?? PRIORITIES[1];
}

export function totalCount(c: PhaseCounts | undefined): number {
  if (!c) return 0;
  return c.backlog + c.planned + c.inProgress + c.inReview + c.done + c.cancelled;
}

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  [AccessLevel.NONE]: "No access",
  [AccessLevel.VIEW]: "View only",
  [AccessLevel.CONTRIBUTE]: "Contribute tasks",
  [AccessLevel.MANAGE]: "Manage all tasks",
};

export const TAG_SWATCHES = [
  "#84CC16", "#22C55E", "#14B8A6", "#06B6D4", "#3B82F6", "#6366F1",
  "#A855F7", "#EC4899", "#EF4444", "#F97316", "#EAB308", "#9AA0A6",
];
