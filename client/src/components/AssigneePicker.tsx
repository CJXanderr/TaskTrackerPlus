import React, { useRef, useState } from "react";
import { ChevronDown, UserRoundX } from "lucide-react";
import { Assignee, AssigneeKind } from "@tasktrackerplus/gen-shared";
import { Popover } from "./ui";
import { AssigneeView } from "./people";
import { RootUserRoleSelector } from "./RootUserRoleSelector";

// Compact assignee control: shows the current member/role and opens Root's
// member + role selector in a popover (single selection).
export const AssigneePicker: React.FC<{
  value: Assignee | undefined;
  onChange: (next: Assignee | undefined) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const has = !!value && value.kind !== AssigneeKind.NONE && !!value.id;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="assignee-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <AssigneeView assignee={value} />
        {!disabled && <ChevronDown size={14} className="assignee-chevron" />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={320} className="assignee-popover">
        <div className="assignee-popover-body">
          <RootUserRoleSelector
            mode="single"
            selectedUserIds={value?.kind === AssigneeKind.USER ? [value.id] : []}
            selectedRoleIds={value?.kind === AssigneeKind.ROLE ? [value.id] : []}
            onSelectionChange={(d) => {
              const user = d.selectedUserIds[0];
              const role = d.selectedRoleIds[0];
              const next = user
                ? { kind: AssigneeKind.USER, id: user }
                : role
                  ? { kind: AssigneeKind.ROLE, id: role }
                  : undefined;
              if ((next?.id ?? "") === (value?.id ?? "") && (next?.kind ?? 0) === (value?.kind ?? 0)) return;
              onChange(next);
              if (next) setOpen(false);
            }}
          />
        </div>
        {has && (
          <div className="menu-footer">
            <button
              type="button"
              className="link-quiet"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <UserRoundX size={14} />
              Unassign
            </button>
          </div>
        )}
      </Popover>
    </>
  );
};
