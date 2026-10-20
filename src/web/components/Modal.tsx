/**
 * Modal.tsx — shared portal-based modal shell for the Kova dashboard.
 *
 * Renders into document.body so an ancestor's overflow or transform never
 * clips the overlay. Enters with a 220ms scale/fade (CSS @starting-style).
 * Escape, the backdrop and `useModalClose()` play a 120ms exit first; a
 * parent unmounting the modal directly closes it instantly.
 *
 * Usage:
 *   <Modal onClose={close} maxWidth={480}>
 *     <ModalHeader title="…" subtitle="…" />
 *     <div className="modal-body">…</div>
 *     <div className="modal-footer">…</div>
 *   </Modal>
 *
 * For tall modals, pass scrollableBody and wrap the middle in <ModalScrollBody>.
 */

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 120;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Max width of the modal box in px. Defaults to 480. */
  maxWidth?: number;
  /** Makes the box a flex column so a <ModalScrollBody> can scroll between a fixed header and footer. */
  scrollableBody?: boolean;
}

const ModalContext = createContext<{ close: () => void; titleId: string } | null>(null);

/** Closes the surrounding modal with its exit transition. */
export function useModalClose() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModalClose must be used inside <Modal>");
  return ctx.close;
}

export function Modal({ onClose, children, maxWidth = 480, scrollableBody = false }: ModalProps) {
  const [closing, setClosing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closingRef = useRef(false);
  const pressedOverlay = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  // Lock body scroll while any modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Move focus in on open and back to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) {
      const field = box.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
      (field ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    }
    return () => { trigger?.focus?.(); };
  }, []);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return createPortal(
    <ModalContext.Provider value={{ close, titleId }}>
      <div
        className="modal-overlay"
        data-state={closing ? "closing" : "open"}
        // Only a press that starts and ends on the backdrop closes: a text
        // selection dragged out of a field must not dismiss the dialog.
        onPointerDown={(e) => { pressedOverlay.current = e.target === e.currentTarget; }}
        onClick={(e) => {
          if (pressedOverlay.current && e.target === e.currentTarget) close();
          pressedOverlay.current = false;
        }}
      >
        <div
          ref={boxRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={scrollableBody ? "modal-box is-scrollable" : "modal-box"}
          // React events bubble through portals; keep clicks from reaching the opener's handlers.
          onClick={(e) => e.stopPropagation()}
          style={{ "--modal-width": `${maxWidth}px` } as React.CSSProperties}
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}

/** Title row with an optional icon tile, subtitle and the close button. */
export function ModalHeader({ title, subtitle, icon }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode }) {
  const ctx = useContext(ModalContext);
  return (
    <div className="modal-header">
      {icon}
      <div className="modal-header-main">
        <h2 id={ctx?.titleId} className="modal-title">{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
      </div>
      {ctx && (
        <button type="button" className="btn btn-subtle btn-icon btn-sm modal-close" aria-label="Close" onClick={ctx.close}>
          <X />
        </button>
      )}
    </div>
  );
}

/** Scrollable middle region for a <Modal scrollableBody>. */
export function ModalScrollBody({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div className="modal-scroll-body" style={style}>{children}</div>;
}
