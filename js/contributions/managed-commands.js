export function newContributionOperationId() {
    const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128);
}

export async function uploadManagedImage(client, { kind, ownerId, file, operationId = newContributionOperationId() }) {
    if (!client || typeof client.uploadContributionImage !== 'function' || !file?.arrayBuffer) throw new TypeError('client et image requis');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const encoded = globalThis.btoa?.(binary);
    if (typeof encoded !== 'string') throw new Error('Encodage image indisponible');
    const result = await client.uploadContributionImage({ kind, ownerId, operationId, contentType: file.type, base64: encoded });
    if (typeof result?.imagePath !== 'string') throw new Error('Chemin image réservé absent');
    return result.imagePath;
}

export async function loadManagedEditContext(client, kind, id) {
    if (!client || typeof client.getContentEditContext !== 'function') return null;
    const context = await client.getContentEditContext({ kind, id });
    return context?.managed === true ? context : null;
}

export async function loadContentEditContext(client, kind, id) {
    if (!client || typeof client.getContentEditContext !== 'function') return null;
    const context = await client.getContentEditContext({ kind, id });
    return context?.canEdit === true && Number.isSafeInteger(context.revision) && context.data ? context : null;
}

export function managedBaseValues(data, changes) {
    return Object.fromEntries(Object.keys(changes).map(field => [field, Object.hasOwn(data || {}, field) ? data[field] : null]));
}

export async function mutateManagedContent(client, context, { kind, id, changes, baseValues = managedBaseValues(context?.data, changes),
    operationId = newContributionOperationId(), pair, reciprocalId, reciprocalBaseRevision }) {
    if (!context?.managed || !Number.isSafeInteger(context.revision)) throw new TypeError('contexte géré requis');
    return client.mutateMjContent({ kind, id, operationId, baseRevision: context.revision, baseValues, changes,
        ...(pair === true ? { pair } : {}), ...(reciprocalId ? { reciprocalId } : {}),
        ...(Number.isSafeInteger(reciprocalBaseRevision) ? { reciprocalBaseRevision } : {}) });
}

export async function mutateContentThroughGateway(client, context, options) {
    if (!context || !Number.isSafeInteger(context.revision)) throw new TypeError('contexte de contenu requis');
    return mutateManagedContent(client, { ...context, managed: true }, options);
}

export async function trashManagedContent(client, context, { kind, id, operationId = newContributionOperationId() }) {
    if (!context || !Number.isSafeInteger(context.revision)) throw new TypeError('contexte de contenu requis');
    return client.trashPublicContent({ kind, id, operationId, baseRevision: context.revision });
}
