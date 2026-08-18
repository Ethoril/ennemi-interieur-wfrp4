import { db } from './firebase-init.js';
import { auth, ADMIN_EMAIL, watchAuth, loginWithGoogle, logout } from './auth.js';
import { doc, setDoc, deleteDoc, onSnapshot, collection, addDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { esc } from './utils.js';

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
const doodleContentContainer = document.getElementById('doodle-content-container');
const doodleClosedBanner = document.getElementById('doodle-closed-banner');
const doodleAuthBar = document.getElementById('doodle-auth-bar');

const btnViewHorizontal = document.getElementById('btn-view-horizontal');
const btnViewVertical = document.getElementById('btn-view-vertical');

// Eléments de la modale des votes
const doodleVotesModal = document.getElementById('doodle-votes-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const modalDateDetails = document.getElementById('modal-date-details');
const modalVotersList = document.getElementById('modal-voters-list');

// Reference du document dans Firestore
const docRef = doc(db, 'doodle', 'current');

// Etat local
let currentPoll = null;
let forceCreateMode = false;
let currentLayout = localStorage.getItem('doodle_layout') || 'vertical';

// Gestion du format d'affichage (Horizontal/Vertical)
function updateLayoutButtons() {
    if (!btnViewHorizontal || !btnViewVertical) return;
    if (currentLayout === 'vertical') {
        btnViewHorizontal.classList.remove('active');
        btnViewVertical.classList.add('active');
    } else {
        btnViewHorizontal.classList.add('active');
        btnViewVertical.classList.remove('active');
    }
}

if (btnViewHorizontal && btnViewVertical) {
    btnViewHorizontal.addEventListener('click', () => {
        if (currentLayout === 'horizontal') return;
        const currentName = document.getElementById('voter-name-vertical')?.value || "";
        currentLayout = 'horizontal';
        localStorage.setItem('doodle_layout', 'horizontal');
        updateLayoutButtons();
        if (currentPoll) renderPoll(currentPoll);
        const nameInput = document.getElementById('voter-name');
        if (nameInput) nameInput.value = currentName;
    });

    btnViewVertical.addEventListener('click', () => {
        if (currentLayout === 'vertical') return;
        const currentName = document.getElementById('voter-name')?.value || "";
        currentLayout = 'vertical';
        localStorage.setItem('doodle_layout', 'vertical');
        updateLayoutButtons();
        if (currentPoll) renderPoll(currentPoll);
        const nameInput = document.getElementById('voter-name-vertical');
        if (nameInput) nameInput.value = currentName;
    });
}

// Initialisation de la vue sélectionnée
updateLayoutButtons();

// Initialisation de la surveillance de l'état d'authentification
watchAuth((user, isAdmin) => {
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
    doodleLoader.innerHTML = `<span class="doodle-loader-error">Erreur de chargement du sondage.</span>`;
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
            <span class="doodle-muted">Connecté en tant que <strong class="doodle-auth-name">${esc(user.displayName || user.email)}</strong></span>
            <button id="btn-signout" class="btn-ghost doodle-btn-auth">Déconnexion</button>
        `;
        document.getElementById('btn-signout').addEventListener('click', () => logout());
    } else {
        doodleAuthBar.innerHTML = `
            <span class="doodle-muted">Tu es Maître de Jeu ?</span>
            <button id="btn-signin" class="btn-primary doodle-btn-auth">🔑 Connexion Admin</button>
        `;
        document.getElementById('btn-signin').addEventListener('click', () => {
            loginWithGoogle().catch(err => {
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

// Rendu du tableau ou des cartes
function renderPoll(pollData) {
    const dates = pollData.dates || [];
    const responses = pollData.responses || {};
    const isClosed = pollData.closed === true;

    if (doodleClosedBanner) {
        doodleClosedBanner.style.display = isClosed ? 'block' : 'none';
    }

    // Sauvegarder les valeurs saisies par l'utilisateur avant le re-rendu
    let savedVoterName = "";
    if (currentLayout === 'vertical') {
        savedVoterName = document.getElementById('voter-name-vertical')?.value || "";
    } else {
        savedVoterName = document.getElementById('voter-name')?.value || "";
    }

    const savedCheckedStates = Array.from(document.querySelectorAll('.voter-checkbox'))
        .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index))
        .map(cb => cb.checked);

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

    // Rendu en fonction du layout sélectionné
    if (currentLayout === 'vertical') {
        renderVerticalPoll(pollData, playerNames, totals, isClosed, isAdmin);
    } else {
        renderHorizontalPoll(pollData, playerNames, totals, isClosed, isAdmin);
    }

    // Restaurer les valeurs saisies si le sondage est ouvert
    if (!isClosed) {
        const voterNameInput = document.getElementById(currentLayout === 'vertical' ? 'voter-name-vertical' : 'voter-name');
        if (voterNameInput) {
            voterNameInput.value = savedVoterName;
        }

        const checkboxes = document.querySelectorAll('.voter-checkbox');
        checkboxes.forEach((cb) => {
            const idx = parseInt(cb.dataset.index);
            if (!isNaN(idx) && idx < savedCheckedStates.length) {
                cb.checked = savedCheckedStates[idx];
            }
        });
    }

    // Événement de soumission du vote
    if (!isClosed) {
        if (currentLayout === 'vertical') {
            const submitBtnTop = document.getElementById('btn-submit-vote-vertical');
            const submitBtnBottom = document.getElementById('btn-submit-vote-vertical-bottom');
            if (submitBtnTop) submitBtnTop.addEventListener('click', submitVote);
            if (submitBtnBottom) submitBtnBottom.addEventListener('click', submitVote);
        } else {
            const submitBtn = document.getElementById('btn-submit-vote');
            if (submitBtn) submitBtn.addEventListener('click', submitVote);
        }
    }

    // Événements de modification de réponse joueur par clic (uniquement en format horizontal)
    if (!isClosed && currentLayout === 'horizontal') {
        document.querySelectorAll('.btn-edit-player-response').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerName = e.currentTarget.dataset.player;
                const voterNameInput = document.getElementById('voter-name');
                if (voterNameInput) {
                    voterNameInput.value = playerName;
                    
                    const playerVotes = responses[playerName] || [];
                    const checkboxes = document.querySelectorAll('.voter-checkbox');
                    checkboxes.forEach((cb) => {
                        const idx = parseInt(cb.dataset.index);
                        if (!isNaN(idx) && idx < playerVotes.length) {
                            cb.checked = !!playerVotes[idx];
                        }
                    });
                    
                    voterNameInput.focus();
                }
            });
        });
    }

    // Événements de suppression de réponse joueur par l'admin (uniquement en format horizontal)
    if (isAdmin && currentLayout === 'horizontal') {
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

    // Événement d'ouverture de la modale des votes (uniquement en format vertical)
    if (currentLayout === 'vertical') {
        document.querySelectorAll('.btn-show-votes').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dateIndex = parseInt(e.currentTarget.dataset.index);
                openVotesModal(pollData, dateIndex, playerNames);
            });
        });
    }
}

// Rendu en format horizontal
function renderHorizontalPoll(pollData, playerNames, totals, isClosed, isAdmin) {
    const dates = pollData.dates || [];
    const responses = pollData.responses || {};

    let html = `
        <div class="sheet-table-wrapper">
            <table class="rules-table doodle-table">
                <thead>
                    <tr>
                        <th class="doodle-th-player">Joueurs</th>
                        ${dates.map(date => `<th class="doodle-th-date">${esc(date)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    playerNames.forEach(name => {
        const votes = responses[name] || [];
        
        let nameHtml = esc(name);
        if (!isClosed) {
            if (isAdmin) {
                nameHtml = `
                    <div class="doodle-player-name-wrap">
                        <span>${esc(name)}</span>
                        <div class="doodle-player-actions">
                            <button class="btn-edit-player-response doodle-btn-icon" data-player="${esc(name)}" title="Modifier la réponse de ${esc(name)}">✏️</button>
                            <button class="btn-delete-player-response doodle-btn-icon doodle-btn-icon-danger" data-player="${esc(name)}" title="Supprimer la réponse de ${esc(name)}">🗑️</button>
                        </div>
                    </div>
                `;
            } else {
                nameHtml = `
                    <div class="doodle-player-name-wrap">
                        <span>${esc(name)}</span>
                        <button class="btn-edit-player-response doodle-btn-icon" data-player="${esc(name)}" title="Modifier ma réponse">✏️</button>
                    </div>
                `;
            }
        } else if (isAdmin) {
            nameHtml = `
                <div class="doodle-player-name-wrap">
                    <span>${esc(name)}</span>
                    <button class="btn-delete-player-response doodle-btn-icon doodle-btn-icon-danger" data-player="${esc(name)}" title="Supprimer la réponse de ${esc(name)}">🗑️</button>
                </div>
            `;
        }

        html += `
            <tr class="doodle-player-row">
                <td class="doodle-td-player">${nameHtml}</td>
                ${dates.map((_, index) => {
                    const available = votes[index] === true;
                    return `
                        <td class="doodle-td-vote">
                            ${available
                                ? `<span class="doodle-vote-yes" title="Disponible">✔</span>`
                                : `<span class="doodle-vote-no" title="Indisponible">✘</span>`
                            }
                        </td>
                    `;
                }).join('')}
            </tr>
        `;
    });

    html += `
        <tr class="doodle-row-total">
            <td class="doodle-td-total-label">Total dispos</td>
            ${totals.map(t => `<td class="doodle-td-total">${t}</td>`).join('')}
        </tr>
    `;

    if (!isClosed) {
        html += `
            <tr class="voter-row doodle-voter-row">
                <td class="doodle-td-voter-name">
                    <input type="text" id="voter-name" class="doodle-input doodle-input-voter" placeholder="Ton pseudo...">
                </td>
                ${dates.map((_, index) => `
                    <td class="doodle-td-voter-check">
                        <label class="doodle-checkbox-wrap">
                            <input type="checkbox" class="voter-checkbox doodle-checkbox" data-index="${index}">
                        </label>
                    </td>
                `).join('')}
            </tr>
            <tr>
                <td colspan="${dates.length + 1}" class="doodle-td-submit">
                    <span id="vote-error" class="doodle-vote-error doodle-vote-error-horizontal" role="alert"></span>
                    <button id="btn-submit-vote" class="btn-primary doodle-btn-submit">Valider mon vote</button>
                </td>
            </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    </div>
    `;
    doodleContentContainer.innerHTML = html;
}

// Rendu en format vertical (Cartes + Modale)
function renderVerticalPoll(pollData, playerNames, totals, isClosed, isAdmin) {
    const dates = pollData.dates || [];

    let html = "";

    // Saisie du pseudo au-dessus des cartes (si non clôturé)
    if (!isClosed) {
        html += `
            <div class="doodle-voter-form">
                <div id="doodle-voter-input-vertical" class="doodle-voter-field">
                    <label for="voter-name-vertical" class="doodle-voter-label">Ton pseudo pour voter :</label>
                    <div class="doodle-voter-input-row">
                        <input type="text" id="voter-name-vertical" class="doodle-input doodle-input-voter-inline" placeholder="Ton pseudo...">
                        <button id="btn-submit-vote-vertical" class="btn-primary doodle-btn-submit-inline">Valider mon vote</button>
                    </div>
                    <span id="vote-error-vertical" class="doodle-vote-error doodle-vote-error-vertical" role="alert"></span>
                </div>
            </div>
        `;
    }

    // Liste des cartes
    html += `<div class="doodle-cards-list">`;

    dates.forEach((date, dateIndex) => {
        const dateTotal = totals[dateIndex] || 0;
        
        html += `
            <div class="doodle-card">
                <div class="doodle-card-info">
                    ${!isClosed ? `
                        <label class="doodle-checkbox-wrap">
                            <input type="checkbox" class="voter-checkbox doodle-checkbox" data-index="${dateIndex}">
                        </label>
                    ` : ''}
                    <span class="doodle-card-date">
                        ${esc(date)}
                    </span>
                </div>

                <div>
                    <button class="btn-show-votes doodle-btn-votes" data-index="${dateIndex}">
                        👥 Votes : ${dateTotal} Oui
                    </button>
                </div>
            </div>
        `;
    });

    html += `</div>`;

    // Bouton de validation doublé en bas (si non clôturé)
    if (!isClosed) {
        html += `
            <div class="doodle-submit-bottom">
                <button id="btn-submit-vote-vertical-bottom" class="btn-primary">
                    Valider mon vote
                </button>
            </div>
        `;
    }

    doodleContentContainer.innerHTML = html;
}

// Soumission du vote joueur
async function submitVote() {
    const isVertical = currentLayout === 'vertical';
    const voterNameInput = document.getElementById(isVertical ? 'voter-name-vertical' : 'voter-name');
    const voterName = voterNameInput ? voterNameInput.value.trim() : "";
    const voteError = document.getElementById(isVertical ? 'vote-error-vertical' : 'vote-error');
    
    // Récupérer tous les boutons de soumission du layout actuel
    const btnSubmitList = [];
    if (isVertical) {
        const btnTop = document.getElementById('btn-submit-vote-vertical');
        const btnBottom = document.getElementById('btn-submit-vote-vertical-bottom');
        if (btnTop) btnSubmitList.push(btnTop);
        if (btnBottom) btnSubmitList.push(btnBottom);
    } else {
        const btnHoriz = document.getElementById('btn-submit-vote');
        if (btnHoriz) btnSubmitList.push(btnHoriz);
    }

    if (voteError) voteError.style.display = 'none';

    if (!voterName) {
        if (voteError) {
            voteError.textContent = "Saisis ton nom pour voter.";
            voteError.style.display = 'inline';
        }
        if (voterNameInput) voterNameInput.focus();
        return;
    }

    if (voterName.toLowerCase() === 'david' && (!auth.currentUser || auth.currentUser.email !== ADMIN_EMAIL)) {
        if (voteError) {
            voteError.textContent = "Le nom 'David' est réservé au MDJ.";
            voteError.style.display = 'inline';
        }
        if (voterNameInput) voterNameInput.focus();
        return;
    }

    // Le pseudo est une clé de la map `responses` : les règles Firestore ne peuvent pas
    // en valider le contenu (pas de boucle dans le langage de règles). Borne côté client.
    const MAX_PSEUDO = 40;
    if (voterName.length > MAX_PSEUDO || /[\x00-\x1f\x7f]/.test(voterName)) {
        if (voteError) {
            voteError.textContent = `Pseudo trop long ou caractères non autorisés (${MAX_PSEUDO} caractères maximum).`;
            voteError.style.display = 'inline';
        }
        if (voterNameInput) voterNameInput.focus();
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

    btnSubmitList.forEach(btn => {
        btn.disabled = true;
        btn.textContent = "Envoi...";
    });

    try {
        await setDoc(docRef, {
            responses: {
                [nameToSave]: votes
            }
        }, { merge: true });

        // Envoi d'un email de notification
        try {
            await addDoc(collection(db, 'mail'), {
                to: ADMIN_EMAIL,
                message: {
                    subject: `[Calendrier] Disponibilités mises à jour par ${nameToSave}`,
                    html: `
                        <p>Salut David,</p>
                        <p>Le joueur <strong>${esc(nameToSave)}</strong> vient de mettre à jour ses disponibilités pour le Doodle de session.</p>
                        <p><a href="https://campagne-wrpg.firebaseapp.com/doodle.html" target="_blank">Consulter le calendrier</a></p>
                    `
                }
            });
        } catch (mailErr) {
            console.error("Erreur lors de la création de la notification d'email :", mailErr);
        }

        // Vider le champ de texte
        if (voterNameInput) voterNameInput.value = "";
    } catch (err) {
        console.error("Erreur lors de la soumission du vote :", err);
        if (voteError) {
            voteError.textContent = "Erreur : " + err.message;
            voteError.style.display = 'inline';
        }
    } finally {
        btnSubmitList.forEach(btn => {
            btn.disabled = false;
            btn.textContent = "Valider mon vote";
        });
    }
}

// Logique de la Modale de détail des votes
let activeFilter = 'all';

function openVotesModal(pollData, dateIndex, playerNames) {
    const dates = pollData.dates || [];
    const responses = pollData.responses || {};
    const dateText = dates[dateIndex] || "";
    const isClosed = pollData.closed === true;
    
    const user = auth.currentUser;
    const isAdmin = user && user.email === ADMIN_EMAIL;

    if (modalDateDetails) {
        modalDateDetails.textContent = dateText;
    }

    activeFilter = 'all';
    updateFilterButtonStyles();

    function renderVoters() {
        if (!modalVotersList) return;
        
        let votersHtml = "";
        
        playerNames.forEach(name => {
            const votes = responses[name] || [];
            const available = votes[dateIndex] === true;
            
            // Appliquer le filtre
            if (activeFilter === 'yes' && !available) return;
            if (activeFilter === 'no' && available) return;
            
            const badgeClass = available ? 'doodle-voter-badge-yes' : 'doodle-voter-badge-no';
            const badgeText = available ? 'Oui' : 'Non';
            const initials = name ? name.charAt(0).toUpperCase() : "?";

            // Boutons d'action édition / suppression
            let actionsHtml = "";
            if (!isClosed) {
                if (isAdmin) {
                    actionsHtml = `
                        <div class="doodle-player-actions">
                            <button class="modal-btn-edit doodle-btn-icon" data-player="${esc(name)}" title="Modifier">✏️</button>
                            <button class="modal-btn-delete doodle-btn-icon doodle-btn-icon-danger" data-player="${esc(name)}" title="Supprimer">🗑️</button>
                        </div>
                    `;
                } else {
                    actionsHtml = `
                        <button class="modal-btn-edit doodle-btn-icon" data-player="${esc(name)}" title="Modifier">✏️</button>
                    `;
                }
            } else if (isAdmin) {
                actionsHtml = `
                    <button class="modal-btn-delete doodle-btn-icon doodle-btn-icon-danger" data-player="${esc(name)}" title="Supprimer">🗑️</button>
                `;
            }

            votersHtml += `
                <div class="doodle-voter-item">
                    <div class="doodle-voter-identity">
                        <div class="doodle-voter-avatar">${esc(initials)}</div>
                        <span class="doodle-voter-name">${esc(name)}</span>
                        ${actionsHtml}
                    </div>
                    <span class="${badgeClass}">${badgeText}</span>
                </div>
            `;
        });
        
        if (votersHtml === "") {
            votersHtml = `<div class="doodle-modal-empty">Aucun vote à afficher</div>`;
        }
        
        modalVotersList.innerHTML = votersHtml;

        // Attacher les écouteurs sur les boutons d'édition dans la modale
        modalVotersList.querySelectorAll('.modal-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerName = e.currentTarget.dataset.player;
                const voterNameInput = document.getElementById('voter-name-vertical');
                if (voterNameInput) {
                    voterNameInput.value = playerName;
                    
                    const playerVotes = responses[playerName] || [];
                    const checkboxes = document.querySelectorAll('.voter-checkbox');
                    checkboxes.forEach((cb) => {
                        const idx = parseInt(cb.dataset.index);
                        if (!isNaN(idx) && idx < playerVotes.length) {
                            cb.checked = !!playerVotes[idx];
                        }
                    });
                    
                    voterNameInput.focus();
                }
                closeModal();
            });
        });

        // Attacher les écouteurs sur les boutons de suppression dans la modale
        modalVotersList.querySelectorAll('.modal-btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const playerToDelete = e.currentTarget.dataset.player;
                if (confirm(`Supprimer la réponse de ${playerToDelete} ?`)) {
                    try {
                        await setDoc(docRef, {
                            responses: {
                                [playerToDelete]: deleteField()
                            }
                        }, { merge: true });
                        closeModal();
                    } catch (err) {
                        console.error("Erreur lors de la suppression de la réponse :", err);
                        alert("Erreur de suppression : " + err.message);
                    }
                }
            });
        });
    }

    const setFilter = (filterName) => {
        activeFilter = filterName;
        updateFilterButtonStyles();
        renderVoters();
    };

    const cloneAndAddClick = (id, filterVal) => {
        const btn = document.getElementById(id);
        if (btn) {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => setFilter(filterVal));
        }
    };
    
    cloneAndAddClick('btn-filter-all', 'all');
    cloneAndAddClick('btn-filter-yes', 'yes');
    cloneAndAddClick('btn-filter-no', 'no');

    if (doodleVotesModal) {
        doodleVotesModal.style.display = 'flex';
    }

    renderVoters();
}

function updateFilterButtonStyles() {
    const btnAll = document.getElementById('btn-filter-all');
    const btnYes = document.getElementById('btn-filter-yes');
    const btnNo = document.getElementById('btn-filter-no');

    if (btnAll) btnAll.classList.toggle('active', activeFilter === 'all');
    if (btnYes) btnYes.classList.toggle('active', activeFilter === 'yes');
    if (btnNo) btnNo.classList.toggle('active', activeFilter === 'no');
}

if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeModal);
}
if (doodleVotesModal) {
    doodleVotesModal.addEventListener('click', (e) => {
        if (e.target === doodleVotesModal) {
            closeModal();
        }
    });
}

function closeModal() {
    if (doodleVotesModal) {
        doodleVotesModal.style.display = 'none';
    }
}
