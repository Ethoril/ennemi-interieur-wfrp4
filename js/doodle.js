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
const btnFilterAll = document.getElementById('btn-filter-all');
const btnFilterYes = document.getElementById('btn-filter-yes');
const btnFilterNo = document.getElementById('btn-filter-no');

// Reference du document dans Firestore
const docRef = doc(db, 'doodle', 'current');

// Etat local
let currentPoll = null;
let forceCreateMode = false;
let currentLayout = localStorage.getItem('doodle_layout') || 'horizontal';

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
            <table class="rules-table" style="width: 100%; border-collapse: collapse; text-align: center;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 12px; border-bottom: 2px solid var(--border-strong); min-width: 180px; width: 180px;">Joueurs</th>
                        ${dates.map(date => `<th style="padding: 12px; border-bottom: 2px solid var(--border-strong); min-width: 120px; font-size: 0.85rem; line-height: 1.2;">${date}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

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

    html += `
        <tr style="border-bottom: 2px solid var(--border-strong); background: rgba(201, 168, 76, 0.05); font-weight: bold;">
            <td style="text-align: left; padding: 12px; color: var(--gold); min-width: 180px; width: 180px;">Total dispos</td>
            ${totals.map(t => `<td style="padding: 12px; text-align: center; color: var(--gold);">${t}</td>`).join('')}
        </tr>
    `;

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
    const responses = pollData.responses || {};

    let html = "";

    // Saisie du pseudo au-dessus des cartes (si non clôturé)
    if (!isClosed) {
        html += `
            <div style="display: flex; justify-content: flex-start; align-items: flex-end; gap: 15px; margin-bottom: 2rem; flex-wrap: wrap;">
                <div id="doodle-voter-input-vertical" style="text-align: left; width: 100%; max-width: 450px;">
                    <label for="voter-name-vertical" style="display: block; font-family: var(--font-heading); color: var(--gold); margin-bottom: 0.5rem; font-weight: bold; font-size: 0.95rem;">Ton pseudo pour voter :</label>
                    <div style="display: flex; gap: 10px; align-items: center; width: 100%;">
                        <input type="text" id="voter-name-vertical" placeholder="Ton pseudo..." style="flex: 1; min-width: 150px; padding: 8px 12px; border: 1px solid var(--border-subtle); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: var(--radius-sm);">
                        <button id="btn-submit-vote-vertical" class="btn-primary" style="margin: 0; padding: 8px 20px; font-size: 0.9rem; white-space: nowrap;">Valider mon vote</button>
                    </div>
                    <span id="vote-error-vertical" style="color: #e74c3c; font-size: 0.9rem; margin-top: 5px; display: none;"></span>
                </div>
            </div>
        `;
    }

    // Liste des cartes
    html += `<div class="doodle-cards-list" style="display: flex; flex-direction: column; gap: 0.8rem;">`;

    dates.forEach((date, dateIndex) => {
        const dateTotal = totals[dateIndex] || 0;
        
        html += `
            <div class="doodle-card">
                <div style="display: flex; align-items: center; gap: 15px;">
                    ${!isClosed ? `
                        <label class="custom-checkbox-container" style="display: inline-block; position: relative; cursor: pointer; user-select: none; width: 22px; height: 22px; margin: 0;">
                            <input type="checkbox" class="voter-checkbox" data-index="${dateIndex}" style="width: 22px; height: 22px; cursor: pointer; margin: 0;">
                        </label>
                    ` : ''}
                    <span style="font-family: var(--font-heading); color: var(--text-primary); font-size: 1.05rem; font-weight: bold;">
                        ${date}
                    </span>
                </div>
                
                <div>
                    <button class="btn-show-votes" data-index="${dateIndex}" style="background: rgba(201, 168, 76, 0.05); border: 1px solid var(--border-gold); color: var(--gold); border-radius: var(--radius-sm); padding: 6px 12px; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px; font-family: var(--font-heading); transition: all var(--transition-fast);">
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
            <div style="display: flex; justify-content: flex-start; margin-top: 1.5rem;">
                <button id="btn-submit-vote-vertical-bottom" class="btn-primary" style="margin: 0; padding: 10px 24px; font-size: 0.95rem;">
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
                        <p>Le joueur <strong>${nameToSave}</strong> vient de mettre à jour ses disponibilités pour le Doodle de session.</p>
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
                        <div style="display: flex; gap: 4px;">
                            <button class="modal-btn-edit" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: var(--gold); cursor: pointer; padding: 2px; font-size: 0.9rem;" title="Modifier">✏️</button>
                            <button class="modal-btn-delete" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: #c94c4c; cursor: pointer; padding: 2px; font-size: 0.9rem;" title="Supprimer">🗑️</button>
                        </div>
                    `;
                } else {
                    actionsHtml = `
                        <button class="modal-btn-edit" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: var(--gold); cursor: pointer; padding: 2px;" title="Modifier">✏️</button>
                    `;
                }
            } else if (isAdmin) {
                actionsHtml = `
                    <button class="modal-btn-delete" data-player="${name.replace(/"/g, '&quot;')}" style="background: none; border: none; color: #c94c4c; cursor: pointer; padding: 2px;" title="Supprimer">🗑️</button>
                `;
            }
            
            votersHtml += `
                <div class="doodle-voter-item">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="doodle-voter-avatar">${initials}</div>
                        <span style="font-family: var(--font-body); font-weight: bold; color: var(--text-primary);">${name}</span>
                        ${actionsHtml}
                    </div>
                    <span class="${badgeClass}">${badgeText}</span>
                </div>
            `;
        });
        
        if (votersHtml === "") {
            votersHtml = `<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 10px 0;">Aucun vote à afficher</div>`;
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
