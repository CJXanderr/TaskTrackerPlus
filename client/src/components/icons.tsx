import React from "react";
import { TaskPriority, TaskStatus } from "@tasktrackerplus/gen-shared";
import { phase, priorityMeta } from "../lib/phases";

// Phase glyphs: dashed ring → ring → half → three-quarter → check / cross.
export const StatusIcon: React.FC<{ status: TaskStatus; size?: number }> = ({ status, size = 14 }) => {
  const { color, label } = phase(status);
  const r = 6;
  const c = 2 * Math.PI * r;
  const common = { width: size, height: size, viewBox: "0 0 16 16", role: "img", "aria-label": label };
  switch (status) {
    case TaskStatus.BACKLOG:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="2.2 2.2" />
        </svg>
      );
    case TaskStatus.PLANNED:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="1.6" />
        </svg>
      );
    case TaskStatus.IN_PROGRESS:
    case TaskStatus.IN_REVIEW: {
      const fraction = status === TaskStatus.IN_PROGRESS ? 0.5 : 0.75;
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="1.6" />
          <circle
            cx="8"
            cy="8"
            r={r / 2}
            fill="none"
            stroke={color}
            strokeWidth={r}
            strokeDasharray={`${(c / 2) * fraction} ${c}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
      );
    }
    case TaskStatus.DONE:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case TaskStatus.CANCELLED:
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
};

// Signal-bar priority glyph.
export const PriorityIcon: React.FC<{ priority: TaskPriority; size?: number }> = ({ priority, size = 14 }) => {
  const meta = priorityMeta(priority);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={`${meta.label} priority`}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4.5}
          y={10 - i * 3.5}
          width="3"
          height={4 + i * 3.5}
          rx="1"
          fill={i < meta.bars ? meta.color : "var(--rootsdk-border)"}
        />
      ))}
    </svg>
  );
};
