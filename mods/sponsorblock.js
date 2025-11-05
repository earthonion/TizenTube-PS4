// --- Imports ----------------------------------------------------
import { configRead } from './config.js';
import { showToast } from './ui/ytUI.js';

// --- SponsorBlock Local Loader ----------------------------------
/**
 * Scan localhost ports [startPort..endPort] for SponsorBlock proxy and fetch segments for a video.
 * Returns a Promise that resolves to an array of segments (possibly empty).
 */
function loadSponsorBlock(videoId, startPort = 4040, endPort = 4050, timeoutMs = 2000) {
  if (!videoId) return Promise.resolve([]);

  return new Promise((resolve) => {
    let port = startPort;

    function tryNext() {
      if (port > endPort) {
        resolve([]);
        return;
      }

      try {
        const xhr = new XMLHttpRequest();
        const url = 'http://127.0.0.1:' + port + '/' + encodeURIComponent(videoId);
        xhr.timeout = timeoutMs;

        xhr.onload = function () {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (Array.isArray(data) && data.length > 0) {
                try { showToast('SponsorBlock', data.length + ' segment(s) found'); } catch (e) {}
                resolve(data);
                return;
              }
            } catch (e) {
              /* fall through to next port */
            }
          }
          port++;
          tryNext();
        };

        xhr.onerror = function () {
          port++;
          tryNext();
        };
        xhr.ontimeout = function () {
          port++;
          tryNext();
        };

        xhr.open('GET', url, true);
        xhr.send();
      } catch (e) {
        port++;
        tryNext();
      }
    }

    tryNext();
  });
}

// --- Segment Bar Types ------------------------------------------
const barTypes = {
  sponsor:        { color: '#00d400', opacity: '0.7', name: 'sponsored segment' },
  intro:          { color: '#00ffff', opacity: '0.7', name: 'intro' },
  outro:          { color: '#0202ed', opacity: '0.7', name: 'outro' },
  interaction:    { color: '#cc00ff', opacity: '0.7', name: 'interaction reminder' },
  selfpromo:      { color: '#ffff00', opacity: '0.7', name: 'self-promotion' },
  preview:        { color: '#008fd6', opacity: '0.7', name: 'recap or preview' },
  filler:         { color: '#7300FF', opacity: '0.9', name: 'tangents' },
  music_offtopic: { color: '#ff9900', opacity: '0.7', name: 'non-music part' }
};

// --- SponsorBlockHandler ----------------------------------------
function SponsorBlockHandler(videoID) {
  this.videoID = videoID;
  this.video = null;
  this.active = true;

  this.attachVideoTimeout = null;
  this.nextSkipTimeout = null;
  this.sliderInterval = null;

  this.observer = null;
  this.scheduleSkipHandler = null;
  this.durationChangeHandler = null;
  this.segments = null;
  this.skippableCategories = [];
  this.manualSkippableCategories = [];
}

SponsorBlockHandler.prototype.init = async function () {
  const results = await loadSponsorBlock(this.videoID);
  console.info(this.videoID, 'Got segments:', results);

  if (!results || !results.length) {
    console.info(this.videoID, 'No segments found.');
    return;
  }

  this.segments = results;
  try {
    this.manualSkippableCategories = configRead('sponsorBlockManualSkips') || [];
  } catch (e) {
    this.manualSkippableCategories = [];
  }
  this.skippableCategories = this.getSkippableCategories();

  this.scheduleSkipHandler = () => this.scheduleSkip();
  this.durationChangeHandler = () => this.buildOverlay();

  this.attachVideo();
  this.buildOverlay();
};

SponsorBlockHandler.prototype.getSkippableCategories = function () {
  const out = [];
  try { if (configRead('enableSponsorBlockSponsor')) out.push('sponsor'); } catch (e) {}
  try { if (configRead('enableSponsorBlockIntro')) out.push('intro'); } catch (e) {}
  try { if (configRead('enableSponsorBlockOutro')) out.push('outro'); } catch (e) {}
  try { if (configRead('enableSponsorBlockInteraction')) out.push('interaction'); } catch (e) {}
  try { if (configRead('enableSponsorBlockSelfPromo')) out.push('selfpromo'); } catch (e) {}
  try { if (configRead('enableSponsorBlockPreview')) out.push('preview'); } catch (e) {}
  try { if (configRead('enableSponsorBlockFiller')) out.push('filler'); } catch (e) {}
  try { if (configRead('enableSponsorBlockMusicOfftopic')) out.push('music_offtopic'); } catch (e) {}
  return out;
};

SponsorBlockHandler.prototype.attachVideo = function () {
  clearTimeout(this.attachVideoTimeout);
  this.attachVideoTimeout = null;

  this.video = document.querySelector('video');
  if (!this.video) {
    console.info(this.videoID, 'No video yet...');
    this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
    return;
  }

  console.info(this.videoID, 'Video found, binding...');
  this.video.addEventListener('play', this.scheduleSkipHandler);
  this.video.addEventListener('pause', this.scheduleSkipHandler);
  this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
  this.video.addEventListener('durationchange', this.durationChangeHandler);
};

