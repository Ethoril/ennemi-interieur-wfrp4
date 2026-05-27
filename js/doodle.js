import { auth, db, ADMIN_EMAIL } from './firebase-init.js';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Elements du DOM
const adminPanel = document.getElementById('admin-panel');
const inputNewDates = document.getElementById('new-dates-input');
const btnCreatePoll = document.getElementById('btn-create-poll');
const doodleLoader = document.getElementById('doodle-loader');
const doodleEmpty = document.getElementById('doodle-empty');
const doodleTableContainer = document.getElementById('doodle-table-container');
const doodleTable = document.getElementById('doodle-table');
const doodleAuthBar = document.getElementById('doodle-auth-bar');

// Reference du document dans Firestore
const docRef = doc(db, 'doodle', 'current');

// Etat local
let currentPoll = null;

// Initialisation de la surveillance de l'état d'authentification
onAuthStateChanged(auth, (user) => {
    updateAuthBar(user);
    updateAdminPanel(user);
});

// Écoute en temps réel du sondage actif
onSnapshot(docRef, (docSnap) => {
    doodleLoader.style.display = 'none';
    if (docSnap.exists()) {
        currentPoll = docSnap.data();
        doodleEmpty.style.display = 'none';
        doodleTableContainer.style.display = 'block';
        renderPoll(currentPoll);
    } else {
        currentPoll = null;
        doodleEmpty.style.display = 'block';
        doodleTableContainer.style.display = 'none';
    }
}, (error) => {
    console.error("Erreur lors de l'écoute du sondage : ", error);
    doodleLoader.innerHTML = `<span style="color: #c94c4c;">Erreur de chargement du sondage.</span>`;
});

// Affichage/Masquage du panneau d'administration
function updateAdminPanel(user) {
    if (user && user.email === ADMIN_EMAIL) {
        adminPanel.style.display = 'block';
        // Ajout du bouton de suppression si non présent
        if (!document.getElementById('btn-delete-poll')) {
            const btnDelete = document.createElement('button');
            btnDelete.id = 'btn-delete-poll';
            btnDelete.className = 'btn-danger';
            btnDelete.textContent = '🗑️ Supprimer';
            btnDelete.style.marginLeft = '10px';
            btnDelete.addEventListener('click', deletePoll);
            btnCreatePoll.parentNode.appendChild(btnDelete);
        }
    } else {
        adminPanel.style.display = 'none';
    }
}

// Barre de connexion / déconnexion
function updateAuthBar(user) {
    if (user) {
        doodleAuthBar.innerHTML = `
            <span style="color: var(--text-muted);">Connecté en tant que <strong style="color: var(--gold);">${user.displayName || user.email}</strong></span>
            <button id="btn-signout" class="btn-ghost" style="padding: 6px 12px; font-size: 0.8rem;">Déconnexion</button>
        `;
        document.getElementById('btn-signout').addEventListener('click', () => signOut(auth));
    } else {
        doodleAuthBar.innerHTML = `
            <span style="color: var(--text-muted);">Tu es Maître de Jeu ?</span>
            <button id="btn-signin" class="btn-primary" style="margin: 0; padding: 6px 12px; font-size: 0.8rem;">🔑 Connexion Admin</button>
        `;
        document.getElementById('btn-signin').addEventListener('click', () => {
            signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
                if (err.code !== 'auth/popup-closed-by-user') {
                    alert("Erreur de connexion : " + err.message);
                }
            });
        });
    }
}

// Créer un nouveau sondage
btnCreatePoll.addEventListener('click', async () => {
    const rawInput = inputNewDates.value.trim();
    if (!rawInput) {
        alert("Saisis au moins une date.");
        return;
    }

    const dates = rawInput.split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

    if (dates.length === 0) {
        alert("Saisis des dates valides.");
        return;
    }

    btnCreatePoll.disabled = true;
    btnCreatePoll.textContent = "Création...";

    try {
        const initialResponses = {
            "David": Array(dates.length).fill(true)
        };

        await setDoc(docRef, {
            dates: dates,
            responses: initialResponses
        });

        inputNewDates.value = "";
    } catch (err) {
        console.error("Erreur lors de la création du sondage :", err);
        alert("Erreur lors de la création : " + err.message);
    } finally {
        btnCreatePoll.disabled = false;
        btnCreatePoll.textContent = "Lancer le sondage";
    }
});

// Supprimer le sondage
async function deletePoll() {
    if (!confirm("Es-tu sûr de vouloir supprimer le sondage actif ? Toutes les réponses seront perdues.")) return;
    
    const btnDelete = document.getElementById('btn-delete-poll');
    if (btnDelete) {
        btnDelete.disabled = true;
        btnDelete.textContent = "Suppression...";
    }
    
    try {
        await deleteDoc(docRef);
    } catch (err) {
        console.error("Erreur lors de la suppression du sondage :", err);
        alert("Erreur lors de la suppression : " + err.message);
    } finally {
        const btnDeleteAfter = document.getElementById('btn-delete-poll');
        if (btnDeleteAfter) {
            btnDeleteAfter.disabled = false;
            btnDeleteAfter.textContent = "🗑️ Supprimer";
        }
    }
}

