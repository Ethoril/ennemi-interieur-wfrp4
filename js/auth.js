import { auth, ADMIN_EMAIL } from './firebase-init.js';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export { auth, ADMIN_EMAIL };

/**
 * Checks if the given user has administrator / Game Master access.
 * @param {Object} user - The Firebase User object.
 * @returns {boolean} True if the user is the admin/GM.
 */
export function isUserAdmin(user) {
    return !!(user && user.email === ADMIN_EMAIL);
}

/**
 * Monitors the authentication state and triggers the callback with updated admin status.
 * @param {Function} callback - Function called with (user, isAdmin).
 * @returns {Function} Unsubscribe function returned by onAuthStateChanged.
 */
export function watchAuth(callback) {
    return onAuthStateChanged(auth, (user) => {
        const isAdmin = isUserAdmin(user);
        callback(user, isAdmin);
    });
}

/**
 * Initiates the Google Sign-in flow.
 * @returns {Promise} Resolves with the Sign-in result.
 */
export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
}

/**
 * Initiates Google Sign-out.
 * @returns {Promise} Resolves when signed out.
 */
export async function logout() {
    return signOut(auth);
}
