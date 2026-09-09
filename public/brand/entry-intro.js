/* Shared, finite introductions for the static landing page and the React portal. */
(() => {
  'use strict';
  if (typeof customElements === 'undefined' || customElements.get('hader-entry-intro')) return;

  const assetBase = new URL('.', document.currentScript.src);
  const copy = {
    ar: {
      landing: { eyebrow: 'نظام الحضور والانضباط المدرسي', title: 'أهلًا بك في حاضر', subtitle: 'حضور. انصراف. متابعة.', label: 'مقدمة حاضر' },
      system: { eyebrow: 'بوابة الدخول', title: 'حاضر. ليوم دراسي منظّم.', subtitle: 'الإدارة · المشرفون · أولياء الأمور', label: 'مقدمة دخول النظام' },
      skip: 'تخطي المقدمة',
    },
    en: {
      landing: { eyebrow: 'SCHOOL ATTENDANCE & FOLLOW-UP', title: 'Welcome to Hader', subtitle: 'Attendance. Dismissal. Follow-up.', label: 'Welcome to Hader' },
      system: { eyebrow: 'SIGN IN', title: 'Hader. For an organised school day.', subtitle: 'Administration · Supervisors · Parents', label: 'School portal introduction' },
      skip: 'Skip intro',
    },
  };

  class HaderEntryIntro extends HTMLElement {
    connectedCallback() {
      this.variant = this.getAttribute('variant') === 'system' ? 'system' : 'landing';
      this.key = `hader:intro:${this.variant}:v1`;
      this.motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.timers = new Set();
      this.onReplay = event => {
        const button = event.target instanceof Element ? event.target.closest('[data-replay-intro]') : null;
        if (button?.getAttribute('data-replay-intro') === this.variant) this.start(button);
      };
      this.onMotion = () => { if (this.motion.matches) this.finish(true); };
      this.onPageHide = () => this.finish(true, false);
      document.addEventListener('click', this.onReplay);
      this.motion.addEventListener('change', this.onMotion);
      window.addEventListener('pagehide', this.onPageHide);

      let seen = false;
      try { seen = sessionStorage.getItem(this.key) === 'seen'; } catch { /* Storage is optional. */ }
      const deepLink = this.variant === 'landing' && location.hash && location.hash !== '#hero';
      if (!seen && !deepLink && !this.motion.matches) this.start();
    }

    disconnectedCallback() {
      this.clearTimers();
      this.finish(true, false);
      document.removeEventListener('click', this.onReplay);
      this.motion?.removeEventListener('change', this.onMotion);
      window.removeEventListener('pagehide', this.onPageHide);
    }

    later(callback, delay) {
      const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
      this.timers.add(timer);
    }

    clearTimers() {
      this.timers?.forEach(clearTimeout);
      this.timers?.clear();
    }

    start(trigger = null) {
      if (this.dialog?.open || document.querySelector('dialog.hader-entry[open]')) return;
      // A dialog supplies native background inertness, focus containment and Escape handling.
      if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
      const language = document.documentElement.lang === 'en' ? 'en' : 'ar';
      const text = copy[language][this.variant];
      this.returnFocus = trigger || null;
      const dialog = document.createElement('dialog');
      dialog.className = `hader-entry hader-entry--${this.variant}`;
      dialog.dir = language === 'en' ? 'ltr' : 'rtl';
      dialog.lang = language;
      dialog.setAttribute('aria-label', text.label);
      if (this.motion.matches) dialog.classList.add('hader-entry--still');
      dialog.innerHTML = `
        <div class="hader-entry-grid" aria-hidden="true"></div>
        <div class="hader-entry-aura" aria-hidden="true"></div>
        <div class="hader-entry-top" aria-hidden="true"><span>HADER</span><span class="hader-entry-top-label"></span></div>
        <div class="hader-entry-content">
          <p class="hader-entry-eyebrow"></p>
          <div class="hader-entry-stage">
            <svg class="hader-entry-circuit" viewBox="0 0 600 260" fill="none" aria-hidden="true">
              <path pathLength="1" d="M0 130H56L88 98H134M600 130H544L512 162H466M185 14H148V50M415 246H452V210M415 14H452V50M185 246H148V210"/>
              <circle cx="134" cy="98" r="4"/><circle cx="466" cy="162" r="4"/>
            </svg>
            <span class="hader-entry-ring" aria-hidden="true"></span>
            <img class="hader-entry-logo" width="1024" height="490" alt="" draggable="false">
            <span class="hader-entry-logo-fallback" aria-hidden="true" hidden>حاضر</span>
            <span class="hader-entry-scan" aria-hidden="true"></span>
          </div>
          <h2 class="hader-entry-title"></h2>
          <p class="hader-entry-subtitle"></p>
          <div class="hader-entry-signals" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
        <div class="hader-entry-bottom"><span class="hader-entry-caption" aria-hidden="true"></span><button type="button" class="hader-entry-skip" autofocus></button></div>`;
      dialog.querySelector('.hader-entry-eyebrow').textContent = text.eyebrow;
      dialog.querySelector('.hader-entry-title').textContent = text.title;
      dialog.querySelector('.hader-entry-subtitle').textContent = text.subtitle;
      dialog.querySelector('.hader-entry-top-label').textContent = text.eyebrow;
      dialog.querySelector('.hader-entry-caption').textContent = text.label;
      dialog.querySelector('.hader-entry-skip').textContent = copy[language].skip;
      const logo = dialog.querySelector('img');
      logo.addEventListener('error', () => {
        logo.hidden = true;
        dialog.querySelector('.hader-entry-logo-fallback').hidden = false;
      });
      logo.src = new URL('hader-logo.png', assetBase).href;
      dialog.addEventListener('cancel', event => { event.preventDefault(); this.finish(true); });
      dialog.querySelector('button').addEventListener('click', () => this.finish(true));
      this.dialog = dialog;
      this.append(dialog);
      try {
        dialog.showModal();
      } catch {
        dialog.remove();
        this.dialog = null;
        return;
      }
      this.previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      this.ownsScrollLock = true;
      try { sessionStorage.setItem(this.key, 'seen'); } catch { /* No persistent state is required. */ }
      const duration = this.motion.matches ? 1200 : this.variant === 'system' ? 2600 : 2200;
      this.later(() => this.finish(false), duration);
    }

    finish(immediate = false, restoreFocus = true) {
      if (!this.dialog) return;
      this.clearTimers();
      const dialog = this.dialog;
      const close = () => {
        if (this.dialog !== dialog) return;
        dialog.close();
        dialog.remove();
        this.dialog = null;
        if (this.ownsScrollLock) {
          document.documentElement.style.overflow = this.previousOverflow;
          this.ownsScrollLock = false;
        }
        if (!restoreFocus) return;
        const destination = this.returnFocus?.isConnected
          ? this.returnFocus
          : document.getElementById(this.getAttribute('focus-target'));
        if (destination) {
          const hadTabIndex = destination.hasAttribute('tabindex');
          if (!hadTabIndex && !destination.matches('a[href], button, input, select, textarea')) {
            destination.setAttribute('tabindex', '-1');
            destination.addEventListener('blur', () => destination.removeAttribute('tabindex'), { once: true });
          }
          destination.focus({ preventScroll: true });
        }
      };
      if (immediate || this.motion.matches) close();
      else {
        dialog.classList.add('hader-entry--leaving');
        this.later(close, 320);
      }
    }
  }

  customElements.define('hader-entry-intro', HaderEntryIntro);
  if (typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype.showModal) {
    document.documentElement.setAttribute('data-entry-intros', 'ready');
  }
})();
