import { createPublicMobileClient } from '../data/firebase-clients.js';
import { createPublicIndicesRepository } from '../data/indices-repository.js';
import { createPublicPnjRepository } from '../data/pnjs-repository.js';
import { createPublicRelationsRepository } from '../data/relations-repository.js';
import { createPublicMobileSession } from './session.js';

const DEFAULT_BUILDERS = Object.freeze({
    client: createPublicMobileClient,
    pnjs: createPublicPnjRepository,
    relations: createPublicRelationsRepository,
    indices: createPublicIndicesRepository,
});

function cancelled(operation) {
    return Object.assign(new Error('public runtime cancelled'), { code: 'aborted', operation });
}

export function createPublicSessionComposition({
    sdk,
    config,
    options = {},
    builders = DEFAULT_BUILDERS,
} = {}) {
    if (!sdk || !config || !builders
        || !['client', 'pnjs', 'relations', 'indices'].every(name => typeof builders[name] === 'function')) {
        throw new TypeError('sdk, config et fabriques publiques requis');
    }
    const clientFactory = async ({ signal } = {}) => {
        if (signal?.aborted) throw cancelled('public-client');
        const client = await builders.client({ sdk, config });
        if (!signal?.aborted) return client;
        await client?.close?.();
        throw cancelled('public-client');
    };
    const repositoryFactories = ({ client, signal } = {}) => {
        if (signal?.aborted) throw cancelled('public-repositories');
        return {
            pnjs: builders.pnjs({ sdk, client }),
            relations: builders.relations({ sdk, client }),
            indices: builders.indices({ sdk, client }),
        };
    };
    return createPublicMobileSession({ ...options, clientFactory, repositoryFactories });
}
