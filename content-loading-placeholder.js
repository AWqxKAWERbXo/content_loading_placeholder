/*!
 * content-loading-placeholder.js
 *
 * Animates a <div> element as a content loading placeholder.
 *
 * Supported data attributes:
 *   data-duration="5"          – animation + minimum wait duration in seconds
 *   data-headline="..."        – headline text shown during loading
 *   data-placeholder="a|b|c|"  – pipe-separated texts cycled during loading
 *   data-content-url="https://..." – URL to fetch real content from
 *   data-content-trusted="true"  – allow fetched content to be injected as HTML
 *                                  (default: fetched content is rendered as plain text)
 *   data-start-event="onload"  – start on window load (default: "viewport")
 *   data-start-event="viewport"– start when element enters the viewport
 *                                (≥100 px or ≥25 % of element height visible)
 *
 * Auto-initialisation targets elements with the [data-clp] attribute to avoid
 * colliding with other libraries that may also use [data-duration].
 *
 * When no data-content-url is given but the element already has HTML content,
 * that content is cached, replaced with the placeholder, and restored after
 * data-duration seconds have elapsed.
 *
 * When data-content-url is given the content is fetched in the background but
 * only revealed once BOTH the minimum duration AND the fetch have completed.
 * By default the response text is treated as plain text. Set data-content-trusted="true"
 * only when the URL is fully trusted and the response is known-safe HTML.
 */