SponsorBlockHandler.prototype.buildOverlay = function () {
  if (this.segmentsoverlay) return;
  if (!this.video || !this.video.duration) return;

  const videoDuration = this.video.duration;

  this.segmentsoverlay = document.createElement('div');
  this.segmentsoverlay.classList.add('ytLrProgressBarHost', 'ytLrProgressBarFocused', 'ytLrWatchDefaultProgressBar');

  const sliderElement = document.createElement('div');
  sliderElement.style.setProperty('background-color', 'rgb(0, 0, 0, 0)');
  sliderElement.style.setProperty('bottom', 'auto', 'important');
  sliderElement.style.setProperty('height', '0.25rem', 'important');
  sliderElement.style.setProperty('overflow', 'hidden', 'important');
  sliderElement.style.setProperty('position', 'absolute', 'important');
  sliderElement.style.setProperty('top', '1.625rem', 'important');
  sliderElement.style.setProperty('width', '100%', 'important');
  this.segmentsoverlay.appendChild(sliderElement);

  for (let i = 0; i < this.segments.length; i++) {
    const segment = this.segments[i];
    const start = segment.segment[0];
    const end = segment.segment[1];
    const bt = barTypes[segment.category] || { color: 'blue', opacity: 0.7 };
    const transform = 'translateX(' + ((start / videoDuration) * 100.0) + '%) scaleX(' + ((end - start) / videoDuration) + ')';

    const elm = document.createElement('div');
    elm.style.setProperty('background', bt.color, 'important');
    elm.style.setProperty('opacity', bt.opacity, 'important');
    elm.style.setProperty('transform', transform, 'important');
    elm.style.setProperty('height', '100%');
    elm.style.setProperty('pointer-events', 'none');
    elm.style.setProperty('position', 'absolute');
    elm.style.setProperty('transform-origin', 'left');
    elm.style.setProperty('width', '100%');

    sliderElement.appendChild(elm);
  }

  const self = this;
  this.observer = new MutationObserver(function (mutations) {
    for (let mi = 0; mi < mutations.length; mi++) {
      const m = mutations[mi];
      if (m.removedNodes) {
        for (let ni = 0; ni < m.removedNodes.length; ni++) {
          const node = m.removedNodes[ni];
          if (node === self.segmentsoverlay) {
            console.info('bringing back segments overlay');
            if (self.slider) self.slider.appendChild(self.segmentsoverlay);
          }
        }
      }

      const bar = document.querySelector('ytlr-progress-bar');
      if (bar && bar.getAttribute('hybridnavfocusable') === 'false') {
        self.segmentsoverlay.classList.remove('ytLrProgressBarFocused');
      } else {
        self.segmentsoverlay.classList.add('ytLrProgressBarFocused');
      }
    }
  });

  this.sliderInterval = setInterval(() => {
    this.slider = document.querySelector('ytlr-redux-connect-ytlr-progress-bar');
    if (this.slider) {
      clearInterval(this.sliderInterval);
      this.sliderInterval = null;
      this.observer.observe(this.slider, { childList: true, subtree: true });
      this.slider.appendChild(this.segmentsoverlay);
    }
  }, 500);
};

SponsorBlockHandler.prototype.scheduleSkip = function () {
  clearTimeout(this.nextSkipTimeout);
  this.nextSkipTimeout = null;

  if (!this.active) return;
  if (!this.video || this.video.paused) return;

  const now = this.video.currentTime;
  const nextSegments = this.segments
    .filter(function (seg) {
      return seg.segment[0] > now - 0.3 && seg.segment[1] > now - 0.3;
    })
    .sort(function (a, b) {
      return a.segment[0] - b.segment[0];
    });

  if (!nextSegments.length) return;

  const segment = nextSegments[0];
  const start = segment.segment[0];
  const end = segment.segment[1];

  const delayMs = Math.max(0, (start - this.video.currentTime) * 1000);
  this.nextSkipTimeout = setTimeout(() => {
    if (this.video.paused) return;
    if (this.skippableCategories.indexOf(segment.category) === -1) return;

    const bt = barTypes[segment.category];
    const skipName = (bt && bt.name) ? bt.name : segment.category;

    if (this.manualSkippableCategories.indexOf(segment.category) === -1) {
      try { showToast('SponsorBlock', 'Skipping ' + skipName); } catch (e) {}
      this.video.currentTime = end + 0.1;
      this.scheduleSkip();
    }
  }, delayMs);
};

SponsorBlockHandler.prototype.destroy = function () {
  console.info(this.videoID, 'Destroying');

  this.active = false;

  if (this.nextSkipTimeout) {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;
  }
  if (this.attachVideoTimeout) {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;
  }
  if (this.sliderInterval) {
    clearInterval(this.sliderInterval);
    this.sliderInterval = null;
  }
  if (this.observer) {
    this.observer.disconnect();
    this.observer = null;
  }
  if (this.segmentsoverlay) {
    this.segmentsoverlay.remove();
    this.segmentsoverlay = null;
  }

  if (this.video) {
    this.video.removeEventListener('play', this.scheduleSkipHandler);
    this.video.removeEventListener('pause', this.scheduleSkipHandler);
    this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.removeEventListener('durationchange', this.durationChangeHandler);
  }
};

// --- Global Event Hook ------------------------------------------
if (!window.sponsorblock) window.sponsorblock = null;

window.addEventListener('hashchange', function () {
  const newURL = new URL(location.hash.substring(1), location.href);
  const videoID = newURL.search.replace('?v=', '').split('&')[0];
  const needsReload = videoID && (!window.sponsorblock || window.sponsorblock.videoID !== videoID);

  if (needsReload) {
    if (window.sponsorblock) {
      try { window.sponsorblock.destroy(); } catch (err) { console.warn('window.sponsorblock.destroy() failed!', err); }
      window.sponsorblock = null;
    }

    let enabled = true;
    try { enabled = !!configRead('enableSponsorBlock'); } catch (e) { enabled = true; }

    if (enabled) {
      window.sponsorblock = new SponsorBlockHandler(videoID);
      window.sponsorblock.init();
    } else {
      console.info('SponsorBlock disabled, not loading');
    }
  }
}, false);
