import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createEnqueteHandlers } from './enquetes/handler.mjs';
import { maintainEnquetes } from './enquetes/service.mjs';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { logger } from 'firebase-functions';
import { createUploadHandler } from './handler.mjs';
import { createFicheCommandHandler } from './fiche/handler.mjs';
import { createFicheMigrationHandler } from './fiche/migration-handler.mjs';
import careers from './data/careers.json' with { type: 'json' };
import skills from './data/skills.json' with { type: 'json' };
import spells from './data/fiche-catalog.json' with { type: 'json' };
import initialCatalogue from './catalogue/referentiel-public.json' with { type: 'json' };
import sheetSnapshot from './catalogue/talents-sheet-snapshot.json' with { type: 'json' };
import { createPublishedCatalogueEngine } from './domain/fiche/published-catalogue-engine.mjs';
import { createContributionHandlers } from './contributions/handler.mjs';
import { createCatalogueCommandHandler } from './catalogue/handler.mjs';
import { createCatalogueService } from './catalogue/service.mjs';

const createCurrentFicheEngine = catalogue => createPublishedCatalogueEngine({
  catalogue: catalogue || initialCatalogue,
  careers,
  skills,
  spells,
  talentSheetSnapshot: sheetSnapshot,
});

initializeApp();
setGlobalOptions({ region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB', maxInstances: 2 });

export const uploadProtectedImage = onCall({ enforceAppCheck: true }, createUploadHandler(() => ({
    bucket: getStorage().bucket(),
    onCleanupFailure: ({ imagePath, error }) => logger.error('protected-image-cleanup-required', {
        imagePath,
        errorCode: error?.code ?? null,
    }),
})));

export const executeFicheCommand = onCall({ enforceAppCheck: true }, createFicheCommandHandler(() => ({
  db: getFirestore(),
  createEngine: createCurrentFicheEngine,
  initialCatalogue,
  timestamp: () => FieldValue.serverTimestamp(),
})));

export const migrateFiche = onCall({ enforceAppCheck: true }, createFicheMigrationHandler(() => ({
  db: getFirestore(),
  timestamp: () => FieldValue.serverTimestamp(),
})));

const contributionHandlers = createContributionHandlers(() => ({
  db: getFirestore(),
  bucket: getStorage().bucket(),
  timestamp: () => FieldValue.serverTimestamp(),
  deleteField: () => FieldValue.delete(),
}));

export const getCampaignCapabilities = onCall({ enforceAppCheck: true }, contributionHandlers.getCampaignCapabilities);
export const getContentEditContext = onCall({ enforceAppCheck: true }, contributionHandlers.getContentEditContext);
export const getContentPnjChoices = onCall({ enforceAppCheck: true }, contributionHandlers.getContentPnjChoices);
export const getContentHistory = onCall({ enforceAppCheck: true }, contributionHandlers.getContentHistory);
export const mutatePublicContent = onCall({ enforceAppCheck: true }, contributionHandlers.mutatePublicContent);
export const mutateMjContent = onCall({ enforceAppCheck: true }, contributionHandlers.mutateMjContent);
export const listContentTrash = onCall({ enforceAppCheck: true }, contributionHandlers.listContentTrash);
export const listPendingPurgeCleanups = onCall({ enforceAppCheck: true }, contributionHandlers.listPendingPurgeCleanups);
export const trashPublicContent = onCall({ enforceAppCheck: true }, contributionHandlers.trashPublicContent);
export const restorePublicContent = onCall({ enforceAppCheck: true }, contributionHandlers.restorePublicContent);
export const purgePublicContent = onCall({ enforceAppCheck: true }, contributionHandlers.purgePublicContent);
export const setTrashVisibility = onCall({ enforceAppCheck: true }, contributionHandlers.setTrashVisibility);
export const uploadContributionImage = onCall({ enforceAppCheck: true }, contributionHandlers.uploadContributionImage);

const catalogueService = createCatalogueService({
  db: getFirestore(),
  timestamp: () => FieldValue.serverTimestamp(),
  initialCatalogue,
  sheetSnapshot,
  careers,
});
export const manageFicheCatalogue = onCall({ enforceAppCheck: true }, createCatalogueCommandHandler(catalogueService));
const enquetesDependencies = () => ({ db: getFirestore(), bucket: getStorage().bucket(), timestamp: () => FieldValue.serverTimestamp(), arrayUnion: (...items) => FieldValue.arrayUnion(...items), deleteField: () => FieldValue.delete() });
const enquetesHandlers = createEnqueteHandlers(enquetesDependencies);
export const getEnqueteSession = onCall({ enforceAppCheck: true }, enquetesHandlers.session);
export const executeEnqueteCommand = onCall({ enforceAppCheck: true }, enquetesHandlers.command);
export const readEnqueteContent = onCall({ enforceAppCheck: true }, enquetesHandlers.read);
export const finalizeEnqueteFile = onCall({ enforceAppCheck: true }, enquetesHandlers.file);
export const maintainEnqueteContent = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Europe/Paris' }, () => maintainEnquetes(enquetesDependencies()));
