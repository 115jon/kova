/**
 * Modal.tsx — shared portal-based modal shell for ralph-auth dashboard.
 *
 * Renders children into document.body via React portal so the overlay is
 * never clipped by an ancestor's overflow:hidden or transform context.
 *
 * Usage:
 *   <Modal onClose={close} maxWidth={480}>
 *     <div className="modal-header">…</div>
 *     <div className="modal-body">…</div>
 *     <div className="modal-footer">…</div>
 *   </Modal>
 *
 * For tall modals with a scrollable body, add scrollableBody:
 *   <Modal onClose={close} scrollableBody>…</Modal>
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Max width of the modal box in px. Defaults to 480. */
  maxWidth?: number;
  /**
   * When true the modal-box becomes a flex column with an inner scrollable
   * region. Wrap the scrollable portion in a <div className="modal-scroll-body">.
   */
  scrollableBody?: boolean;
}

export function Modal({ onClose, children, maxWidth = 480, scrollableBody = false }: ModalProps) {
  // Lock body scroll while any modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        // Ensure we scroll rather than clip when the modal is very tall
        alignItems: "flex-start",
        overflowY: "auto",
        padding: "5vh 24px 5vh",
      }}
    >
      <div
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth,
          ...(scrollableBody ? {
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
          } : {}),
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Convenience wrapper for the scrollable inner area in a tall modal.
 * Place between the fixed header and fixed footer inside <Modal scrollableBody>.
 */
export function ModalScrollBody({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
