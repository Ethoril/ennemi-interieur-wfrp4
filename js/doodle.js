import { auth, db, ADMIN_EMAIL } from './firebase-init.js';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, deleteDoc, onSnapshot, collection, addDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Elements du DOM
const adminPanel = document.getElementById('admin-panel');
const adminCreateContainer = document.getElementById('admin-create-container');
const adminManageContainer = document.getElementById('admin-manage-container');

const inputNewDates = document.getElementById('new-dates-input');
const btnCreatePoll = document.getElementById('btn-create-poll');

const btnAdminEdit = document.getElementById('btn-admin-edit');
const btnAdminClose = document.getElementById('btn-admin-close');
const btnAdminDelete = document.getElementById('btn-admin-delete');
const btnAdminForceNew = document.getElementById('btn-admin-force-new');

const adminEditDatesForm = document.getElementById('admin-edit-dates-form');
const editDatesInput = document.getElementById('edit-dates-input');
const btnSaveDates = document.getElementById('btn-save-dates');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

const doodleLoader = document.getElementById('doodle-loader');
const doodleEmpty = document.getElementById('doodle-empty');
const doodleTableContainer = document.getElementById('doodle-table-container');
const doodleTable = document.getElementById('doodle-table');
const doodleClosedBanner = document.getElementById('doodle-closed-banner');
const doodleAuthBar = document.getElementById('doodle-auth-bar');

// Reference du document dans Firestore
const docRef = doc(db, 'doodle', 'current');

// Etat local
let currentPoll = null;
let forceCreateMode = false;

// Initialisation de la surveillance de l'état d'authentification
onAuthStateChanged(auth, (user) => {
    updateAuthBar(user);
    updateAdminPanel();
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
    updateAdminPanel();
}, (error) => {
    console.error("Erreur lors de l'écoute du sondage : ", error);
    doodleLoader.innerHTML = `<span style="color: #c94c4c;">Erreur de chargement du sondage.</span>`;
});

// Affichage/Masquage et rendu du panneau d'administration
function updateAdminPanel() {
    const user = auth.currentUser;
    if (user && user.email === ADMIN_EMAIL) {
        adminPanel.style.display = 'block';
        
        if (currentPoll && !forceCreateMode) {
            // Un sondage est actif et on n'a pas forcé le mode création
            adminCreateContainer.style.display = 'none';
            adminManageContainer.style.display = 'block';
            
            const isClosed = currentPoll.closed === true;
            btnAdminClose.innerHTML = isClosed ? "🔓 Réouvrir les votes" : "🔒 Clôturer le sondage";
        } else {
            // Aucun sondage actif ou forcé en mode création
            adminCreateContainer.style.display = 'block';
            adminManageContainer.style.display = 'none';
        }
    } else {
        adminPanel.style.display = 'none';
    }
}

// Boutons de gestion admin
btnAdminForceNew.addEventListener('click', () => {
    if (confirm("Es-tu sûr de vouloir configurer un nouveau sondage ? Le sondage actif sera remplacé dès que tu cliqueras sur 'Lancer le sondage'.")) {
        forceCreateMode = true;
        updateAdminPanel();
    }
});

btnAdminEdit.addEventListener('click', () => {
    if (adminEditDatesForm.style.display === 'none') {
        adminEditDatesForm.style.display = 'block';
        editDatesInput.value = (currentPoll.dates || []).join(', ');
        editDatesInput.focus();
    } else {
        adminEditDatesForm.style.display = 'none';
    }
});

btnCancelEdit.addEventListener('click', () => {
    adminEditDatesForm.style.display = 'none';
});

