/* The film and the interactive still share one frame, without moving map targets. */
(() => {
  'use strict';

  const section = document.getElementById('campus');
  if (!section) return;

  const root = document.documentElement;
  const media = document.getElementById('campusMedia');
  const video = document.getElementById('campusVideo');
  const points = document.getElementById('campusPoints');
  const playButton = document.getElementById('campusPlay');
  const playLabel = document.getElementById('campusPlayLabel');
  const message = document.getElementById('campusMediaMessage');
  const targets = [...section.querySelectorAll('[data-campus-target]')];
  const details = [...section.querySelectorAll('[data-campus-detail]')];
  const sources = ['webm', 'mp4'].map(format => {
    const source = document.createElement('source');
    source.type = `video/${format}`;
    source.dataset.src = video.dataset[format];
    return source;
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const constrainedConnection = () => Boolean(connection && (
    connection.saveData || ['slow-2g', '2g', '3g'].includes(connection.effectiveType)
  ));

  let motionRequested = !reducedMotion.matches && !constrainedConnection();
  let inView = false;
  let sourcesLoaded = false;
  let failed = false;
  let loading = false;
  let attempt = 0;
  let watchdog;
  let manualPreference = false;
  let activeStage = 'attendance';

  const shouldPlay = () => motionRequested && inView && !document.hidden;
  function render() {
    const english = root.lang === 'en';
    const playing = !video.paused && !failed && !loading;
    playButton.setAttribute('aria-pressed', String(playing || loading));
    playButton.setAttribute('aria-busy', String(loading));
    playButton.dataset.state = playing || loading ? 'active' : 'idle';
    playLabel.textContent = loading
      ? (english ? 'Cancel loading' : 'إلغاء التحميل')
      : playing
        ? (english ? 'Pause motion' : 'إيقاف الحركة')
        : failed
          ? (english ? 'Retry video' : 'إعادة تشغيل المشهد')
          : (english ? 'Play scene' : 'تشغيل المشهد');
    message.hidden = !failed;
    message.textContent = failed
      ? (english ? 'Video unavailable. Explore the image or retry.' : 'تعذّر تشغيل الفيديو. استكشف الصورة أو أعد المحاولة.')
      : '';
    const poster = section.querySelector('.campus-poster');
    poster.alt = english ? poster.dataset.enAlt : 'تصوّر لمدرسة تضم بوابة حضور وفصلًا دراسيًا ومكتب متابعة ومنطقة انصراف';
  }

  function showStill() {
    media.classList.remove('is-playing');
    points.hidden = false;
  }

  function stop() {
    attempt++;
    clearTimeout(watchdog);
    loading = false;
    video.pause();
    showStill();
    render();
  }

  function fail() {
    failed = true;
    motionRequested = false;
    stop();
  }

  function loadSources() {
    if (sourcesLoaded) return;
    sources.forEach(source => { source.src = source.dataset.src; });
    video.append(...sources);
    video.muted = true;
    sourcesLoaded = true;
    video.load();
  }

  function syncPlayback() {
    if (!shouldPlay()) { stop(); return; }
    if (loading || !video.paused) return;
    failed = false;
    loading = true;
    const currentAttempt = ++attempt;
    loadSources();
    render();
    watchdog = setTimeout(() => {
      if (currentAttempt === attempt && loading) fail();
    }, 10000);
    const promise = video.play();
    if (promise) promise.catch(error => {
      if (currentAttempt !== attempt) return;
      // An autoplay restriction is recoverable with the visible play button.
      if (error.name === 'NotAllowedError') {
        motionRequested = false;
        stop();
      } else if (error.name !== 'AbortError') {
        fail();
      }
    });
  }

  video.addEventListener('playing', () => {
    if (!shouldPlay()) { stop(); return; }
    clearTimeout(watchdog);
    loading = false;
    failed = false;
    media.classList.add('is-playing');
    // Focused controls must never disappear underneath keyboard users.
    if (points.contains(document.activeElement)) playButton.focus();
    points.hidden = true;
    render();
  });
  video.addEventListener('pause', () => {
    showStill();
    render();
  });
  video.addEventListener('error', () => {
    if (sourcesLoaded && motionRequested) fail();
  });
  // Some browsers report failed <source> elements without a video error.
  sources[sources.length - 1].addEventListener('error', () => {
    if (sourcesLoaded && motionRequested) fail();
  });

  function selectStage(stage) {
    activeStage = stage;
    targets.forEach(target => {
      target.setAttribute('aria-pressed', String(target.dataset.campusTarget === activeStage));
    });
    details.forEach(detail => { detail.hidden = detail.dataset.campusDetail !== activeStage; });
  }
  targets.forEach(target => {
    target.disabled = false;
    target.addEventListener('click', () => {
      manualPreference = true;
      motionRequested = false;
      failed = false;
      stop();
      selectStage(target.dataset.campusTarget);
    });
  });
  points.addEventListener('focusin', () => {
    manualPreference = true;
    motionRequested = false;
    stop();
  });

  playButton.addEventListener('click', () => {
    manualPreference = true;
    if (loading || !video.paused) {
      motionRequested = false;
      stop();
    } else {
      if (failed) {
        sourcesLoaded = false;
        sources.forEach(source => source.removeAttribute('src'));
      }
      motionRequested = true;
      syncPlayback();
    }
  });

  function respectPreferences() {
    if (reducedMotion.matches || constrainedConnection()) {
      motionRequested = false;
    } else if (!manualPreference) {
      motionRequested = true;
    }
    syncPlayback();
  }
  reducedMotion.addEventListener('change', respectPreferences);
  connection?.addEventListener('change', respectPreferences);
  document.addEventListener('visibilitychange', syncPlayback);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', syncPlayback);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.2;
      syncPlayback();
    }, { threshold: [0, 0.2] });
    observer.observe(media);
  } else {
    // A manual play button remains available on browsers without observation.
    inView = true;
    motionRequested = false;
  }

  new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ['lang'] });
  selectStage(activeStage);
  points.hidden = false;
  playButton.hidden = false;
  render();
})();
