/** Display controls for the PNJ graph workspace. Keeps graph sizing decisions in the caller. */
export function createGraphDisplay({ documentRef = document, onResize = () => {}, onBeforeExit = () => {} } = {}) {
  const workspace = documentRef.getElementById('pnj-workspace');
  const toggle = documentRef.getElementById('pnj-fullscreen-toggle');
  const drawer = documentRef.getElementById('pnj-group-filter-drawer');
  const groupFilter = documentRef.getElementById('filter-groupe');
  const count = drawer?.querySelector('.pnj-group-filter-count');
  if (!workspace || !toggle) return { enter() {}, exit() {}, isFullscreen: () => false, updateGroups() {}, destroy() {} };

  let fallback = false;
  let nativeWasActive = false;
  let priorFocus = null;
  let destroyed = false;
  let entering = false;
  let requestGeneration = 0;
  let previousOverflow = null;
  const outsideElements = new Map();
  const isolate = (active) => {
    if (active && previousOverflow === null) {
      previousOverflow = documentRef.body?.style?.overflow ?? '';
      if (documentRef.body?.style) documentRef.body.style.overflow = 'hidden';
      let branch = workspace;
      while (branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling !== branch && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) {
            outsideElements.set(sibling, sibling.inert);
            sibling.inert = true;
          }
        }
        if (branch.parentElement === documentRef.body) break;
        branch = branch.parentElement;
      }
    } else if (!active && previousOverflow !== null) {
      if (documentRef.body?.style) documentRef.body.style.overflow = previousOverflow;
      previousOverflow = null;
      outsideElements.forEach((inert, element) => { element.inert = inert; });
      outsideElements.clear();
    }
  };
  const isFullscreen = () => documentRef.fullscreenElement === workspace || fallback;
  const sync = () => {
    const active = isFullscreen();
    workspace.classList.toggle('pnj-workspace-fullscreen', active);
    isolate(active);
    toggle.setAttribute('aria-pressed', String(active));
    toggle.setAttribute('aria-label', active ? 'Quitter le plein écran' : 'Afficher le graphe en plein écran');
    toggle.textContent = active ? '× Quitter le plein écran' : '⛶ Plein écran';
    if (active) onResize();
  };
  const onFullscreenChange = () => {
    const nowActive = documentRef.fullscreenElement === workspace;
    if (nowActive) fallback = false;
    else if (nativeWasActive && !fallback) {
      onBeforeExit();
      onResize();
      if (priorFocus?.isConnected) priorFocus.focus();
      priorFocus = null;
    }
    nativeWasActive = nowActive;
    sync();
  };
  const finishExit = () => {
    if (!isFullscreen()) return;
    onBeforeExit();
    fallback = false;
    workspace.classList.remove('pnj-workspace-fullscreen');
    sync();
    onResize();
    if (priorFocus?.isConnected) priorFocus.focus();
    priorFocus = null;
  };
  const onKeyDown = (event) => {
    const target = event.target;
    const editing = target?.matches?.('input, textarea, select, [contenteditable="true"]');
    const modalOpen = [...documentRef.querySelectorAll('dialog')].some((dialog) => dialog.open);
    if (event.key === 'Escape' && !event.defaultPrevented && fallback && !editing && !modalOpen) {
      event.preventDefault();
      finishExit();
    }
  };
  const enter = async () => {
    if (destroyed || entering || isFullscreen()) return;
    entering = true;
    const generation = ++requestGeneration;
    priorFocus = documentRef.activeElement;
    if (typeof workspace.requestFullscreen === 'function') {
      try {
        await workspace.requestFullscreen();
        if (destroyed || generation !== requestGeneration) {
          if (documentRef.fullscreenElement === workspace) await documentRef.exitFullscreen?.();
          return;
        }
        entering = false;
        sync();
        return;
      } catch { /* Fall back when the browser refuses native fullscreen. */ }
    }
    if (destroyed || generation !== requestGeneration) return;
    entering = false;
    fallback = true;
    sync();
    toggle.focus();
  };
  const exit = async () => {
    requestGeneration += 1;
    entering = false;
    if (!isFullscreen()) return;
    if (documentRef.fullscreenElement === workspace && typeof documentRef.exitFullscreen === 'function') {
      try { await documentRef.exitFullscreen(); return; } catch { /* Exit through the CSS overlay if native exit fails. */ }
    }
    finishExit();
  };
  const onToggle = () => { void (entering || isFullscreen() ? exit() : enter()); };
  toggle.addEventListener('click', onToggle);
  documentRef.addEventListener('fullscreenchange', onFullscreenChange);
  documentRef.addEventListener('keydown', onKeyDown);

  const updateGroups = ({ availableCount = 0, selectedCount = 0 } = {}) => {
    const available = Number(availableCount) > 0;
    if (drawer) drawer.hidden = !available;
    if (groupFilter) groupFilter.hidden = !available;
    if (count) {
      count.textContent = String(Math.max(0, Number(selectedCount) || 0));
      count.dataset.selectedCount = count.textContent;
      count.setAttribute('aria-label', `${count.textContent} groupe${count.textContent === '1' ? '' : 's'} sélectionné${count.textContent === '1' ? '' : 's'}`);
    }
  };
  return {
    enter, exit, isFullscreen, updateGroups,
    destroy() {
      destroyed = true;
      toggle.removeEventListener('click', onToggle);
      documentRef.removeEventListener('fullscreenchange', onFullscreenChange);
      documentRef.removeEventListener('keydown', onKeyDown);
      void exit();
      fallback = false;
      workspace.classList.remove('pnj-workspace-fullscreen');
      isolate(false);
    }
  };
}