// Rendu du tableau
function renderPoll(pollData) {
    const dates = pollData.dates || [];
    const responses = pollData.responses || {};

    // Trier les joueurs par ordre alphabétique, mais David en premier
    const playerNames = Object.keys(responses).sort((a, b) => {
        if (a.toLowerCase() === 'david') return -1;
        if (b.toLowerCase() === 'david') return 1;
        return a.localeCompare(b);
    });

    // Calculer les totaux de votes par date
    const totals = Array(dates.length).fill(0);
    playerNames.forEach(name => {
        const votes = responses[name] || [];
        votes.forEach((v, index) => {
            if (v && index < totals.length) totals[index]++;
        });
    });

    // En-têtes du tableau
    let html = `
        <thead>
            <tr>
                <th style="text-align: left; padding: 12px; border-bottom: 2px solid var(--border-strong);">Joueurs</th>
                ${dates.map(date => `<th style="padding: 12px; border-bottom: 2px solid var(--border-strong);">${date}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;

    // Lignes des réponses des joueurs
    playerNames.forEach(name => {
        const votes = responses[name] || [];
        html += `
            <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="text-align: left; padding: 12px; font-weight: bold;">${name}</td>
                ${dates.map((_, index) => {
                    const available = votes[index] === true;
                    return `
                        <td style="padding: 12px; text-align: center;">
                            ${available 
                                ? `<span style="color: #2ecc71; font-weight: bold; font-size: 1.2rem;" title="Disponible">✔</span>` 
                                : `<span style="color: #e74c3c; font-weight: bold; font-size: 1.2rem;" title="Indisponible">✘</span>`
                            }
                        </td>
                    `;
                }).join('')}
            </tr>
        `;
    });

    // Ligne des totaux
    html += `
        <tr style="border-bottom: 2px solid var(--border-strong); background: rgba(201, 168, 76, 0.05); font-weight: bold;">
            <td style="text-align: left; padding: 12px; color: var(--gold);">Total dispos</td>
            ${totals.map(t => `<td style="padding: 12px; text-align: center; color: var(--gold);">${t}</td>`).join('')}
        </tr>
    `;

    // Ligne de formulaire de vote
    html += `
        <tr class="voter-row" style="background: rgba(0, 0, 0, 0.15);">
            <td style="text-align: left; padding: 12px; vertical-align: middle;">
                <input type="text" id="voter-name" placeholder="Ton pseudo..." style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-subtle); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: var(--radius-sm);">
            </td>
            ${dates.map((_, index) => `
                <td style="padding: 12px; text-align: center; vertical-align: middle;">
                    <label class="custom-checkbox-container" style="display: inline-block; position: relative; cursor: pointer; user-select: none; width: 22px; height: 22px;">
                        <input type="checkbox" class="voter-checkbox" data-index="${index}" style="width: 22px; height: 22px; cursor: pointer; margin: 0;">
                    </label>
                </td>
            `).join('')}
        </tr>
        <tr>
            <td colspan="${dates.length + 1}" style="text-align: right; padding: 12px;">
                <span id="vote-error" style="color: #e74c3c; font-size: 0.9rem; margin-right: 15px; display: none;"></span>
                <button id="btn-submit-vote" class="btn-primary" style="margin: 0; padding: 8px 24px;">Valider mon vote</button>
            </td>
        </tr>
    `;

    html += `</tbody>`;
    doodleTable.innerHTML = html;

    // Événement de soumission du vote
    document.getElementById('btn-submit-vote').addEventListener('click', submitVote);
}

// Soumission du vote joueur
async function submitVote() {
    const voterNameInput = document.getElementById('voter-name');
    const voterName = voterNameInput.value.trim();
    const voteError = document.getElementById('vote-error');
    const btnSubmit = document.getElementById('btn-submit-vote');

    voteError.style.display = 'none';

    if (!voterName) {
        voteError.textContent = "Saisis ton nom pour voter.";
        voteError.style.display = 'inline';
        voterNameInput.focus();
        return;
    }

    if (voterName.toLowerCase() === 'david' && (!auth.currentUser || auth.currentUser.email !== ADMIN_EMAIL)) {
        voteError.textContent = "Le nom 'David' est réservé au MDJ.";
        voteError.style.display = 'inline';
        voterNameInput.focus();
        return;
    }

    // Récupérer les cases à cocher et construire le tableau de réponses
    const checkboxes = Array.from(document.querySelectorAll('.voter-checkbox'))
        .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index));
    
    const votes = checkboxes.map(cb => cb.checked);

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Envoi...";

    try {
        await setDoc(docRef, {
            responses: {
                [voterName]: votes
            }
        }, { merge: true });

        // Vider le champ de texte
        voterNameInput.value = "";
    } catch (err) {
        console.error("Erreur lors de la soumission du vote :", err);
        voteError.textContent = "Erreur : " + err.message;
        voteError.style.display = 'inline';
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Valider mon vote";
    }
}
