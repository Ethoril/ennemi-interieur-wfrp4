const MAX_CURVATURE = 6;
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function endpointId(endpoint) {
  if (endpoint && typeof endpoint === 'object') return endpoint.id == null ? '' : String(endpoint.id);
  return endpoint == null ? '' : String(endpoint);
}

const targetId = link => endpointId(link?.target ?? link?.cible);
const SEMANTIC_FIELDS = ['type', 'label', 'color', 'style', 'visibleJoueurs'];

function exactMirror(left, right) {
  return right && left.id !== right.id && left.reciprocalId === right.id && right.reciprocalId === left.id
    && endpointId(left.source) === targetId(right) && targetId(left) === endpointId(right.source)
    && SEMANTIC_FIELDS.every(field => left[field] === right[field]);
}

function curveVersion(link) {
  const time = link.updatedAt;
  if (isFiniteNumber(time)) return time;
  if (time instanceof Date) return time.getTime();
  return (time?.seconds ?? 0) * 1000 + (time?.nanoseconds ?? 0) / 1e6;
}

/** Keep directional documents for dossiers, but draw each proven reciprocal pair once. */
export function graphRelations(links) {
  if (!Array.isArray(links)) return [];
  const byId = new Map(links.map(link => [link.id, link]));
  const seen = new Set();
  const drawn = [];
  for (const link of [...links].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))) {
    if (seen.has(link.id)) continue;
    const mirror = byId.get(link.reciprocalId);
    const paired = Boolean(exactMirror(link, mirror));
    link._bidirectional = paired;
    link._curveMemberIds = paired ? [link.id, mirror.id] : [link.id];
    // Older releases could save different curvatures for the two directions.
    // Keep the latest explicit setting (including an automatic reset).
    const settings = (paired ? [link, mirror] : [link]).filter(item => Object.hasOwn(item, 'curvature'));
    settings.sort((a, b) => curveVersion(b) - curveVersion(a)
      || String(a.id).localeCompare(String(b.id), 'en'));
    link._curveCurvature = settings[0]?.curvature ?? null;
    for (const id of link._curveMemberIds) seen.add(id);
    drawn.push(link);
  }
  return drawn;
}

