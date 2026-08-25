export const ERROR_KINDS = Object.freeze({
    PERMISSION: 'permission',
    OFFLINE: 'offline',
    NOT_FOUND: 'not-found',
    CONFLICT: 'conflict',
    VALIDATION: 'validation',
    UNKNOWN: 'unknown',
});

const USER_MESSAGES = Object.freeze({
    [ERROR_KINDS.PERMISSION]: 'Cette action n’est pas autorisée.',
    [ERROR_KINDS.OFFLINE]: 'Connexion indisponible. Réessayez lorsque le réseau sera revenu.',
    [ERROR_KINDS.NOT_FOUND]: 'Cette donnée n’est plus disponible.',
    [ERROR_KINDS.CONFLICT]: 'Cette donnée a changé ailleurs. Rechargez-la avant de réessayer.',
    [ERROR_KINDS.VALIDATION]: 'Les données saisies ne sont pas valides.',
    [ERROR_KINDS.UNKNOWN]: 'Une erreur inattendue est survenue. Réessayez.',
});

function normalizedCode(error) {
    return String(error?.code ?? '').toLowerCase().replace(/^(?:firebase|firestore|storage|functions|auth|appcheck)\//u, '');
}

export function classifyFirebaseError(error, { offline = false } = {}) {
    if (offline || ['unavailable', 'network-request-failed', 'fetch-network-error', 'deadline-exceeded'].includes(normalizedCode(error))) {
        return ERROR_KINDS.OFFLINE;
    }
    const code = normalizedCode(error);
    if (['permission-denied', 'unauthenticated', 'unauthorized'].includes(code)) return ERROR_KINDS.PERMISSION;
    if (['not-found', 'object-not-found'].includes(code)) return ERROR_KINDS.NOT_FOUND;
    if (['aborted', 'already-exists', 'conflict', 'failed-precondition'].includes(code)) return ERROR_KINDS.CONFLICT;
    if (['invalid-argument', 'invalid', 'validation', 'out-of-range'].includes(code)) return ERROR_KINDS.VALIDATION;
    return ERROR_KINDS.UNKNOWN;
}

export class FirebaseClientError extends Error {
    constructor(kind, { cause = null, code = null, operation = null } = {}) {
        super(USER_MESSAGES[kind] ?? USER_MESSAGES[ERROR_KINDS.UNKNOWN]);
        this.name = 'FirebaseClientError';
        this.kind = Object.hasOwn(USER_MESSAGES, kind) ? kind : ERROR_KINDS.UNKNOWN;
        this.code = code;
        this.operation = operation;
        this.cause = cause;
    }
}

export function normalizeFirebaseError(error, options = {}) {
    if (error instanceof FirebaseClientError) return error;
    const kind = classifyFirebaseError(error, options);
    return new FirebaseClientError(kind, {
        cause: error,
        code: error?.code ?? null,
        operation: options.operation ?? null,
    });
}

export function errorForUi(error, options = {}) {
    const normalized = normalizeFirebaseError(error, options);
    return { kind: normalized.kind, message: normalized.message };
}
