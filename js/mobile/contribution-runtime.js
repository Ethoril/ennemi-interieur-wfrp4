// Keep the app shell independent from Firebase SDK modules. This adapter only
// loads the contribution client when a contribution-specific view needs it.
function loadRuntime() {
    return import('../contributions/firebase-client.js');
}

export function getContributionClient() {
    return loadRuntime().then(module => module.contributionClient);
}

export function logoutContributionAccount() {
    return loadRuntime().then(module => module.signOutContribution());
}

export function signInContribution() {
    return loadRuntime().then(module => module.signInContribution());
}
