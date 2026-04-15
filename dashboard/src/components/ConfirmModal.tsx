/**
 * ConfirmModal — a portal-based confirmation dialog for destructive actions.
 *
 * Usage:
 *   const [pending, setPending] = useState<string | null>(null);
 *
 *   {pending && (
 *     <ConfirmModal
 *       title="Delete endpoint?"
 *       body="This action cannot be undone."
 *       confirmLabel="Delete"
 *       onConfirm={() => void doDelete(pending)}
 *       onClose={() => setPending(null)}
 *     />
 *   )}
 */

import { Modal } from "@/components/Modal";
import { AlertTriangle } from "lucide-react";

interface ConfirmModalProps {
  /** Short heading shown at the top of the dialog */
  title: string;
  /** Descriptive body copy */
  body?: string;
  /** Label for the destructive primary button — defaults to "Confirm" */
  confirmLabel?: string;
  /** Called when user presses the confirm button */
  onConfirm: () => void;
  /** Called when user cancels or clicks the backdrop */
  onClose: () => void;
  /** Set true if you want the confirm button to show a loading spinner */
  loading?: boolean;
}

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  onConfirm,
  onClose,
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal onClose={onClose} maxWidth={400}>
      <div className="modal-body" style={{ gap: 16, padding: "24px 22px" }}>
        {/* Icon + title */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 6, flexShrink: 0,
            background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.22)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <AlertTriangle size={16} color="var(--color-red)" />
          </div>
          <div>
            <p style={{
              fontFamily: "var(--font-mono)", fontWeight: 700,
              fontSize: "0.9rem", color: "var(--color-text-primary)",
              letterSpacing: "-0.02em", marginBottom: body ? 5 : 0,
            }}>
              {title}
            </p>
            {body && (
              <p style={{
                fontFamily: "var(--font-mono)", fontSize: "0.75rem",
                color: "var(--color-text-secondary)", lineHeight: 1.5,
              }}>
                {body}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={loading}
            onClick={() => { onConfirm(); }}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
