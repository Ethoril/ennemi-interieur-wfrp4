import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { auth, functions } from '../firebase-init.js';
import { loginWithGoogle, logout } from '../auth.js';
import { createContributionClient } from './client-core.js';

export const contributionClient = createContributionClient({ auth, functions, sdk: { onAuthStateChanged, httpsCallable } });
export const signInContribution = loginWithGoogle;
export const signOutContribution = logout;
