(() => {
  'use strict';

  const root = document.documentElement;
  const nav = document.querySelector('.site-header');
  const menuToggle = document.getElementById('menuToggle');
  const languageToggle = document.getElementById('languageToggle');
  const themeToggle = document.getElementById('themeToggle');
  const readPreference = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const savePreference = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
  };
  let language = readPreference('waki-lang') === 'en' ? 'en' : 'ar';
  const translatedNodes = [...document.querySelectorAll('[data-en]')].map(node => ({
    node, arabic: [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('')
  }));
  const translatedLabels = [...document.querySelectorAll('[data-en-aria]')].map(node => ({
    node, arabic: node.getAttribute('aria-label')
  }));

  function updateControlLabels() {
    const english = language === 'en';
    const menuOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    const dark = root.dataset.theme === 'dark';
    menuToggle.setAttribute('aria-label', english ? (menuOpen ? 'Close menu' : 'Open menu') : (menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'));
    themeToggle.setAttribute('aria-label', english ? 'Dark mode' : 'الوضع الداكن');
    themeToggle.setAttribute('aria-pressed', String(dark));
    languageToggle.textContent = english ? 'عربي' : 'EN';
    languageToggle.setAttribute('aria-label', english ? 'التبديل إلى العربية' : 'Switch to English');
  }

  function setLanguage(next) {
    language = next;
    root.lang = language;
    root.dir = language === 'en' ? 'ltr' : 'rtl';
    for (const { node, arabic } of translatedNodes) {
      // Preserve child elements such as the student's class label.
      const textNode = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = language === 'en' ? node.dataset.en : arabic;
    }
    for (const { node, arabic } of translatedLabels) {
      node.setAttribute('aria-label', language === 'en' ? node.dataset.enAria : arabic);
    }
    document.querySelectorAll('[data-number]').forEach(node => {
      node.textContent = language === 'en' ? node.dataset.number : node.dataset.number.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
    });
    const title = language === 'en' ? 'Hader | School attendance & student follow-up' : 'حاضر | إدارة الحضور والانضباط المدرسي';
    const description = language === 'en'
      ? 'Record attendance, organise dismissal, and manage student follow-up, reports and parent communication with Hader.'
      : 'سجّل الحضور، نظّم الانصراف، وتابع الطلاب والتقارير والتواصل مع أولياء الأمور في منصة حاضر.';
    document.title = title;
    document.querySelector('meta[name="description"]').content = description;
    document.querySelector('meta[property="og:title"]').content = title;
    document.querySelector('meta[property="og:description"]').content = description;
    document.getElementById('year').textContent = new Intl.NumberFormat(language === 'en' ? 'en' : 'ar-SA', { useGrouping: false }).format(new Date().getFullYear());
    updateControlLabels();
  }

  function closeMenu(returnFocus = false) {
    nav.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    updateControlLabels();
    if (returnFocus) menuToggle.focus();
  }

  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(open));
    updateControlLabels();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('menu-open')) closeMenu(true);
  });
  document.addEventListener('click', event => {
    if (nav.classList.contains('menu-open') && !nav.contains(event.target)) closeMenu();
  });
  document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => {
    const open = nav.classList.contains('menu-open');
    closeMenu();
    if (open) {
      const destination = document.querySelector(link.hash);
      destination.setAttribute('tabindex', '-1');
      destination.focus({ preventScroll: true });
    }
  }));
  window.matchMedia('(min-width: 901px)').addEventListener('change', () => closeMenu());

  themeToggle.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === 'dark' ? '#102327' : '#f7f9f7';
    savePreference('waki-theme', root.dataset.theme);
    updateControlLabels();
  });
  languageToggle.addEventListener('click', () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
    savePreference('waki-lang', language);
  });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (event.key === 'ArrowRight') next = index + (root.dir === 'rtl' ? -1 : 1);
      if (event.key === 'ArrowLeft') next = index + (root.dir === 'rtl' ? 1 : -1);
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[(next + tabs.length) % tabs.length], true);
    });
  });

  // Retain hash-router, deployment subpath and desktop file:// navigation.
  document.querySelectorAll('[data-app-route]').forEach(link => {
    const route = link.dataset.appRoute;
    link.href = location.protocol === 'file:' && location.pathname.includes('/public/landing/')
      ? `http://localhost:5173/#${route}`
      : new URL(`../index.html#${route}`, location.href).href;
  });

  if ('IntersectionObserver' in window) {
    const links = [...document.querySelectorAll('.nav-links a')];
    const sectionObserver = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (!visible) return;
      links.forEach(link => {
        if (link.hash === `#${visible.target.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-15% 0px -45% 0px', threshold: 0 });
    document.querySelectorAll('main section[id]').forEach(section => sectionObserver.observe(section));
  }

  root.dataset.theme = readPreference('waki-theme') === 'dark' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === 'dark' ? '#102327' : '#f7f9f7';
  setLanguage(language);
  root.classList.add('js-ready');
  [menuToggle, languageToggle, themeToggle].forEach(button => { button.hidden = false; });
})();
