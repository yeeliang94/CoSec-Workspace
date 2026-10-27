'use client';
import { useEffect, useRef } from 'react';
import { canLeaveEditing } from '@/components/edit-guard';

/** 650px side drawer on a native modal dialog: inert background, Escape closes, focus returns. */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, []);
  const close = async () => {
    const dirty = ref.current?.querySelector('[data-dirty="true"]');
    if (dirty && !(await canLeaveEditing())) return;
    onClose();
  };
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <div className="drawer-header">
        <h2 id="drawer-title">{title}</h2>
        <button type="button" className="quiet" onClick={close}>
          Close
        </button>
      </div>
      <div className="drawer-body">{children}</div>
    </dialog>
  );
}
