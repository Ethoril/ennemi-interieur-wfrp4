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
function initAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement;
      const body = item.querySelector('.accordion-body');
      const isActive = item.classList.contains('active');

      // Close all others
      item.closest('.accordion').querySelectorAll('.accordion-item').forEach(other => {
        if (other !== item) {
          other.classList.remove('active');
          const otherBody = other.querySelector('.accordion-body');
          if (otherBody) otherBody.style.maxHeight = null;
        }
      });

      // Toggle current
      item.classList.toggle('active', !isActive);
      if (!isActive && body) {
        body.style.maxHeight = body.scrollHeight + 'px';
      } else if (body) {
        body.style.maxHeight = null;
      }
    });
  });

  // Crit sub-table toggles: recalculate parent accordion height
  document.querySelectorAll('.crit-table-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.parentElement;
      section.classList.toggle('open');

      // Recalculate parent accordion-body maxHeight
      const accordionBody = section.closest('.accordion-body');
      if (accordionBody) {
        // Remove max-height constraint so content can grow freely
        accordionBody.style.maxHeight = 'none';
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

  // Open modal
  document.querySelectorAll('.video-card').forEach(card => {
    card.addEventListener('click', () => {
      const videoId = card.dataset.videoId;
      if (videoId && iframe) {
        iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  // Close modal
  function closeModal() {
    overlay.classList.remove('active');
    if (iframe) iframe.src = '';
    document.body.style.overflow = '';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}