(function (global) {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
   * Constructor
   * ──────────────────────────────────────────────────────────────── */
  function ContentLoadingPlaceholder(el) {
    var durationAttr = el.getAttribute('data-duration');
    var durationSeconds = parseFloat(durationAttr);

    if (!isFinite(durationSeconds)) {
      durationSeconds = 3;
    }

    this.el           = el;
    this.duration     = Math.max(0, durationSeconds) * 1000;
    this.headline     = el.getAttribute('data-headline') || '';
    this.placeholders = parsePipeSeparated(el.getAttribute('data-placeholder') || '');
    this.contentUrl      = (el.getAttribute('data-content-url') || '').trim();
    this.contentTrusted  = el.getAttribute('data-content-trusted') === 'true';
    this.startEvent      = (el.getAttribute('data-start-event') || 'viewport').toLowerCase();

    /* internal state */
    this._started       = false;
    this._startTime     = 0;
    this._rafId         = null;
    this._textTimer     = null;
    this._textIndex     = 0;
    this._cachedContent  = null;
    this._fetchPromise   = null;  // Promise<string> when URL fetch is in flight
    this._observer       = null;

    this._cacheAndBuild();
    this._attachTrigger();
  }

  /* ────────────────────────────────────────────────────────────────
   * Phase 1 – cache existing content and build placeholder UI
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._cacheAndBuild = function () {
    var el = this.el;

    /* Cache existing inner HTML if no URL is given */
    if (!this.contentUrl) {
      var inner = el.innerHTML.trim();
      if (inner) {
        this._cachedContent = inner;
      }
    }

    /* Clear element and inject placeholder markup */
    el.innerHTML = '';
    el.classList.add('clp-container');

    /* Accessibility: signal that the element is busy loading content */
    el.setAttribute('aria-busy', 'true');
    if (this.headline) {
      el.setAttribute('aria-label', this.headline);
    }

    /* Progress bar */
    var progressWrap = document.createElement('div');
    progressWrap.className = 'clp-progress-container';
    this._progressBar = document.createElement('div');
    this._progressBar.className = 'clp-progress-bar';
    progressWrap.appendChild(this._progressBar);
    el.appendChild(progressWrap);

    /* Headline */
    if (this.headline) {
      var h = document.createElement('p');
      h.className = 'clp-headline';
      h.textContent = this.headline;
      el.appendChild(h);
    }

    /* Placeholder text – live region so screen readers announce cycling text */
    if (this.placeholders.length > 0) {
      this._textEl = document.createElement('p');
      this._textEl.className = 'clp-placeholder-text';
      this._textEl.setAttribute('role', 'status');
      this._textEl.setAttribute('aria-live', 'polite');
      this._textEl.setAttribute('aria-atomic', 'true');
      this._textEl.textContent = this.placeholders[0];
      el.appendChild(this._textEl);
    }

    /* Pulsing dots */
    var dots = document.createElement('div');
    dots.className = 'clp-dots';
    for (var i = 0; i < 3; i++) {
      var d = document.createElement('span');
      d.className = 'clp-dot';
      dots.appendChild(d);
    }
    el.appendChild(dots);
  };

  /* ────────────────────────────────────────────────────────────────
   * Phase 2 – attach the start trigger
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._attachTrigger = function () {
    var self = this;

    if (this.startEvent === 'onload') {
      if (document.readyState === 'complete') {
        self._start();
      } else {
        global.addEventListener('load', function onLoad() {
          global.removeEventListener('load', onLoad);
          self._start();
        });
      }
      return;
    }

    /* viewport mode – use IntersectionObserver when available */
    if (typeof IntersectionObserver === 'undefined') {
      /* No IntersectionObserver – fall back to immediate start */
      self._start();
      return;
    }

    /* We want to fire when ≥100 px OR ≥25 % of the element is visible.
     * IntersectionObserver works with ratios, so we build a dense set of
     * thresholds so the callback fires granularly enough for the px check. */
    var thresholds = [];
    for (var t = 0; t <= 100; t++) {
      thresholds.push(t / 100);
    }

    this._observer = new IntersectionObserver(function (entries) {
      var entry = entries[0];
      if (!entry.isIntersecting) return;

      var visiblePx      = entry.intersectionRect.height;
      var visibleRatio   = entry.intersectionRatio;
      var elementHeight  = entry.boundingClientRect.height || 1;
      var pxThreshold    = Math.min(100, elementHeight);       // cap at element height

      if (visiblePx >= pxThreshold || visibleRatio >= 0.25) {
        self._observer.unobserve(self.el);
        self._observer.disconnect();
        self._observer = null;
        self._start();
      }
    }, { threshold: thresholds });

    this._observer.observe(this.el);
  };

  /* ────────────────────────────────────────────────────────────────
   * Phase 3 – start the animation (and optionally fetch content)
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._start = function () {
    if (this._started) return;
    this._started   = true;
    this._startTime = Date.now();

    /* Resume animations that are paused by default (prevents them running
     * before the viewport trigger fires in data-start-event="viewport" mode) */
    this.el.classList.add('clp-active');

    if (this.contentUrl) {
      this._fetch();
    }

    this._animateBar();

    if (this.placeholders.length > 1 && this.duration > 0) {
      this._scheduleCycle();
    }
  };

  /* ────────────────────────────────────────────────────────────────
   * Fetch remote content – stores result as a Promise<{content,asHtml}>
   *
   * By default the response body is treated as plain text to prevent XSS.
   * Set data-content-trusted="true" on the element to allow HTML injection
   * (only for URLs you fully control and whose output is known-safe).
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._fetch = function () {
    var url        = this.contentUrl;
    var asTrusted  = this.contentTrusted;
    /* Error markup is internally generated so it is always safe to inject. */
    var errResult  = { content: '<p class="clp-error-text">Inhalt konnte nicht geladen werden.</p>', asHtml: true };

    if (typeof fetch === 'function') {
      this._fetchPromise = fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) { return { content: text, asHtml: asTrusted }; })
        .catch(function () { return errResult; });
    } else {
      /* XHR fallback wrapped in a Promise */
      this._fetchPromise = new Promise(function (resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 400) {
            resolve({ content: xhr.responseText, asHtml: asTrusted });
          } else {
            resolve(errResult);
          }
        };
        xhr.onerror = function () { resolve(errResult); };
        xhr.send();
      });
    }
  };

  /* ────────────────────────────────────────────────────────────────
   * Progress bar animation (rAF loop, linear over duration)
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._animateBar = function () {
    var self     = this;
    var bar      = this._progressBar;
    var duration = this.duration;

    /* If duration is 0, jump straight to content */
    if (duration <= 0) {
      bar.style.width = '100%';
      this._onDurationElapsed();
      return;
    }

    var tick = function () {
      var elapsed  = Date.now() - self._startTime;
      var progress = Math.min(elapsed / duration, 1);
      bar.style.width = (progress * 100).toFixed(2) + '%';

      if (progress < 1) {
        self._rafId = requestAnimationFrame(tick);
      } else {
        self._rafId = null;
        self._onDurationElapsed();
      }
    };

    this._rafId = requestAnimationFrame(tick);
  };

  /* ────────────────────────────────────────────────────────────────
   * Cycle through placeholder texts
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._scheduleCycle = function () {
    var self     = this;
    var interval = Math.max(600, this.duration / this.placeholders.length);

    this._textTimer = setInterval(function () {
      self._nextText();
    }, interval);
  };

  ContentLoadingPlaceholder.prototype._nextText = function () {
    var self  = this;
    var textEl = this._textEl;
    if (!textEl) return;

    /* Fade out */
    textEl.classList.add('clp-text-out');

    setTimeout(function () {
      if (!self._textEl) return;
      self._textIndex = (self._textIndex + 1) % self.placeholders.length;
      textEl.textContent = self.placeholders[self._textIndex];
      textEl.classList.remove('clp-text-out');
      textEl.classList.add('clp-text-in');
      /* Remove class after animation */
      setTimeout(function () {
        textEl.classList.remove('clp-text-in');
      }, 450);
    }, 350);
  };

  /* ────────────────────────────────────────────────────────────────
   * Called when data-duration has elapsed
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._onDurationElapsed = function () {
    var self = this;

    if (this._textTimer) {
      clearInterval(this._textTimer);
      this._textTimer = null;
    }

    if (this.contentUrl) {
      /* Wait for the fetch Promise to settle, then reveal */
      this._fetchPromise.then(function (result) {
        self._reveal(result.content, result.asHtml);
      });
    } else {
      /* Cached content came from the page's own DOM – safe to inject as HTML */
      this._reveal(this._cachedContent !== null ? this._cachedContent : '', true);
    }
  };

  /* ────────────────────────────────────────────────────────────────
   * Fade out placeholder, inject content, fade content in
   * ──────────────────────────────────────────────────────────────── */
  ContentLoadingPlaceholder.prototype._reveal = function (content, asHtml) {
    var self = this;
    var el   = this.el;

    /* Cancel any lingering rAF */
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    /* Fade-out the placeholder container */
    el.classList.add('clp-hiding');

    setTimeout(function () {
      /* Signal that loading is complete before clearing the container */
      el.setAttribute('aria-busy', 'false');
      el.classList.remove('clp-container', 'clp-active', 'clp-hiding');
      if (asHtml) {
        el.innerHTML = content;
      } else {
        el.textContent = content;
      }
      el.classList.add('clp-content-reveal');

      /* Clean up reveal class after animation */
      setTimeout(function () {
        el.classList.remove('clp-content-reveal');
      }, 600);
    }, 420);
  };

  /* ────────────────────────────────────────────────────────────────
   * Utility
   * ──────────────────────────────────────────────────────────────── */
  function parsePipeSeparated(str) {
    return str
      .split('|')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /* ────────────────────────────────────────────────────────────────
   * Auto-initialise elements that carry the [data-clp] opt-in marker.
   * Using a dedicated attribute avoids clashing with other libraries
   * that may also use [data-duration] on arbitrary elements.
   * ──────────────────────────────────────────────────────────────── */
  function autoInit() {
    var els = document.querySelectorAll('[data-clp]');
    for (var i = 0; i < els.length; i++) {
      new ContentLoadingPlaceholder(els[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  /* Expose constructor for manual use */
  global.ContentLoadingPlaceholder = ContentLoadingPlaceholder;

}(window));
