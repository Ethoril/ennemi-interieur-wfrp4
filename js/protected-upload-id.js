const HEX = byte => byte.toString(16).padStart(2, '0');

export async function protectedUploadOperationId(blob) {
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Image invalide pour le calcul de reprise.');
    if (!globalThis.crypto?.subtle) throw new Error('Navigateur incompatible avec l’upload protégé.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    // 128 bits suffisent pour identifier une tentative et gardent un chemin compact.
    return [...digest.subarray(0, 16)].map(HEX).join('');
}
