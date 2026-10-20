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

import { Modal, ModalHeader, useModalClose } from "@/components/Modal";
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
  /** Disables both buttons while the action runs */
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
    <Modal onClose={onClose} maxWidth={420}>
      <ModalHeader
        title={title}
        subtitle={body}
        icon={<span className="icon-tile tone-danger" aria-hidden="true"><AlertTriangle /></span>}
      />
      <ConfirmActions confirmLabel={confirmLabel} onConfirm={onConfirm} loading={loading} />
    </Modal>
  );
}

function ConfirmActions({ confirmLabel, onConfirm, loading }: { confirmLabel: string; onConfirm: () => void; loading: boolean }) {
  const close = useModalClose();
  return (
    <div className="modal-footer" style={{ paddingTop: 24 }}>
      <button type="button" className="btn btn-secondary" onClick={close} disabled={loading}>
        Cancel
      </button>
      <button type="button" className="btn btn-danger" disabled={loading} onClick={onConfirm}>
        {loading ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}