btnSaveDates.addEventListener('click', async () => {
    const rawInput = editDatesInput.value.trim();
    if (!rawInput) {
        alert("Saisis au moins une date.");
        return;
    }

    const newDates = rawInput.split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

    if (newDates.length === 0) {
        alert("Saisis des dates valides.");
        return;
    }

    btnSaveDates.disabled = true;
    btnSaveDates.textContent = "Sauvegarde...";

    try {
        const updatedResponses = {};
        const oldResponses = currentPoll.responses || {};
        for (const [player, votes] of Object.entries(oldResponses)) {
            if (votes.length < newDates.length) {
                updatedResponses[player] = [...votes, ...Array(newDates.length - votes.length).fill(false)];
            } else {
                updatedResponses[player] = votes.slice(0, newDates.length);
            }
        }

        await setDoc(docRef, {
            dates: newDates,
            responses: updatedResponses
        }, { merge: true });

        adminEditDatesForm.style.display = 'none';
    } catch (err) {
        console.error("Erreur lors de la modification des dates :", err);
        alert("Erreur lors de la sauvegarde : " + err.message);
    } finally {
        btnSaveDates.disabled = false;
        btnSaveDates.textContent = "Enregistrer";
    }
});

btnAdminClose.addEventListener('click', async () => {
    const isClosed = currentPoll.closed === true;
    const actionStr = isClosed ? "réouvrir" : "clôturer";
    if (!confirm(`Es-tu sûr de vouloir ${actionStr} ce sondage ?`)) return;

    btnAdminClose.disabled = true;
    try {
        await setDoc(docRef, {
            closed: !isClosed
        }, { merge: true });
    } catch (err) {
        console.error("Erreur lors de la clôture/réouverture :", err);
        alert("Erreur : " + err.message);
    } finally {
        btnAdminClose.disabled = false;
    }
});

btnAdminDelete.addEventListener('click', async () => {
    if (!confirm("Es-tu sûr de vouloir supprimer le sondage actif ? Toutes les réponses seront perdues.")) return;
    
    btnAdminDelete.disabled = true;
    btnAdminDelete.textContent = "Suppression...";
    
    try {
        await deleteDoc(docRef);
        forceCreateMode = false;
    } catch (err) {
        console.error("Erreur lors de la suppression du sondage :", err);
        alert("Erreur lors de la suppression : " + err.message);
    } finally {
        btnAdminDelete.disabled = false;
        btnAdminDelete.textContent = "🗑️ Supprimer le sondage";
    }
});

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
            responses: initialResponses,
            closed: false
        });

        inputNewDates.value = "";
        forceCreateMode = false;
    } catch (err) {
        console.error("Erreur lors de la création du sondage :", err);
        alert("Erreur lors de la création : " + err.message);
    } finally {
        btnCreatePoll.disabled = false;
        btnCreatePoll.textContent = "Lancer le sondage";
    }
});

