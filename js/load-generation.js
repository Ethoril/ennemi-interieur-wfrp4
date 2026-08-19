export function isCurrentLoad(loadId, currentLoadId) {
    return loadId === currentLoadId;
}

export function isCurrentGeneration(generation, currentGeneration) {
    return generation === currentGeneration;
}

export function isCurrentPanel(panelGeneration, currentPanelGeneration, panelId, currentPanelId,
    capturedRole, currentRole, stillVisible) {
    return isCurrentGeneration(panelGeneration, currentPanelGeneration)
        && panelId === currentPanelId
        && capturedRole === currentRole
        && stillVisible === true;
}
