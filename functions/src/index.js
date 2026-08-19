import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { logger } from 'firebase-functions';
import { createUploadHandler } from './handler.mjs';

initializeApp();
setGlobalOptions({ region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB', maxInstances: 2 });

export const uploadProtectedImage = onCall(createUploadHandler(() => ({
    bucket: getStorage().bucket(),
    onCleanupFailure: ({ imagePath, error }) => logger.error('protected-image-cleanup-required', {
        imagePath,
        errorCode: error?.code ?? null,
    }),
})));
