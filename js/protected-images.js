import { ref, getBlob } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { createImageUrlScope } from './protected-image-scope.js';

// Chaque vue possède ses URL objet. Elles ne sont jamais persistées ni précachées.
export function createProtectedImageScope(storage) {
    return createImageUrlScope({
        fetchBlob: imagePath => getBlob(ref(storage, imagePath)),
        createObjectUrl: blob => URL.createObjectURL(blob),
        revokeObjectUrl: url => URL.revokeObjectURL(url),
    });
}
