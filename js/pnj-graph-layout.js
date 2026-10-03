const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6;

export function rememberGraphNodes(nodes, memory) {
    for (const node of nodes) {
        if (validPoint(node)) memory.set(node.id, { x: node.x, y: node.y, pinned: Number.isFinite(node.fx) && Number.isFinite(node.fy) });
    }
}

export function restoreGraphNodes(nodes, shared, memory) {
    for (const node of nodes) {
        const saved = shared.get(node.id);
        const point = validPoint(saved) ? { ...saved, pinned: true } : memory.get(node.id);
        if (!validPoint(point)) continue;
        node.x = point.x; node.y = point.y;
        if (point.pinned) { node.fx = point.x; node.fy = point.y; }
    }
}

export function applySharedGraphPositions(nodes, shared, dragging = new Set()) {
    let changed = false;
    for (const node of nodes) {
        const point = shared.get(node.id);
        if (dragging.has(node.id) || !validPoint(point)) continue;
        if (node.fx !== point.x || node.fy !== point.y) changed = true;
        node.x = node.fx = point.x;
        node.y = node.fy = point.y;
    }
    return changed;
}
