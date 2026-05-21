/* ================================================
   WARHAMMER — L'ENNEMI INTÉRIEUR
   Main JavaScript
   ================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initScrollAnimations();
  initAccordion();
  initVideoModal();
});

/* ── Navigation ────────────────────────────────── */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const burger = document.querySelector('.nav-burger');
  const links = document.querySelector('.nav-links');

  // Scroll effect
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
  }

  // Mobile burger
  if (burger && links) {
    burger.addEventListener('click', () => {
      burger.classList.toggle('active');
      links.classList.toggle('open');
    });

    // Close on link click
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        burger.classList.remove('active');
        links.classList.remove('open');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!burger.contains(e.target) && !links.contains(e.target)) {
        burger.classList.remove('active');
        links.classList.remove('open');
      }
    });
  }

  // Set active nav link
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}

/* ── Scroll Animations ─────────────────────────── */
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.fade-in, .stagger-children').forEach(el => {
    observer.observe(el);
  });
}

/* ── Accordion ─────────────────────────────────── */
// ARIA promu au runtime plutôt que dans le HTML (30+ accordéons) :
// chaque header reçoit aria-expanded + aria-controls, chaque body reçoit
// role="region" + id. aria-expanded est synchronisé à chaque toggle.
let _accordionUid = 0;
function _ensureAriaPair(trigger, panel, prefix) {
  if (!trigger || !panel) return;
  if (!panel.id) panel.id = `${prefix}-${++_accordionUid}`;
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-expanded', 'false');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', trigger.id || (trigger.id = `${panel.id}-trigger`));
}

function initAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    const item = header.parentElement;
    const body = item.querySelector('.accordion-body');
    _ensureAriaPair(header, body, 'acc-body');

    header.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      // Close all others
      item.closest('.accordion').querySelectorAll('.accordion-item').forEach(other => {
        if (other !== item) {
          other.classList.remove('active');
          const otherBody = other.querySelector('.accordion-body');
          if (otherBody) otherBody.style.maxHeight = null;
          other.querySelector('.accordion-header')?.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current
      const willOpen = !isActive;
      item.classList.toggle('active', willOpen);
      header.setAttribute('aria-expanded', String(willOpen));
      if (willOpen && body) {
        body.style.maxHeight = body.scrollHeight + 'px';
      } else if (body) {
        body.style.maxHeight = null;
      }
    });
  });

  // Crit sub-table toggles: recalculate parent accordion height
  document.querySelectorAll('.crit-table-toggle').forEach(btn => {
    const section = btn.parentElement;
    const subBody = section.querySelector('.crit-table-body');
    _ensureAriaPair(btn, subBody, 'crit-body');

    btn.addEventListener('click', () => {
      const willOpen = !section.classList.contains('open');
      section.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));

      // Wait for CSS to apply before measuring, so scrollHeight is accurate
      const accordionBody = section.closest('.accordion-body');
      if (accordionBody) {
        requestAnimationFrame(() => {
          accordionBody.style.maxHeight = accordionBody.scrollHeight + 'px';
        });
      }
    });
  });
}

/* ── Video Modal ───────────────────────────────── */
function initVideoModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) return;

  const iframe = overlay.querySelector('iframe');
  const closeBtn = overlay.querySelector('.modal-close');
  overlay.setAttribute('aria-hidden', 'true');
  let lastTrigger = null;

  // Promotion clavier des cartes vidéo (rôle bouton + Enter/Space)
  document.querySelectorAll('.video-card').forEach(card => {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-haspopup', 'dialog');
    const title = card.querySelector('.video-info h3')?.textContent?.trim();
    if (title) card.setAttribute('aria-label', `Lire la vidéo : ${title}`);

    const open = () => {
      const videoId = card.dataset.videoId;
      if (!videoId || !iframe) return;
      lastTrigger = card;
      iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
      overlay.classList.add('active');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // Focus le bouton de fermeture pour entrer dans la modale au clavier
      setTimeout(() => closeBtn?.focus(), 0);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  function closeModal() {
    if (!overlay.classList.contains('active')) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    if (iframe) iframe.src = '';
    document.body.style.overflow = '';
    // Rendre le focus à la carte qui a ouvert la modale (accessibilité)
    lastTrigger?.focus();
    lastTrigger = null;
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Focus trap : Tab/Shift+Tab boucle entre les éléments focusables de la modale.
  // Ici, seul le bouton ✕ Fermer est focusable (l'iframe gère son focus interne) —
  // on garde la tabulation captive sur ce bouton tant que la modale est ouverte.
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    closeBtn?.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}
