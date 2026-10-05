import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { functions } from './firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { createReferentielsUi } from './catalogue/referentiels-ui.js';

const callable = httpsCallable(functions, 'manageFicheCatalogue');
createReferentielsUi({ callable, auth: { watchAuth, loginWithGoogle, logout } });
