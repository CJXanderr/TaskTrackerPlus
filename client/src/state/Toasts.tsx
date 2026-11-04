import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { errorMessage } from "../lib/api";

type ToastKind = "error" | "success" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  show: (text: string, kind?: ToastKind) => void;
  error: (err: unknown, fallback?: string) => void;
}

const Ctx = createContext<ToastApi | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const error = useCallback(
    (err: unknown, fallback?: string) => {
      console.error(err);
      const msg = errorMessage(err);
      show(fallback && msg.startsWith("Something went wrong") ? fallback : msg, "error");
    },
    [show],
  );

  const api = useMemo(() => ({ show, error }), [show, error]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
            <span>{t.text}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
};

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
