export function hasUnsavedEdits() {
  return Boolean(document.querySelector('[data-dirty="true"]'));
}

let pending: Promise<boolean> | null = null;
/**
 * In-app replacement for window.confirm, which some browsers and embedded views suppress. A
 * native modal dialog keeps the background inert; focus starts on the safe choice, Escape
 * cancels, and focus returns to the invoking control. Overlapping requests share one prompt.
 */
export function confirmAction({
  message,
  confirmLabel,
  cancelLabel = 'Keep editing',
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
}): Promise<boolean> {
  if (pending) return pending;
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-labelledby', 'confirm-dialog-message');
  const text = document.createElement('p');
  text.id = 'confirm-dialog-message';
  text.textContent = message;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = cancelLabel;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'primary';
  confirm.textContent = confirmLabel;
  actions.append(cancel, confirm);
  dialog.append(text, actions);
  pending = new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      pending = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
      resolve(answer);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
  });
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
  return pending;
}

const discard = () =>
  confirmAction({ message: 'Discard unsaved changes?', confirmLabel: 'Discard changes' });
export async function canLeaveEditing() {
  return !hasUnsavedEdits() || discard();
}

/** Keep cancelled history traversals on the same entry without remounting the edited page. */
export function installEditGuards() {
  const indexKey = '__cosecHistoryIndex';
  const history = window.history;
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  let currentIndex: number = history.state?.[indexKey] ?? 0;
  let currentState = { ...history.state, [indexKey]: currentIndex };
  let restoring = false;
  let traversalAllowed = false;
  let clickAllowed = false;
  replaceState.call(history, currentState, '');

  const push: History['pushState'] = (state, unused, url) => {
    const nextIndex = currentIndex + 1;
    pushState.call(history, { ...state, [indexKey]: nextIndex }, unused, url);
    currentIndex = nextIndex;
    currentState = history.state;
  };
  const replace: History['replaceState'] = (state, unused, url) => {
    replaceState.call(history, { ...state, [indexKey]: currentIndex }, unused, url);
    currentState = history.state;
  };
  history.pushState = push;
  history.replaceState = replace;

  const pop = (event: PopStateEvent) => {
    if (restoring) {
      restoring = false;
      event.stopImmediatePropagation();
      return;
    }
    const targetIndex: number | undefined = event.state?.[indexKey];
    if (targetIndex === undefined) {
      // Native fragment links create an entry without calling pushState. Preserve the router
      // state as well as its index, so returning here restores the correct page.
      currentIndex++;
      currentState = { ...currentState, [indexKey]: currentIndex };
      replaceState.call(history, currentState, '');
      return;
    }
    if (targetIndex === currentIndex) return;
    if (!traversalAllowed && hasUnsavedEdits()) {
      // Return to the edited entry first, so Next never applies the destination's router state
      // while the prompt is open; repeat the traversal only once discarding is confirmed.
      event.stopImmediatePropagation();
      restoring = true;
      const delta = targetIndex - currentIndex;
      history.go(-delta);
      void discard().then((confirmed) => {
        if (!confirmed) return;
        traversalAllowed = true;
        history.go(delta);
      });
      return;
    }
    traversalAllowed = false;
    currentIndex = targetIndex;
    currentState = event.state;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (hasUnsavedEdits()) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    if (clickAllowed) {
      clickAllowed = false;
      return;
    }
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLElement)) return;
    const url = new URL(link.getAttribute('href') || '', window.location.href);
    if (
      url.origin === window.location.origin &&
      url.pathname !== window.location.pathname &&
      hasUnsavedEdits()
    ) {
      event.preventDefault();
      event.stopPropagation();
      // Replaying the click keeps the link's own behaviour (client routing or a plain load).
      void discard().then((confirmed) => {
        if (!confirmed || !link.isConnected) return;
        clickAllowed = true;
        link.click();
      });
    }
  };
  window.addEventListener('popstate', pop, true);
  window.addEventListener('beforeunload', unload);
  document.addEventListener('click', click, true);
  return () => {
    window.removeEventListener('popstate', pop, true);
    window.removeEventListener('beforeunload', unload);
    document.removeEventListener('click', click, true);
    if (history.pushState === push) history.pushState = pushState;
    if (history.replaceState === replace) history.replaceState = replaceState;
  };
}
