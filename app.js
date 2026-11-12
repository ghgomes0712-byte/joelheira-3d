/* FLEX PRO — configuração e interações do site.
   EDITE AQUI: preço, parcelas, WhatsApp, link de compra e cores. */
(function () {
  'use strict';

  var FLEXPRO = window.FLEXPRO = {
    config: {
      price: 'R$ 149,90',              // preço exibido no site
      oldPrice: 'R$ 199,90',           // deixe vazio para esconder
      installments: '3x de R$ 49,97 sem juros',
      whatsappNumber: '5500000000000', // troque pelo número real (só dígitos)
      checkoutUrl: '',                 // cole o link de compra; vazio = WhatsApp
      defaultColor: 'verde',
      buyMessage: 'Olá! Quero comprar a joelheira Flex Pro.',
      supportMessage: 'Olá! Tenho uma dúvida sobre a joelheira Flex Pro.'
    },
    colors: [
      { id: 'verde', name: 'Verde neon', hex: '#4be014' },
      { id: 'azul', name: 'Azul performance', hex: '#2f7df6' },
      { id: 'laranja', name: 'Laranja impacto', hex: '#ff7a1a' },
      { id: 'vermelho', name: 'Vermelho força', hex: '#e53b3b' }
    ],
    state: { colorId: 'verde' },
    toast: function () {}
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var root = document.documentElement;
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  root.classList.add('js');

  function colorById(id) {
    var list = FLEXPRO.colors;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return list[0];
  }

  function waLink(message) {
    return 'https://wa.me/' + FLEXPRO.config.whatsappNumber +
      '?text=' + encodeURIComponent(message);
  }

  var toastEl = document.getElementById('toast');
  var toastTimer = 0;
  FLEXPRO.toast = function (message, ms) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, ms || 3400);
  };

  /* ===== Cabeçalho e menu ===== */
  function initHeader() {
    var header = document.getElementById('siteHeader');
    if (!header) return;
    var update = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  function initMenu() {
    var btn = document.getElementById('menuBtn');
    var nav = document.getElementById('mobileNav');
    if (!btn || !nav) return;

    function setOpen(open) {
      btn.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      nav.setAttribute('aria-hidden', String(!open));
    }

    btn.addEventListener('click', function () {
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1040) setOpen(false);
    });
  }

  /* ===== Revelações no scroll ===== */
  function initReveals() {
    var items = $$('.reveal');
    if (!items.length) return;
    var reduced = motionQuery && motionQuery.matches;
    if (!('IntersectionObserver' in window) || reduced) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ===== Imagens e placeholders ===== */
  function initImages() {
    $$('.media img').forEach(function (img) {
      var box = img.closest('.media');
      if (!box) return;
      var mark = function () { box.classList.add('is-ready'); };
      if (img.complete && img.naturalWidth) mark();
      else {
        img.addEventListener('load', mark, { once: true });
        img.addEventListener('error', mark, { once: true });
      }
    });
  }

  /* ===== Preço e links ===== */
  function renderPrice() {
    var config = FLEXPRO.config;
    $$('[data-price]').forEach(function (el) { el.textContent = config.price; });
    $$('[data-installments]').forEach(function (el) { el.textContent = config.installments; });
    $$('[data-old-price]').forEach(function (el) {
      el.textContent = config.oldPrice;
      el.hidden = !config.oldPrice;
    });
  }

  function renderSupportLinks() {
    $$('[data-whatsapp]').forEach(function (link) {
      link.href = waLink(FLEXPRO.config.supportMessage);
      link.target = '_blank';
      link.rel = 'noopener';
    });
  }

  function updateBuyLinks() {
    var color = colorById(FLEXPRO.state.colorId);
    var checkout = FLEXPRO.config.checkoutUrl;
    $$('[data-buy]').forEach(function (link) {
      link.href = checkout || waLink(FLEXPRO.config.buyMessage + ' Cor: ' + color.name + '.');
      link.target = '_blank';
      link.rel = 'noopener';
    });
  }

  /* ===== Cores e recoloração das fotos ===== */
  var recolorCache = new Map();
  var baseImages = new Map();

  function hexToHsl(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = ((n >> 16) & 255) / 255;
    var g = ((n >> 8) & 255) / 255;
    var b = (n & 255) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      var v = Math.round(l * 255);
      return [v, v, v];
    }
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
  }

  function getBaseImage(src) {
    if (!baseImages.has(src)) {
      var image = new Image();
      image.decoding = 'async';
      image.src = src;
      baseImages.set(src, image);
    }
    return baseImages.get(src);
  }

  function recolorImages(color) {
    $$('img[data-recolor]').forEach(function (img) {
      var original = img.dataset.base || img.getAttribute('src');
      if (!original) return;
      if (!img.dataset.base) img.dataset.base = original;

      var token = color.id + '|' + original;
      if (img.dataset.want === token) return;
      img.dataset.want = token;

      if (color.id === 'verde') {
        if (img.getAttribute('src') !== original) img.src = original;
        return;
      }

      var cached = recolorCache.get(token);
      if (cached) {
        img.src = cached;
        return;
      }

      var base = getBaseImage(original);
      var run = function () {
        if (img.dataset.want !== token) return;
        try {
          var w = base.naturalWidth;
          var h = base.naturalHeight;
          if (!w || !h) return;
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(base, 0, 0, w, h);
          var data;
          try {
            data = ctx.getImageData(0, 0, w, h);
          } catch (err) {
            return; // file:// ou canvas bloqueado: mantém a foto original
          }
          var pixels = data.data;
          var targetHue = hexToHsl(color.hex)[0];
          for (var i = 0; i < pixels.length; i += 4) {
            var r = pixels[i];
            var g = pixels[i + 1];
            var b = pixels[i + 2];
            if (pixels[i + 3] < 20) continue;
            var min = Math.min(r, g, b);
            var isAccent = g > r * 1.06 && g > b * 1.06 && g - min > 16 && g > 45;
            if (!isAccent) continue;
            var hsl = rgbToHsl(r, g, b);
            var rgb = hslToRgb(targetHue, Math.min(1, hsl[1] * 1.05 + 0.03), hsl[2]);
            pixels[i] = rgb[0];
            pixels[i + 1] = rgb[1];
            pixels[i + 2] = rgb[2];
          }
          ctx.putImageData(data, 0, 0);
          var url = canvas.toDataURL('image/png');
          recolorCache.set(token, url);
          if (img.dataset.want === token) img.src = url;
        } catch (err) {
          /* mantém a imagem original em caso de falha */
        }
      };

      if (base.complete && base.naturalWidth) run();
      else base.addEventListener('load', run, { once: true });
    });
  }

  function renderSwatches() {
    $$('[data-swatches]').forEach(function (box) {
      box.innerHTML = '';
      FLEXPRO.colors.forEach(function (color) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch';
        btn.dataset.color = color.id;
        btn.style.setProperty('--sw', color.hex);
        btn.setAttribute('aria-label', 'Selecionar cor ' + color.name);
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML =
          '<span class="swatch-dot" aria-hidden="true"></span>' +
          '<span class="swatch-name">' + color.name + '</span>';
        box.appendChild(btn);
      });
      box.addEventListener('click', function (event) {
        var btn = event.target.closest('.swatch');
        if (btn) applyColor(btn.dataset.color);
      });
    });
  }

  function applyColor(id) {
    var color = colorById(id);
    FLEXPRO.state.colorId = color.id;
    root.dataset.color = color.id;

    $$('[data-color-name]').forEach(function (el) {
      el.textContent = color.name;
    });
    $$('.swatch').forEach(function (btn) {
      var active = btn.dataset.color === color.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    updateBuyLinks();
    recolorImages(color);

    window.dispatchEvent(new CustomEvent('flexpro:color', {
      detail: { id: color.id, name: color.name, hex: color.hex }
    }));
  }

  function initColors() {
    FLEXPRO.state.colorId = FLEXPRO.config.defaultColor || 'verde';
    renderSwatches();
    applyColor(FLEXPRO.state.colorId);
  }
  /* ===== Lightbox da galeria ===== */
  function initLightbox() {
    var box = document.getElementById('lightbox');
    var img = document.getElementById('lbImg');
    var caption = document.getElementById('lbCaption');
    var btnClose = document.getElementById('lbClose');
    var btnPrev = document.getElementById('lbPrev');
    var btnNext = document.getElementById('lbNext');
    if (!box || !img || !btnClose) return;

    var items = [];
    var index = 0;
    var lastFocus = null;
    var isOpen = false;
    var page = document.getElementById('page');

    function collect() {
      items = $$('[data-lightbox]').filter(function (btn) { return !btn.hidden; });
    }

    function show(i) {
      if (!items.length) return;
      index = (i + items.length) % items.length;
      var btn = items[index];
      var source = btn.querySelector('img');
      var full = btn.dataset.full || (source && (source.currentSrc || source.src));
      if (source) {
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '';
      }
      caption.textContent = btn.dataset.caption || (source && source.alt) || '';
    }

    function open(btn) {
      collect();
      var i = items.indexOf(btn);
      lastFocus = document.activeElement;
      show(i < 0 ? 0 : i);
      isOpen = true;
      box.classList.add('is-open');
      box.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      if (page) page.setAttribute('inert', '');
      btnClose.focus();
    }

    function close() {
      isOpen = false;
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      if (!document.querySelector('.viewer.is-open')) {
        document.body.classList.remove('no-scroll');
      }
      if (page) page.removeAttribute('inert');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-lightbox]');
      if (trigger) {
        event.preventDefault();
        open(trigger);
      }
    });

    btnClose.addEventListener('click', close);
    btnPrev.addEventListener('click', function () { show(index - 1); });
    btnNext.addEventListener('click', function () { show(index + 1); });
    box.addEventListener('click', function (event) {
      if (event.target === box) close();
    });

    document.addEventListener('keydown', function (event) {
      if (!isOpen) return;
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowLeft') show(index - 1);
      else if (event.key === 'ArrowRight') show(index + 1);
      else if (event.key === 'Tab') {
        var focusables = $$('button, [href], input, [tabindex]:not([tabindex="-1"])', box)
          .filter(function (el) { return !el.hidden; });
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* ===== Abertura do 3D ===== */
  function initViewerTriggers() {
    $$('[data-open-viewer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.dispatchEvent(new CustomEvent('flexpro:open-viewer'));
      });
    });
  }

  /* ===== Ano do rodapé ===== */
  function renderYear() {
    var year = String(new Date().getFullYear());
    $$('[data-year]').forEach(function (el) { el.textContent = year; });
  }

  /* ===== Inicialização ===== */
  initHeader();
  initMenu();
  initReveals();
  initImages();
  renderPrice();
  renderYear();
  renderSupportLinks();
  initColors();
  initViewerTriggers();
  initLightbox();
})();