function endpointPoint(endpoint) {
  const x = Number(endpoint && typeof endpoint === 'object' ? endpoint.x : NaN);
  const y = Number(endpoint && typeof endpoint === 'object' ? endpoint.y : NaN);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

function linkGeometry(link, nodeRadius) {
  const source = endpointPoint(link?.source);
  const target = endpointPoint(link?.target);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const nx = length > 1e-9 ? -dy / length : 0;
  const ny = length > 1e-9 ? dx / length : 1;
  const bend = Math.min(length * 0.3, 80) * (isFiniteNumber(link?._curveScale) ? link._curveScale : 1);
  const control = { x: (source.x + target.x) / 2 + nx * bend, y: (source.y + target.y) / 2 + ny * bend };
  const edge = Math.max(0, (isFiniteNumber(nodeRadius) ? nodeRadius : 30) + 3);
  const trim = (from, toward) => {
    const vx = toward.x - from.x;
    const vy = toward.y - from.y;
    const magnitude = Math.hypot(vx, vy);
    if (magnitude <= 1e-9) return { ...from };
    return { x: from.x + vx / magnitude * edge, y: from.y + vy / magnitude * edge };
  };
  return { source, target, control, start: trim(source, control), end: trim(target, control), nx, ny, length };
}

/** Assign deterministic canonical lanes, then convert each lane to its source-relative sign. */
export function assignCurveLanes(links) {
  if (!Array.isArray(links)) return links;
  const groups = new Map();
  for (const [index, link] of graphRelations(links).entries()) {
    const sourceId = endpointId(link?.source);
    const endId = targetId(link);
    const [lowId, highId] = sourceId <= endId ? [sourceId, endId] : [endId, sourceId];
    const key = `${lowId.length}:${lowId}${highId}`;
    const group = groups.get(key) || { links: [], lowId, highId };
    group.links.push({ link, index, sourceId });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const ordered = group.links.sort((a, b) => {
      const aid = a.link?.id == null ? `~${a.index}` : String(a.link.id);
      const bid = b.link?.id == null ? `~${b.index}` : String(b.link.id);
      return aid.localeCompare(bid, 'en');
    });
    const manualLanes = new Set(ordered
      .filter(({ link }) => isFiniteNumber(link._curveCurvature) && Math.abs(link._curveCurvature) <= MAX_CURVATURE)
      .map(({ link }) => link._curveCurvature));
    const autoLanes = [];
    for (let lane = 1; lane <= MAX_CURVATURE; lane++) autoLanes.push(lane, -lane);
    let nextLane = 0;
    for (const item of ordered) {
      const { link, sourceId } = item;
      const manual = isFiniteNumber(link._curveCurvature) && Math.abs(link._curveCurvature) <= MAX_CURVATURE;
      if (!manual) {
        while (nextLane < autoLanes.length && manualLanes.has(autoLanes[nextLane])) nextLane++;
        const lane = autoLanes[Math.min(nextLane, autoLanes.length - 1)] ?? 0;
        link._canonicalCurveScale = lane;
        if (nextLane < autoLanes.length) nextLane++;
      } else {
        link._canonicalCurveScale = link._curveCurvature;
      }
      const orientation = sourceId === group.lowId ? 1 : -1;
      link._curveScale = link._canonicalCurveScale * orientation;
      link._showLabel = Boolean(String(link.label || link.type || '').trim());
    }
  }
  return links;
}

/** Return an SVG quadratic path trimmed to the node circles. `reversed` walks the same curve backwards. */
export function bezierPath(x1, y1, x2, y2, curveScale = 1, reversed = false, nodeRadius = 30) {
  const source = { x: Number.isFinite(x1) ? x1 : 0, y: Number.isFinite(y1) ? y1 : 0 };
  const target = { x: Number.isFinite(x2) ? x2 : 0, y: Number.isFinite(y2) ? y2 : 0 };
  const link = { source, target, _curveScale: isFiniteNumber(curveScale) ? curveScale : 1 };
  const { control, start, end } = linkGeometry(link, nodeRadius);
  const from = reversed ? end : start;
  const to = reversed ? start : end;
  return `M${from.x},${from.y} Q${control.x},${control.y} ${to.x},${to.y}`;
}

/** Point at t=.5 on the radius-trimmed quadratic used by bezierPath. */
export function curveHandlePoint(link, nodeRadius = 30) {
  const { start, control, end } = linkGeometry(link, nodeRadius);
  return {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };
}

/** Map a dragged handle point back to canonical min-ID-to-max-ID curvature. */
export function curveFromPoint(link, point, nodeRadius = 30) {
  const sourceId = endpointId(link?.source);
  const targetId = endpointId(link?.target);
  const reversed = sourceId > targetId;
  const canonicalLink = reversed
    ? { ...link, source: link?.target, target: link?.source }
    : link;
  const { source, target, nx, ny, length } = linkGeometry({ ...canonicalLink, _curveScale: 0 }, nodeRadius);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || length <= 1e-9) return 0;
  const midpointX = (source.x + target.x) / 2;
  const midpointY = (source.y + target.y) / 2;
  const desired = (x - midpointX) * nx + (y - midpointY) * ny;
  const valueAt = scale => {
    const handle = curveHandlePoint({ ...canonicalLink, _curveScale: scale }, nodeRadius);
    return (handle.x - midpointX) * nx + (handle.y - midpointY) * ny;
  };
  let low = -MAX_CURVATURE;
  let high = MAX_CURVATURE;
  const lowValue = valueAt(low);
  const highValue = valueAt(high);
  const increasing = highValue >= lowValue;
  if (desired <= Math.min(lowValue, highValue)) return increasing ? -MAX_CURVATURE : MAX_CURVATURE;
  if (desired >= Math.max(lowValue, highValue)) return increasing ? MAX_CURVATURE : -MAX_CURVATURE;
  for (let i = 0; i < 36; i++) {
    const middle = (low + high) / 2;
    const middleValue = valueAt(middle);
    if ((middleValue < desired) === increasing) low = middle;
    else high = middle;
  }
  return clamp(Math.round(((low + high) / 2) * 100) / 100, -MAX_CURVATURE, MAX_CURVATURE);
}
