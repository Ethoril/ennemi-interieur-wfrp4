/* Origine spatiale des modales : elles naissent du déclencheur et y retournent. */

export function originFromTrigger(triggerRect, contentRect) {
  if (!triggerRect || !contentRect) return { x: '50%', y: '50%' };
  const x = Math.round(triggerRect.left + triggerRect.width / 2 - contentRect.left);
  const y = Math.round(triggerRect.top + triggerRect.height / 2 - contentRect.top);
  return { x: `${x}px`, y: `${y}px` };
}

// À appeler une fois la modale affichée : les rectangles sont alors mesurables.
export function anchorToTrigger(contentEl, triggerEl) {
  if (!contentEl || !triggerEl) return;
  const origin = originFromTrigger(triggerEl.getBoundingClientRect(), contentEl.getBoundingClientRect());
  contentEl.style.setProperty('--modal-origin-x', origin.x);
  contentEl.style.setProperty('--modal-origin-y', origin.y);
}