// Rendu du tableau
function renderPoll(pollData) {
    const dates = pollData.dates || [];
    const responses = pollData.responses || {};
    const isClosed = pollData.closed === true;

    if (doodleClosedBanner) {
        doodleClosedBanner.style.display = isClosed ? 'block' : 'none';
    }

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

    const user = auth.currentUser;
    const isAdmin = user && user.email === ADMIN_EMAIL;

    // En-têtes du tableau
    let html = `
        <thead>
            <tr>
                <th style="text-align: left; padding: 12px; border-bottom: 2px solid var(--border-strong); min-width: 180px; width: 180px;">Joueurs</th>
                ${dates.map(date => `<th style="padding: 12px; border-bottom: 2px solid var(--border-strong); min-width: 120px; font-size: 0.85rem; line-height: 1.2;">${date}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;

    // Lignes des réponses des joueurs
    playerNames.forEach(name => {
        const votes = responses[name] || [];
        
        let nameHtml = name;
        if (!isClosed) {
            if (isAdmin) {
                nameHtml = `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span>${name}</span>
                        <div style="display: flex; gap: 4px;">
                            <button class="btn-edit-player-response" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: var(--gold); cursor: pointer; padding: 2px 4px; font-size: 0.95rem;" title="Modifier la réponse de ${name}">✏️</button>
                            <button class="btn-delete-player-response" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: #c94c4c; cursor: pointer; padding: 2px 4px; font-size: 0.95rem;" title="Supprimer la réponse de ${name}">🗑️</button>
                        </div>
                    </div>
                `;
            } else {
                nameHtml = `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span>${name}</span>
                        <button class="btn-edit-player-response" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: var(--gold); cursor: pointer; padding: 2px 6px; font-size: 0.95rem;" title="Modifier ma réponse">✏️</button>
                    </div>
                `;
            }
        } else if (isAdmin) {
            nameHtml = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span>${name}</span>
                    <button class="btn-delete-player-response" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: #c94c4c; cursor: pointer; padding: 2px 6px; font-size: 0.95rem;" title="Supprimer la réponse de ${name}">🗑️</button>
                </div>
            `;
        }

        html += `
            <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="text-align: left; padding: 12px; font-weight: bold; min-width: 180px; width: 180px;">${nameHtml}</td>
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
            <td style="text-align: left; padding: 12px; color: var(--gold); min-width: 180px; width: 180px;">Total dispos</td>
            ${totals.map(t => `<td style="padding: 12px; text-align: center; color: var(--gold);">${t}</td>`).join('')}
        </tr>
    `;

    // Ligne de formulaire de vote
    if (!isClosed) {
        html += `
            <tr class="voter-row" style="background: rgba(0, 0, 0, 0.15);">
                <td style="text-align: left; padding: 12px; vertical-align: middle; min-width: 180px; width: 180px;">
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
    }

    html += `</tbody>`;
    doodleTable.innerHTML = html;

    // Événement de soumission du vote
    if (!isClosed) {
        document.getElementById('btn-submit-vote').addEventListener('click', submitVote);
    }

    // Événements de modification de réponse joueur par clic (remplit le formulaire)
    if (!isClosed) {
        document.querySelectorAll('.btn-edit-player-response').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerName = e.currentTarget.dataset.player;
                const voterNameInput = document.getElementById('voter-name');
                if (voterNameInput) {
                    voterNameInput.value = playerName;
                    
                    const playerVotes = responses[playerName] || [];
                    const checkboxes = document.querySelectorAll('.voter-checkbox');
                    checkboxes.forEach((cb, idx) => {
                        cb.checked = !!playerVotes[idx];
                    });
                    
                    voterNameInput.focus();
                }
            });
        });
    }

    // Événements de suppression de réponse joueur par l'admin
    if (isAdmin) {
        document.querySelectorAll('.btn-delete-player-response').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const playerToDelete = e.currentTarget.dataset.player;
                if (confirm(`Supprimer la réponse de ${playerToDelete} ?`)) {
                    try {
                        await setDoc(docRef, {
                            responses: {
                                [playerToDelete]: deleteField()
                            }
                        }, { merge: true });
                    } catch (err) {
                        console.error("Erreur lors de la suppression de la réponse :", err);
                        alert("Erreur de suppression : " + err.message);
                    }
                }
            });
        });
    }
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

    // Vérifier si le nom existe déjà pour demander confirmation
    const existingName = Object.keys(currentPoll.responses || {}).find(name => name.toLowerCase() === voterName.toLowerCase());
    if (existingName) {
        if (!confirm(`Tu t'apprêtes à modifier les disponibilités de ${existingName}, est-ce bien toi ?`)) {
            return;
        }
    }

    const nameToSave = existingName || voterName;

    // Récupérer les cases à cocher et construire le tableau de réponses
    const checkboxes = Array.from(document.querySelectorAll('.voter-checkbox'))
        .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index));
    
    const votes = checkboxes.map(cb => cb.checked);

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Envoi...";

    try {
        await setDoc(docRef, {
            responses: {
                [nameToSave]: votes
            }
        }, { merge: true });

        // Envoi d'un email de notification via l'extension Firebase Trigger Email
        try {
            await addDoc(collection(db, 'mail'), {
                to: ADMIN_EMAIL,
                message: {
                    subject: `[Calendrier] Disponibilités mises à jour par ${nameToSave}`,
                    html: `
                        <p>Salut David,</p>
                        <p>Le joueur <strong>${nameToSave}</strong> vient de mettre à jour ses disponibilités pour le Doodle de session.</p>
                        <p><a href="https://campagne-wrpg.firebaseapp.com/doodle.html" target="_blank">Consulter le calendrier</a></p>
                    `
                }
            });
        } catch (mailErr) {
            // On ne bloque pas le vote si la création de l'email échoue (ex: règles Firestore non mises à jour)
            console.error("Erreur lors de la création de la notification d'email :", mailErr);
        }

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
