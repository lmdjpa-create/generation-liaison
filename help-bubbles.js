(() => {
  function initializeHelpBubbles() {
    document.querySelectorAll('details[data-help-for], details.info-card').forEach((details, index) => {
      const summary = details.querySelector('summary');
      const bubble = details.querySelector('.gl-help-bubble');
      if (!summary || !bubble) return;
      const selector = details.getAttribute('data-help-for');
      const targets = selector ? [...document.querySelectorAll(selector)] : [summary];
      if (!bubble.id) bubble.id = `gl-help-description-${index + 1}`;
      for (const target of targets) {
        const descriptions = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (!descriptions.includes(bubble.id)) {
          target.setAttribute('aria-describedby', [...descriptions, bubble.id].join(' '));
        }
      }
      let timer = null;
      let automatic = false;
      let anchor = summary;

      function cancelTimer() {
        clearTimeout(timer);
        timer = null;
      }

      function position() {
        const rect = anchor.getBoundingClientRect();
        bubble.style.maxHeight = '';
        const width = bubble.offsetWidth;
        const availableBelow = Math.max(0, window.innerHeight - rect.bottom - 8);
        const availableAbove = Math.max(0, rect.top - 8);
        const belowAnchor = bubble.offsetHeight <= availableBelow || availableBelow >= availableAbove;
        const available = belowAnchor ? availableBelow : availableAbove;
        bubble.style.maxHeight = `${Math.min(available, window.innerHeight * 0.6, 480)}px`;
        const height = bubble.offsetHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const top = belowAnchor ? rect.bottom : Math.max(8, rect.top - height);
        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;
      }

      function schedule(target) {
        cancelTimer();
        if (details.open || details.parentElement.closest('details:not([open])')) return;
        timer = setTimeout(() => {
          anchor = target;
          automatic = true;
          details.open = true;
          position();
          timer = null;
        }, 2000);
      }

      function leave(event) {
        cancelTimer();
        const next = event.relatedTarget;
        if (next && (details.contains(next) || targets.some(target => target.contains(next)))) return;
        if (automatic && !details.contains(document.activeElement) &&
            !targets.some(target => target === document.activeElement)) {
          details.open = false;
          automatic = false;
        }
      }

      for (const target of new Set([...targets, summary])) {
        target.addEventListener('pointerenter', event => {
          if (event.pointerType !== 'touch') schedule(target);
        });
        target.addEventListener('pointerleave', leave);
        target.addEventListener('focus', () => schedule(target));
        target.addEventListener('blur', leave);
        if (target !== summary) target.addEventListener('click', () => {
          cancelTimer();
          if (automatic) details.open = false;
          automatic = false;
        });
      }
      details.addEventListener('pointerleave', leave);
      details.addEventListener('focusout', leave);
      summary.addEventListener('click', () => {
        cancelTimer();
        automatic = false;
        anchor = summary;
      });
      details.addEventListener('toggle', () => {
        if (details.open) position();
        else automatic = false;
      });
      details.dataset.helpEnhanced = 'true';
      window.addEventListener('scroll', () => {
        if (details.open) position();
      }, true);
      window.addEventListener('resize', () => {
        if (details.open) position();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && details.open) {
          cancelTimer();
          details.open = false;
          automatic = false;
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHelpBubbles);
  } else {
    initializeHelpBubbles();
  }
})();
