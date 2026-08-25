const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40 * 1000 * 1000;
const MAX_DIMENSION = 800;
const ACCEPTED = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
});

function invalid(message, code = 'invalid-argument') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw invalid('Traitement du portrait annulé.', 'cancelled');
}

function asBytes(buffer) { return new Uint8Array(buffer); }

function starts(bytes, values, offset = 0) {
    return values.every((value, index) => bytes[offset + index] === value);
}

function realContentType(bytes) {
    if (bytes.length >= 3 && starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (bytes.length >= 8 && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (bytes.length >= 12 && starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (bytes.length >= 6 && (starts(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || starts(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return 'image/gif';
    if (bytes.length >= 12 && starts(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
        const brand = String.fromCharCode(...bytes.slice(8, 12));
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    const text = new globalThis.TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
    if (text.startsWith('<svg') || text.startsWith('<?xml') || text.includes('<svg')) return 'image/svg+xml';
    return null;
}

async function decodeImage(file, options = {}) {
    if (typeof options.decodeImage === 'function') return options.decodeImage(file);
    if (typeof globalThis.createImageBitmap === 'function') return globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
    if (typeof globalThis.Image !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
        throw invalid('Ce navigateur ne permet pas de vérifier ce portrait.');
    }
    const url = globalThis.URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const value = new globalThis.Image();
            value.onload = () => resolve(value);
            value.onerror = () => reject(invalid('Le fichier image est illisible.'));
            value.src = url;
        });
        return image;
    } finally { globalThis.URL.revokeObjectURL?.(url); }
}

export async function validatePortraitFile(file, { maxBytes = MAX_SOURCE_BYTES, decode = true, decodeImage: decoder, signal } = {}) {
    throwIfAborted(signal);
    if (!(file instanceof Blob) || !Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
        throw invalid(`Le portrait doit être une image de ${Math.floor(maxBytes / 1024 / 1024)} Mo maximum.`);
    }
    const bytes = asBytes(await file.arrayBuffer());
    throwIfAborted(signal);
    const contentType = realContentType(bytes);
    if (!contentType || contentType === 'image/svg+xml' || !Object.hasOwn(ACCEPTED, contentType)) {
        throw invalid('Ce fichier n’est pas une image prise en charge.');
    }
    if (file.type && file.type !== contentType) throw invalid('Le type réel du fichier ne correspond pas à son contenu.');
    let dimensions = null;
    if (decode) {
        let decoded;
        try {
            decoded = await decodeImage(file, { decodeImage: decoder });
            dimensions = { width: Number(decoded?.width), height: Number(decoded?.height) };
            if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)
                || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > MAX_PIXELS) throw invalid('Les dimensions de cette image sont excessives.');
            throwIfAborted(signal);
        } catch (error) {
            if (error?.code === 'cancelled' || error?.message === 'Les dimensions de cette image sont excessives.') throw error;
            throw invalid('Le fichier image est illisible.');
        } finally { decoded?.close?.(); }
    }
    return Object.freeze({ contentType, extension: ACCEPTED[contentType], originalBytes: file.size, dimensions });
}

function canvasFor(options = {}) {
    if (typeof options.createCanvas === 'function') return options.createCanvas();
    const documentRef = options.document ?? globalThis.document;
    if (!documentRef?.createElement) throw invalid('Le traitement du portrait est indisponible.');
    return documentRef.createElement('canvas');
}

function blobFromCanvas(canvas, type, quality) {
    if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function processPortraitFile(file, options = {}) {
    const validated = await validatePortraitFile(file, { ...options, maxBytes: options.maxSourceBytes ?? MAX_SOURCE_BYTES });
    throwIfAborted(options.signal);
    let bitmap = null;
    let canvas = null;
    try {
        bitmap = await decodeImage(file, options);
        throwIfAborted(options.signal);
        const width = Number(bitmap.width); const height = Number(bitmap.height);
        const requestedRatio = Number(options.aspectRatio);
        const ratio = Number.isFinite(requestedRatio) && requestedRatio > 0 && requestedRatio < 10
            ? requestedRatio : 1;
        let cropWidth = width;
        let cropHeight = height;
        if (width / height > ratio) cropWidth = height * ratio;
        else cropHeight = width / ratio;
        const requestedWidth = Number(options.targetWidth);
        const requestedHeight = Number(options.targetHeight);
        let targetWidth;
        let targetHeight;
        if (Number.isFinite(requestedWidth) && requestedWidth > 0
            && Number.isFinite(requestedHeight) && requestedHeight > 0) {
            targetWidth = Math.min(MAX_DIMENSION, Math.round(requestedWidth));
            targetHeight = Math.min(MAX_DIMENSION, Math.round(requestedHeight));
        } else {
            const scale = Math.min(1, MAX_DIMENSION / Math.max(cropWidth, cropHeight));
            targetWidth = Math.max(1, Math.round(cropWidth * scale));
            targetHeight = Math.max(1, Math.round(cropHeight * scale));
        }
        canvas = canvasFor(options);
        canvas.width = targetWidth; canvas.height = targetHeight;
        const context = canvas.getContext?.('2d', { alpha: false });
        if (!context?.drawImage) throw invalid('Le traitement du portrait est indisponible.');
        const sx = Math.max(0, (width - cropWidth) / 2);
        const sy = Math.max(0, (height - cropHeight) / 2);
        context.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
        let outputType = 'image/webp'; let output = null;
        for (const quality of [0.84, 0.7, 0.56, 0.42]) {
            output = await blobFromCanvas(canvas, outputType, quality);
            throwIfAborted(options.signal);
            if (output && output.size <= MAX_BYTES) break;
        }
        if (!output || output.size > MAX_BYTES) {
            outputType = 'image/jpeg';
            for (const quality of [0.82, 0.68, 0.52, 0.38]) {
                output = await blobFromCanvas(canvas, outputType, quality);
                throwIfAborted(options.signal);
                if (output && output.size <= MAX_BYTES) break;
            }
        }
        if (!(output instanceof Blob) || output.size <= 0 || output.size > MAX_BYTES) throw invalid('Le portrait final doit rester sous 2 Mo.');
        return Object.freeze({ blob: output, contentType: output.type || outputType, width: targetWidth, height: targetHeight,
            originalBytes: validated.originalBytes, finalBytes: output.size });
    } finally {
        bitmap?.close?.();
        if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove?.(); }
    }
}

export function createPortraitEditor({ container, document: documentRef = container?.ownerDocument ?? globalThis.document,
    currentPath = null, onChange = () => {}, announce = () => {}, processFile = processPortraitFile,
    label = 'Portrait', helpText = 'Photo ou photothèque, source 20 Mo maximum, portrait final 2 Mo.',
    previewClass = 'm-portrait-preview', previewAlt = 'Aperçu du portrait',
    removeLabel = 'Retirer le portrait', removeConfirm = 'Retirer le portrait lors de l’enregistrement ?',
    readyText = 'Portrait prêt à être enregistré.', invalidText = 'Portrait invalide.',
    currentText = 'Portrait actuel. Cadrage carré centré ; choisissez un fichier pour le remplacer.',
    removalText = 'Le portrait sera retiré à l’enregistrement.', previewUnavailableText = 'Aperçu du portrait indisponible.' } = {}) {
    if (!container || !documentRef?.createElement) throw new TypeError('Conteneur portrait requis');
    let generation = 0;
    let controller = null;
    let selected = null;
    let removalRequested = false;
    let processing = false;
    let disabled = false;
    let objectUrl = null;
    let currentHandle = null;
    const root = documentRef.createElement('section'); root.className = 'm-portrait-editor';
    const portraitFieldset = documentRef.createElement('fieldset');
    const legend = documentRef.createElement('legend'); legend.textContent = label; portraitFieldset.append(legend);
    const cameraLabel = documentRef.createElement('label'); const cameraText = documentRef.createElement('span'); cameraText.textContent = 'Prendre une photo';
    const cameraInput = documentRef.createElement('input'); cameraInput.type = 'file'; cameraInput.accept = `image/*,${Object.keys(ACCEPTED).join(',')}`; cameraInput.capture = 'environment'; cameraInput.setAttribute('accept', cameraInput.accept); cameraInput.setAttribute('capture', 'environment'); cameraInput.setAttribute('aria-describedby', 'm-portrait-help'); cameraLabel.append(cameraText, cameraInput);
    const libraryLabel = documentRef.createElement('label'); const libraryText = documentRef.createElement('span'); libraryText.textContent = 'Choisir dans la photothèque';
    const libraryInput = documentRef.createElement('input'); libraryInput.type = 'file'; libraryInput.accept = cameraInput.accept; libraryInput.setAttribute('accept', libraryInput.accept); libraryInput.setAttribute('aria-describedby', 'm-portrait-help'); libraryLabel.append(libraryText, libraryInput);
    const help = documentRef.createElement('span'); help.id = 'm-portrait-help'; help.className = 'm-form-help'; help.textContent = `${helpText} La caméra nécessite HTTPS et une autorisation.`;
    const status = documentRef.createElement('p'); status.className = 'm-portrait-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const preview = documentRef.createElement('img'); preview.alt = previewAlt; preview.hidden = true; preview.className = previewClass;
    const weight = documentRef.createElement('span'); weight.className = 'm-portrait-weight';
    const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'm-button'; remove.textContent = removeLabel;
    portraitFieldset.append(cameraLabel, libraryLabel); root.append(portraitFieldset, help, status, preview, weight, remove); container.append(root);
    const revoke = () => { if (objectUrl) { globalThis.URL.revokeObjectURL(objectUrl); objectUrl = null; } currentHandle?.release?.(); currentHandle = null; preview.removeAttribute('src'); preview.hidden = true; };
    const update = () => onChange({ file: selected?.blob ?? null, removalRequested, currentPath });
    const select = async sourceInput => {
        const file = sourceInput.files?.[0]; generation += 1; const local = generation;
        controller?.abort(); processing = false; const localController = new globalThis.AbortController(); controller = localController;
        if (!file) { status.textContent = 'Sélection annulée.'; sourceInput.value = ''; return; }
        processing = true;
        status.textContent = 'Vérification et compression…';
        try {
            const result = await processFile(file, { signal: localController.signal });
            if (local !== generation || localController.signal.aborted) return;
            let nextUrl;
            try { nextUrl = globalThis.URL.createObjectURL(result.blob); }
            catch { throw invalid(previewUnavailableText, 'unknown'); }
            revoke(); selected = result; removalRequested = false; objectUrl = nextUrl; preview.src = objectUrl; preview.hidden = false;
            weight.textContent = `Original : ${file.size} octets · final : ${result.finalBytes} octets`;
            status.textContent = readyText; update();
        } catch (error) {
            if (local !== generation || localController.signal.aborted) return;
            status.textContent = error?.message || invalidText; announce(status.textContent); sourceInput.value = '';
        } finally {
            if (local === generation) processing = false;
        }
    };
    cameraInput.addEventListener('change', () => select(cameraInput)); libraryInput.addEventListener('change', () => select(libraryInput));
    remove.addEventListener('click', () => {
        if (!currentPath && !selected) return;
        if (typeof documentRef.defaultView?.confirm === 'function' && !documentRef.defaultView.confirm(removeConfirm)) return;
        generation += 1; controller?.abort(); processing = false; selected = null; removalRequested = true; revoke(); cameraInput.value = ''; libraryInput.value = ''; weight.textContent = ''; status.textContent = removalText; update();
    });
    return Object.freeze({
        element: root,
        getState: () => Object.freeze({ file: selected?.blob ?? null, removalRequested, currentPath, processing }),
        setCurrentPath: async (path, imageService) => {
            generation += 1; const local = generation; controller?.abort(); processing = false; currentPath = path || null;
            if (selected) return;
            revoke();
            if (!currentPath || typeof imageService?.loadObjectUrl !== 'function') return;
            try {
                const handle = imageService.loadObjectUrl(currentPath); const loadedHandle = await handle;
                if (local !== generation || selected) { loadedHandle?.release?.(); return; }
                currentHandle = loadedHandle; preview.src = currentHandle.url; preview.hidden = false; status.textContent = currentText;
            } catch { /* Un ancien portrait indisponible ne bloque pas l’édition. */ }
        },
        setDisabled: value => { disabled = value === true; cameraInput.disabled = disabled; libraryInput.disabled = disabled; remove.disabled = disabled; },
        reset: () => { generation += 1; controller?.abort(); processing = false; selected = null; removalRequested = false; revoke(); cameraInput.value = ''; libraryInput.value = ''; weight.textContent = ''; status.textContent = ''; update(); },
        destroy: () => { generation += 1; controller?.abort(); revoke(); root.remove?.(); },
    });
}

export const PORTRAIT_MAX_BYTES = MAX_BYTES;
export const PORTRAIT_MAX_SOURCE_BYTES = MAX_SOURCE_BYTES;
export const PORTRAIT_MAX_DIMENSION = MAX_DIMENSION;
