export function hasUnsavedEdits() {
  return Boolean(document.querySelector('[data-dirty="true"]'));
}
export function canLeaveEditing() {
  return !hasUnsavedEdits() || window.confirm('Discard unsaved changes?');
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
    if (!canLeaveEditing()) {
      // Next must not apply the destination's router state before the original entry returns.
      event.stopImmediatePropagation();
      restoring = true;
      history.go(currentIndex - targetIndex);
      return;
    }
    currentIndex = targetIndex;
    currentState = event.state;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (hasUnsavedEdits()) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link) return;
    const url = new URL(link.getAttribute('href') || '', window.location.href);
    if (
      url.origin === window.location.origin &&
      url.pathname !== window.location.pathname &&
      !canLeaveEditing()
    ) {
      event.preventDefault();
      event.stopPropagation();
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
