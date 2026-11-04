import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";

// ============================================================================
// Small UI primitives styled with Root's design tokens (see styles/app.css).
// ============================================================================

type ButtonVariant = "primary" | "outline" | "quiet" | "danger" | "ghost";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: React.ReactNode;
  busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "outline", size = "md", icon, busy, children, className, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`btn btn-${variant} btn-${size} ${className ?? ""}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <LoaderCircle size={16} className="spin" /> : icon}
      {children !== undefined && <span>{children}</span>}
    </button>
  ),
);
Button.displayName = "Button";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  danger?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, danger, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${danger ? "icon-btn-danger" : ""} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

export const Spinner: React.FC<{ label?: string }> = ({ label = "Loading" }) => (
  <div className="spinner" role="status">
    <LoaderCircle size={22} className="spin" />
    <span className="sr-only">{label}</span>
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; children?: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="empty">
    {icon && <div className="empty-icon">{icon}</div>}
    <div className="empty-title">{title}</div>
    {children && <div className="empty-body">{children}</div>}
  </div>
);

// --- Popover --------------------------------------------------------------------

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  align?: "start" | "end";
  width?: number;
  className?: string;
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = ({ open, onClose, anchor, align = "start", width = 240, className, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const h = ref.current?.offsetHeight ?? 0;
    const placeAbove = h > below && above > below;
    const top = placeAbove ? Math.max(8, r.top - 4 - Math.min(h, above)) : r.bottom + 4;
    setPos({ top, left, maxHeight: Math.max(160, (placeAbove ? above : below) - 4) });
  }, [anchor, align, width]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // Clicks inside Root's user/role selector dropdown (shadow DOM) stay in.
      if ((e.composedPath?.() ?? []).some((n) => n === ref.current)) return;
      onClose();
    };
    // Capture phase + preventDefault: Escape closes only the popover, not a
    // dialog underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("touchstart", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("touchstart", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
    };
  }, [open, onClose, anchor, place]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ""}`}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: Math.min(width, window.innerWidth - 16),
        maxHeight: pos?.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  checked?: boolean;
}

export const MenuList: React.FC<{ items: MenuItem[]; onDone: () => void }> = ({ items, onDone }) => (
  <div className="menu" role="menu">
    {items.map((item) => (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={`menu-item ${item.danger ? "menu-item-danger" : ""} ${item.checked ? "menu-item-checked" : ""}`}
        disabled={item.disabled}
        onClick={() => {
          onDone();
          item.onSelect();
        }}
      >
        {item.icon && <span className="menu-icon">{item.icon}</span>}
        <span className="menu-label">{item.label}</span>
        {item.hint && <span className="menu-hint">{item.hint}</span>}
      </button>
    ))}
  </div>
);

// A button that opens a menu.
export const MenuButton: React.FC<{
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  width?: number;
  children: React.ReactNode;
  className?: string;
}> = ({ label, items, align = "end", width = 220, children, className }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        ref={ref}
        label={label}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {children}
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align={align} width={width}>
        <MenuList items={items} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
};

// --- Modal ------------------------------------------------------------------------

let openModals = 0;

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  className?: string;
}> = ({ title, onClose, children, footer, width = 560, className }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  // Callers pass inline handlers; read the latest one without re-running setup
  // (re-running would steal focus back to the first field on every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openModals++;
    document.body.classList.add("modal-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const first = contentRef.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea");
    first?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals--;
      if (openModals === 0) document.body.classList.remove("modal-open");
    };
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contentRef}
        className={`modal ${className ?? ""}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}> = ({ title, message, confirmLabel, danger = true, onConfirm, onClose }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onClose}
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            busy={busy}
            data-autofocus
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
};

// --- Form field ---------------------------------------------------------------------

export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  counter?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, counter, error, children }) => (
  <div className="field">
    <div className="field-label">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {counter && <span className="field-counter">{counter}</span>}
    </div>
    {children}
    {hint && !error && <span className="field-hint">{hint}</span>}
    {error && <span className="field-error">{error}</span>}
  </div>
);
