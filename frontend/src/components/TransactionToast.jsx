import React from "react";

const TOAST_COPY = {
  info: { label: "Info", icon: "i" },
  pending: { label: "Pending", icon: "..." },
  success: { label: "Success", icon: "OK" },
  error: { label: "Failed", icon: "!" },
};

const getToastMeta = (type) => TOAST_COPY[type] || TOAST_COPY.info;

export default function TransactionToast({ toast, explorerBase, onClose }) {
  if (!toast) return null;

  const meta = getToastMeta(toast.type);
  const hasTxHash = typeof toast.txHash === "string" && toast.txHash.length > 0;

  return (
    <div className={`tx-toast tx-toast-${toast.type || "info"}`} role="status" aria-live="polite">
      <div className="tx-toast-top">
        <div className="tx-toast-chip" aria-hidden="true">{meta.icon}</div>
        <div className="tx-toast-headings">
          <strong>{toast.title || `Transaction ${meta.label}`}</strong>
          {toast.message ? <span>{toast.message}</span> : null}
        </div>
        <button className="tx-toast-close" type="button" onClick={onClose} aria-label="Dismiss notification">
          x
        </button>
      </div>

      {hasTxHash ? (
        <a
          className="tx-toast-link"
          href={`${explorerBase}/txn/${toast.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction
        </a>
      ) : null}
    </div>
  );
}
