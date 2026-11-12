/* NEXUS STORE — visualizador 3D e animação do joelho.
   O modelo, as texturas e a perna são gerados em tempo real com Three.js. */
(function () {
  'use strict';

  var stage = document.getElementById('viewerStage');
  var modal = document.getElementById('viewer');
  if (!stage || !modal) return;

  var closeBtn = document.getElementById('viewerClose');
  var resetViewBtn = document.getElementById('viewerResetView');
  var playBtn = document.getElementById('playBtn');
  var playLabel = playBtn ? playBtn.querySelector('.play-label') : null;
  var kneeResetBtn = document.getElementById('kneeReset');
  var angleRange = document.getElementById('angleRange');
  var angleText = document.getElementById('angleText');
  var loader = document.getElementById('viewerLoader');
  var page = document.getElementById('page');

  var FLEX = window.FLEXPRO || {};
  var colors = FLEX.colors || [{ id: 'verde', name: 'Verde neon', hex: '#4be014' }];
  var state = FLEX.state || { colorId: 'verde' };

  function activeColor() {
    for (var i = 0; i < colors.length; i++) {
      if (colors[i].id === state.colorId) return colors[i];
    }
    return colors[0];
  }

  var accent = activeColor().hex;
  var KNEE_Y = 0.934;
  var SLEEVE_SCALE = 0.55;
  var SLEEVE_KNEE_LOCAL = 0.8;
  var LEG_SCALE = 0.4;
  var LEG_SLIM = 0.57;
  var THREE, OrbitControls, RoomEnvironment, GLTFLoader, RoundedBoxGeometry;
  var renderer, scene, camera, photoCamera, controls;
  var sleeveGroup, legGroup, legKneePivot, ground, contact;
  var legAccentMaterials = [];
  var baseMat, trimMat, rimMat, heatherTex, trimTex;
  var sleeveDepthMat = null;
  var bendUniforms = {
    uKneeAngle: { value: 0 },
    uKneeY: { value: KNEE_Y },
    uBendHalf: { value: 0.16 }
  };
  var MAX_ANISO = 1;
  var ready = false;
  var initPromise = null;
  var isOpen = false;
  var playing = false;
  var angle = 0;
  var animPhase = 0;
  var lastTime = 0;
  var lastFocus = null;
  var captureTimer = 0;

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var smoothstep = function (a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function toast(message) {
    if (FLEX.toast) FLEX.toast(message);
  }

  /* ===== Abrir e fechar ===== */
  function openViewer() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    if (page) page.setAttribute('inert', '');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
    stopPlay();
    setAngle(0);
    resetCamera();
    ensureInit();
    resizeViewer();
  }

  function closeViewer() {
    if (!isOpen) return;
    isOpen = false;
    stopPlay();
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.lightbox.is-open')) {
      document.body.classList.remove('no-scroll');
    }
    if (page) page.removeAttribute('inert');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  window.addEventListener('flexpro:open-viewer', openViewer);
  if (closeBtn) closeBtn.addEventListener('click', closeViewer);
  modal.addEventListener('click', function (event) {
    if (event.target === modal) closeViewer();
  });
  document.addEventListener('keydown', function (event) {
    if (!isOpen) return;
    if (event.key === 'Escape') closeViewer();
    if (event.key === 'Tab') {
      var focusables = Array.prototype.slice.call(
        modal.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
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

  window.addEventListener('flexpro:color', function (event) {
    if (!event.detail || !event.detail.hex) return;
    accent = event.detail.hex;
    if (ready) {
      refreshAccent();
      scheduleCaptures(120);
    }
  });
  /* ===== Dependências (CDN) ===== */
  function ensureInit() {
    if (initPromise) return initPromise;
    if (loader) {
      loader.classList.remove('is-hidden');
      loader.innerHTML = '<div><span class="ring"></span><p>Carregando modelo 3D…</p></div>';
    }
    initPromise = Promise.all([
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js')
    ]).then(function (mods) {
      THREE = mods[0];
      OrbitControls = mods[1].OrbitControls;
      RoomEnvironment = mods[2].RoomEnvironment;
      GLTFLoader = mods[3].GLTFLoader;
      RoundedBoxGeometry = mods[4].RoundedBoxGeometry;
      return buildScene();
    }).catch(function (error) {
      console.warn('Falha ao carregar o 3D:', error);
      if (loader) {
        loader.innerHTML = '<div><p>Não foi possível carregar o modelo 3D.<br>Verifique sua conexão e recarregue a página.</p></div>';
      }
      toast('Não foi possível carregar o modelo 3D.');
    });
    return initPromise;
  }

  /* ===== Câmera e controles ===== */
  function resizeViewer() {
    if (!renderer || !camera) return;
    var w = stage.clientWidth || 800;
    var h = stage.clientHeight || 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function resetCamera() {
    if (!camera || !controls) return;
    var aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    var portrait = aspect < 0.9;
    var distance = portrait ? 4.35 : 3.55;
    var targetY = KNEE_Y - 0.04;
    controls.target.set(0, targetY, 0);
    var phi = 1.32;
    var theta = 0.82;
    camera.position.set(
      distance * Math.sin(phi) * Math.sin(theta),
      targetY + distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(controls.target);
    controls.update();
    if (isOpen && renderer) renderer.render(scene, camera);
  }

  /* ===== Ângulo do joelho ===== */
  function applyKneePose(deg) {
    var rad = THREE ? THREE.MathUtils.degToRad(deg) : deg * Math.PI / 180;
    bendUniforms.uKneeAngle.value = rad;
    if (legKneePivot) legKneePivot.rotation.x = rad;
  }

  function setAngle(deg, syncSlider) {
    angle = clamp(deg, 0, 120);
    applyKneePose(angle);
    if (angleText) angleText.textContent = 'Joelho a ' + Math.round(angle) + '°';
    if (angleRange) {
      if (syncSlider !== false) angleRange.value = String(Math.round(angle));
      angleRange.style.setProperty('--fill', (angle / 120 * 100) + '%');
      angleRange.setAttribute('aria-valuetext', Math.round(angle) + ' graus');
    }
  }

  function setPlayingUI() {
    if (!playBtn) return;
    playBtn.classList.toggle('is-playing', playing);
    playBtn.setAttribute('aria-pressed', String(playing));
    if (playLabel) playLabel.textContent = playing ? 'Pausar' : 'Reproduzir';
    playBtn.setAttribute('aria-label', playing ? 'Pausar animação do joelho' : 'Reproduzir animação do joelho');
  }

  function stopPlay() {
    playing = false;
    setPlayingUI();
  }

  function togglePlay() {
    if (!ready) {
      toast('O modelo 3D ainda está carregando.');
      return;
    }
    playing = !playing;
    if (playing) {
      var phase = Math.acos(clamp((60 - angle) / 60, -1, 1));
      if (angle > 119.5) phase = Math.PI;
      animPhase = phase;
    }
    setPlayingUI();
  }

  if (resetViewBtn) resetViewBtn.addEventListener('click', resetCamera);
  if (playBtn) playBtn.addEventListener('click', togglePlay);
  if (kneeResetBtn) {
    kneeResetBtn.addEventListener('click', function () {
      stopPlay();
      animPhase = 0;
      setAngle(0);
    });
  }
  if (angleRange) {
    angleRange.addEventListener('input', function () {
      stopPlay();
      setAngle(parseFloat(angleRange.value), false);
    });
  }
  window.addEventListener('resize', function () {
    if (isOpen) resizeViewer();
  });

  /* ===== Capturas da galeria ===== */
  function scheduleCaptures(delay) {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(function () {
      if (ready) captureViews();
    }, delay || 200);
  }
  /* ===== Cena ===== */
  async function buildScene() {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(stage.clientWidth || 800, stage.clientHeight || 600, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    stage.appendChild(renderer.domElement);
    MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

    scene = new THREE.Scene();
    scene.background = null;
    camera = new THREE.PerspectiveCamera(32, (stage.clientWidth || 800) / (stage.clientHeight || 600), 0.1, 60);
    photoCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xf2fff0, 0x1c2a20, 0.55));

    var key = new THREE.DirectionalLight(0xfffbf0, 2.4);
    key.position.set(2.2, 4.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.8;
    key.shadow.camera.right = 2.8;
    key.shadow.camera.top = 3.4;
    key.shadow.camera.bottom = -1.4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xdff0e6, 0.8);
    fill.position.set(-3.4, 1.8, 2.2);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xf6ffe8, 1.3);
    rim.position.set(0.6, 3.2, -4.4);
    scene.add(rim);

    var rim2 = new THREE.DirectionalLight(0xffffff, 0.65);
    rim2.position.set(3.8, 1.4, -1.8);
    scene.add(rim2);

    ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.ShadowMaterial({ color: 0x020402, opacity: 0.24 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    makeMaterials();

    await loadLeg();
    bendUniforms.uKneeY.value = KNEE_Y;

    buildSleeve();
    buildContactShadow();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 7.5;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controls.autoRotate = false;
    controls.target.set(0, KNEE_Y, 0);
    resetCamera();

    setAngle(0);
    setPlayingUI();
    ready = true;
    if (loader) loader.classList.add('is-hidden');
    resizeViewer();
    renderer.render(scene, camera);
    renderer.setAnimationLoop(renderLoop);
    scheduleCaptures(400);
  }

  function renderLoop(time) {
    if (!ready) return;
    var dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 0;
    lastTime = time;
    if (isOpen) {
      if (playing) {
        animPhase += dt;
        var next = 60 - 60 * Math.cos(animPhase * (Math.PI / 2.6));
        setAngle(next);
      }
      controls.update();
      renderer.render(scene, camera);
    }
  }

    /* ===== Texturas de tecido ===== */
  function shadeHex(hex, amount) {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    if (amount >= 0) {
      r += (255 - r) * amount;
      g += (255 - g) * amount;
      b += (255 - b) * amount;
    } else {
      var k = 1 + amount;
      r *= k;
      g *= k;
      b *= k;
    }
    var to = function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); };
    return '#' + to(r) + to(g) + to(b);
  }

  function rgbaFromHex(hex, alpha) {
    var n = parseInt(hex.replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function makeCanvas(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  function makeTexture(canvas, options) {
    var opts = options || {};
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    tex.anisotropy = MAX_ANISO;
    return tex;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawKneePatch(ctx, W, H) {
    var x0 = 272, x1 = 752, y0 = 388, y1 = 676;
    var cx = (x0 + x1) / 2;
    var cy = (y0 + y1) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 30;
    roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, 92);
    ctx.fillStyle = '#565b5e';
    ctx.fill();
    ctx.restore();

    roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, 92);
    ctx.strokeStyle = 'rgba(28,31,33,0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, 92);
    ctx.clip();
    for (var i = 0; i < 3600; i++) {
      var x = x0 + Math.random() * (x1 - x0);
      var y = y0 + Math.random() * (y1 - y0);
      var dark = Math.random() < 0.62;
      ctx.fillStyle = dark
        ? 'rgba(26,29,32,' + (0.05 + Math.random() * 0.14) + ')'
        : 'rgba(228,233,234,' + (0.03 + Math.random() * 0.09) + ')';
      ctx.fillRect(x, y, 1.4, 2.2);
    }
    for (var j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 228 - j * 32, 122 - j * 17, 0, 0, Math.PI * 2);
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = j * 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgbaFromHex(accent, 0.85 - j * 0.06);
      ctx.shadowColor = rgbaFromHex(accent, 0.5);
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = rgbaFromHex(accent, 0.85);
    ctx.shadowBlur = 14;
    ctx.fillStyle = rgbaFromHex(shadeHex(accent, 0.22), 0.98);
    roundRectPath(ctx, cx - 28, y0 + 22, 56, 12, 6);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgbaFromHex(accent, 0.72);
    ctx.lineWidth = 2.6;
    ctx.shadowColor = rgbaFromHex(accent, 0.4);
    ctx.shadowBlur = 7;
    var len = 40, p = 14;
    var corners = [
      [x0 + p, y0 + p, 1, 1],
      [x1 - p, y0 + p, -1, 1],
      [x0 + p, y1 - p, 1, -1],
      [x1 - p, y1 - p, -1, -1]
    ];
    for (var c = 0; c < corners.length; c++) {
      var corner = corners[c];
      ctx.beginPath();
      ctx.moveTo(corner[0] + corner[2] * len, corner[1]);
      ctx.lineTo(corner[0], corner[1]);
      ctx.lineTo(corner[0], corner[1] + corner[3] * len);
      ctx.stroke();
    }
    ctx.restore();
  }
  function heatherCanvas() {
    var W = 1024, H = 1024;
    var canvas = makeCanvas(W, H);
    var ctx = canvas.getContext('2d');

    var bg = ctx.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, '#3c4144');
    bg.addColorStop(0.14, '#44494c');
    bg.addColorStop(0.5, '#4b5053');
    bg.addColorStop(0.86, '#44494c');
    bg.addColorStop(1, '#3c4144');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (var x = 0; x < W; x += 5) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.025 + Math.random() * 0.04) + ')';
      ctx.fillRect(x, 0, 1, H);
      if (Math.random() < 0.5) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.03) + ')';
        ctx.fillRect(x + 2, 0, 1, H);
      }
    }

    ctx.lineWidth = 2.6;
    for (var y = 6; y < H; y += 18) {
      for (var xx = ((y / 18) % 2) * 11; xx < W + 22; xx += 22) {
        ctx.strokeStyle = Math.random() < 0.7 ? 'rgba(24,27,30,0.10)' : 'rgba(235,240,240,0.06)';
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx + 11, y + 9);
        ctx.lineTo(xx + 22, y);
        ctx.stroke();
      }
    }

    for (var i = 0; i < 20000; i++) {
      var px = Math.random() * W;
      var py = Math.random() * H;
      var dark = Math.random() < 0.62;
      ctx.fillStyle = dark
        ? 'rgba(26,29,32,' + (0.04 + Math.random() * 0.15) + ')'
        : 'rgba(222,228,230,' + (0.03 + Math.random() * 0.10) + ')';
      ctx.fillRect(px, py, 1.2, 1 + Math.random() * 3);
    }

    ctx.lineWidth = 1;
    for (var s = 0; s < 5200; s++) {
      var sx = Math.random() * W;
      var sy = Math.random() * H;
      var up = Math.random() < 0.5;
      ctx.strokeStyle = Math.random() < 0.6
        ? 'rgba(18,21,24,' + (0.10 + Math.random() * 0.18) + ')'
        : 'rgba(235,240,240,' + (0.05 + Math.random() * 0.10) + ')';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (up ? 2.4 : -2.4), sy + 2.6);
      ctx.stroke();
    }

    drawKneePatch(ctx, W, H);

    ctx.strokeStyle = 'rgba(28,31,33,0.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 8]);
    for (var line = 0; line < 2; line++) {
      var ly = line === 0 ? 330 : 734;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(W, ly);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    var vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0.20)');
    vg.addColorStop(0.07, 'rgba(0,0,0,0)');
    vg.addColorStop(0.92, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.24)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    for (var v = 0; v < 2; v++) {
      var vx = v === 0 ? W * 0.25 : W * 0.75;
      ctx.strokeStyle = 'rgba(25,28,30,0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(18,20,22,0.55)';
    ctx.fillRect(0, 0, 4, H);
    ctx.fillRect(W - 4, 0, 4, H);
    ctx.strokeStyle = 'rgba(225,230,230,0.20)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 9]);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(12, H);
    ctx.moveTo(W - 12, 0);
    ctx.lineTo(W - 12, H);
    ctx.stroke();
    ctx.setLineDash([]);

    return canvas;
  }

  function trimCanvas() {
    var W = 512, H = 128;
    var canvas = makeCanvas(W, H);
    var ctx = canvas.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shadeHex(accent, 0.1));
    g.addColorStop(0.5, shadeHex(accent, 0.24));
    g.addColorStop(1, shadeHex(accent, -0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (var y = 0; y < H; y += 6) {
      ctx.fillStyle = 'rgba(20,60,16,' + (0.03 + Math.random() * 0.05) + ')';
      ctx.fillRect(0, y, W, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, y + 2, W, 1);
    }

    for (var i = 0; i < 2600; i++) {
      var x = Math.random() * W;
      var yy = Math.random() * H;
      var dark = Math.random() < 0.55;
      ctx.fillStyle = dark
        ? 'rgba(20,60,16,' + (0.05 + Math.random() * 0.12) + ')'
        : 'rgba(255,255,255,' + (0.05 + Math.random() * 0.12) + ')';
      ctx.fillRect(x, yy, 1.4, 1 + Math.random() * 2.4);
    }

    var edge = ctx.createLinearGradient(0, 0, 0, 14);
    edge.addColorStop(0, 'rgba(12,40,8,0.35)');
    edge.addColorStop(1, 'rgba(12,40,8,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, 14);

    var edge2 = ctx.createLinearGradient(0, H - 14, 0, H);
    edge2.addColorStop(0, 'rgba(12,40,8,0)');
    edge2.addColorStop(1, 'rgba(12,40,8,0.35)');
    ctx.fillStyle = edge2;
    ctx.fillRect(0, H - 14, W, 14);

    return canvas;
  }

  function webbingCanvas() {
    var W = 256, H = 128;
    var canvas = makeCanvas(W, H);
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#101214';
    ctx.fillRect(0, 0, W, H);

    for (var y = 0; y < H; y += 4) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.018 + Math.random() * 0.03) + ')';
      ctx.fillRect(0, y, W, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y + 2, W, 1);
    }

    for (var i = 0; i < 2400; i++) {
      var x = Math.random() * W;
      var yy = Math.random() * H;
      ctx.fillStyle = Math.random() < 0.6
        ? 'rgba(0,0,0,' + (0.10 + Math.random() * 0.18) + ')'
        : 'rgba(90,98,96,' + (0.05 + Math.random() * 0.10) + ')';
      ctx.fillRect(x, yy, 1 + Math.random() * 2, 1);
    }

    ctx.strokeStyle = 'rgba(160,168,160,0.20)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(W, 9);
    ctx.moveTo(0, H - 9);
    ctx.lineTo(W, H - 9);
    ctx.stroke();
    ctx.setLineDash([]);

    return canvas;
  }
  function knitBumpCanvas() {
    var S = 512;
    var canvas = makeCanvas(S, S);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, S, S);

    for (var y = 0; y < S; y += 6) {
      for (var x = ((y / 6) % 2) * 3; x < S; x += 6) {
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0) {
          ctx.moveTo(x, y + 4);
          ctx.lineTo(x + 4, y);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x + 4, y + 4);
        }
        ctx.stroke();
      }
    }

    for (var x2 = 0; x2 < S; x2 += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x2, 0, 1, S);
    }

    return canvas;
  }

  function velcroBumpCanvas() {
    var S = 256;
    var canvas = makeCanvas(S, S);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, S, S);

    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * S;
      var y = Math.random() * S;
      var r = 0.6 + Math.random() * 1.6;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas;
  }

  function contactShadowCanvas() {
    var S = 256;
    var canvas = makeCanvas(S, S);
    var ctx = canvas.getContext('2d');
    var g = ctx.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(2,6,3,0.6)');
    g.addColorStop(0.55, 'rgba(2,6,3,0.26)');
    g.addColorStop(1, 'rgba(2,6,3,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return canvas;
  }

  function makeMaterials() {
    var knitBump = makeTexture(knitBumpCanvas(), { srgb: false });
    var webbing = webbingCanvas();
    var strapMap = makeTexture(webbing, { repeat: [16, 1] });
    var bandMap = makeTexture(webbing, { repeat: [7, 1] });

    function bumpClone(rx, ry) {
      var tex = knitBump.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.anisotropy = MAX_ANISO;
      return tex;
    }

    heatherTex = makeTexture(heatherCanvas());
    trimTex = makeTexture(trimCanvas(), { repeat: [4, 1] });

    baseMat = new THREE.MeshPhysicalMaterial({
      map: heatherTex,
      bumpMap: bumpClone(3, 3),
      bumpScale: 0.0065,
      roughness: 0.9,
      metalness: 0,
      sheen: 0.4,
      sheenRoughness: 0.82,
      sheenColor: new THREE.Color(0x7c8580),
      envMapIntensity: 0.42
    });

    var linerMat = new THREE.MeshPhysicalMaterial({
      color: 0x15171a,
      roughness: 0.95,
      metalness: 0,
      bumpMap: bumpClone(6, 6),
      bumpScale: 0.003,
      envMapIntensity: 0.25,
      side: THREE.DoubleSide
    });
    linerMat.name = 'liner';

    trimMat = new THREE.MeshPhysicalMaterial({
      map: trimTex,
      bumpMap: bumpClone(8, 2),
      bumpScale: 0.003,
      roughness: 0.6,
      sheen: 0.5,
      sheenColor: new THREE.Color(shadeHex(accent, 0.55)),
      emissive: new THREE.Color(shadeHex(accent, -0.62)),
      emissiveIntensity: 0.35,
      envMapIntensity: 0.55
    });

    rimMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent),
      roughness: 0.5,
      metalness: 0,
      emissive: new THREE.Color(shadeHex(accent, -0.55)),
      emissiveIntensity: 0.4,
      envMapIntensity: 0.55,
      side: THREE.DoubleSide
    });

    var strapMat = new THREE.MeshPhysicalMaterial({
      map: strapMap,
      bumpMap: bumpClone(12, 2),
      bumpScale: 0.0035,
      roughness: 0.8,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0x5b6360),
      envMapIntensity: 0.45,
      side: THREE.DoubleSide
    });

    var bandMat = new THREE.MeshPhysicalMaterial({
      map: bandMap,
      bumpMap: bumpClone(8, 2),
      bumpScale: 0.0035,
      roughness: 0.8,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0x5b6360),
      envMapIntensity: 0.45,
      side: THREE.DoubleSide
    });

    var velcroMat = new THREE.MeshPhysicalMaterial({
      color: 0x1b1d1f,
      roughness: 0.96,
      metalness: 0,
      bumpMap: makeTexture(velcroBumpCanvas(), { srgb: false, repeat: [2, 2] }),
      bumpScale: 0.014,
      envMapIntensity: 0.2
    });
    velcroMat.name = 'velcro';
    materialStore = {
      liner: linerMat,
      strap: strapMat,
      band: bandMat,
      velcro: velcroMat
    };
  }

  var materialStore = {};

  function refreshAccent() {
    if (!THREE || !baseMat) return;
    var newHeather = makeTexture(heatherCanvas());
    var newTrim = makeTexture(trimCanvas(), { repeat: [4, 1] });
    if (baseMat.map) baseMat.map.dispose();
    if (trimMat.map) trimMat.map.dispose();
    heatherTex = newHeather;
    trimTex = newTrim;
    baseMat.map = heatherTex;
    baseMat.needsUpdate = true;
    trimMat.map = trimTex;
    trimMat.emissive.set(shadeHex(accent, -0.62));
    trimMat.sheenColor.set(shadeHex(accent, 0.55));
    trimMat.needsUpdate = true;
    rimMat.color.set(accent);
    rimMat.emissive.set(shadeHex(accent, -0.55));
    rimMat.needsUpdate = true;
    for (var i = 0; i < legAccentMaterials.length; i++) {
      var legMat = legAccentMaterials[i];
      legMat.color.set(accent);
      if (legMat.emissive) legMat.emissive.set(shadeHex(accent, -0.5));
      legMat.needsUpdate = true;
    }
  }
  /* ===== Geometria da joelheira ===== */
  var Z_AXIS = null;
  var spine = null;

  function initSpine() {
    Z_AXIS = new THREE.Vector3(0, 0, 1);
    spine = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.0, 0.008),
      new THREE.Vector3(0, 0.4, 0.026),
      new THREE.Vector3(0, 0.8, 0.062),
      new THREE.Vector3(0, 1.2, 0.034),
      new THREE.Vector3(0, 1.6, -0.016)
    ], false, 'catmullrom', 0.5);
  }

  function radiusAt(t) {
    return 0.262
      + 0.026 * t
      + 0.038 * Math.exp(-Math.pow((t - 0.5) / 0.2, 2))
      - 0.012 * Math.exp(-Math.pow((t - 0.16) / 0.12, 2));
  }

  function frameAt(t) {
    var p = spine.getPoint(t);
    var tan = spine.getTangent(t).normalize();
    var side = new THREE.Vector3().crossVectors(tan, Z_AXIS);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    var front = new THREE.Vector3().crossVectors(side, tan).normalize();
    return { p: p, tan: tan, side: side, front: front };
  }

  function surf(t, u, extra) {
    var f = frameAt(t);
    var ang = (u - 0.5) * Math.PI * 2;
    var r = radiusAt(t) + (extra || 0);
    var sn = Math.sin(ang);
    var cs = Math.cos(ang);
    var pos = f.p.clone()
      .addScaledVector(f.side, sn * r * 1.05)
      .addScaledVector(f.front, cs * r * 0.92);
    var normal = new THREE.Vector3()
      .addScaledVector(f.side, sn / 1.05)
      .addScaledVector(f.front, cs / 0.92)
      .normalize();
    return { pos: pos, normal: normal, f: f, r: r };
  }

  function wrinkle(t, u) {
    var env = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    var a = Math.sin(u * Math.PI * 2 * 5 + t * 26) * 0.55
      + Math.sin(u * Math.PI * 2 * 11 - t * 41 + 2.1) * 0.3
      + Math.sin(u * Math.PI * 2 * 23 + t * 73 + 0.7) * 0.15;
    return 0.003 * a * env;
  }

  function buildTube(opts) {
    var t0 = opts.t0 || 0;
    var t1 = opts.t1 === undefined ? 1 : opts.t1;
    var offset = opts.offset || 0;
    var edgeFrac = opts.edgeFrac || 0;
    var segU = opts.segU || 200;
    var segV = opts.segV || 160;
    var wrinkles = opts.wrinkles || 0;
    var vNorm = !!opts.vNorm;

    var M = segU;
    var N = segV;
    var positions = [];
    var uvs = [];
    var indices = [];

    for (var iv = 0; iv <= N; iv++) {
      var t = t0 + (t1 - t0) * iv / N;
      var f = frameAt(t);
      var baseR = radiusAt(t);

      var off = offset;
      if (edgeFrac > 0) {
        var w = (t1 - t0) * edgeFrac;
        var k = Math.min(1, (t - t0) / w, (t1 - t) / w);
        var s = k * k * (3 - 2 * k);
        off = offset * s;
      }

      for (var iu = 0; iu <= M; iu++) {
        var u = iu / M;
        var ang = (u - 0.5) * Math.PI * 2;
        var sn = Math.sin(ang);
        var cs = Math.cos(ang);
        var r = baseR + off + (wrinkles ? wrinkle(t, u) * wrinkles : 0);
        positions.push(
          f.p.x + f.side.x * sn * r * 1.05 + f.front.x * cs * r * 0.92,
          f.p.y + f.side.y * sn * r * 1.05 + f.front.y * cs * r * 0.92,
          f.p.z + f.side.z * sn * r * 1.05 + f.front.z * cs * r * 0.92
        );
        uvs.push(u, vNorm ? (t - t0) / (t1 - t0) : t);
      }
    }

    for (var iv2 = 0; iv2 < N; iv2++) {
      for (var iu2 = 0; iu2 < M; iu2++) {
        var a = iv2 * (M + 1) + iu2;
        var b = a + 1;
        var c = a + M + 1;
        var d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    var pa = geo.attributes.position;
    var na = geo.attributes.normal;
    var mi = Math.floor(N / 2) * (M + 1) + Math.floor(M / 2);
    var vp = new THREE.Vector3().fromBufferAttribute(pa, mi);
    var vn = new THREE.Vector3().fromBufferAttribute(na, mi);
    var ctr = spine.getPoint((t0 + t1) / 2);

    if (vn.dot(vp.clone().sub(ctr)) < 0) {
      var arr = geo.index.array;
      for (var i = 0; i < arr.length; i += 3) {
        var tmp = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      geo.index.needsUpdate = true;
      geo.computeVertexNormals();
    }

    return geo;
  }
  function buildRim(t, tubeR) {
    var radius = tubeR || 0.0125;
    var f = frameAt(t);
    var r = radiusAt(t);
    var rx = r * 1.05;
    var rz = r * 0.92;
    var N = 220;
    var M = 14;
    var positions = [];
    var uvs = [];
    var indices = [];

    for (var i = 0; i <= N; i++) {
      var a = i / N * Math.PI * 2;
      var sn = Math.sin(a);
      var cs = Math.cos(a);
      var cx = new THREE.Vector3().addScaledVector(f.side, sn * rx).addScaledVector(f.front, cs * rz);
      var n = new THREE.Vector3()
        .addScaledVector(f.side, sn / 1.05)
        .addScaledVector(f.front, cs / 0.92)
        .normalize();

      for (var j = 0; j <= M; j++) {
        var b = j / M * Math.PI * 2;
        var off = new THREE.Vector3()
          .addScaledVector(n, Math.cos(b) * radius)
          .addScaledVector(f.tan, Math.sin(b) * radius);
        var p = f.p.clone().add(cx).add(off);
        positions.push(p.x, p.y, p.z);
        uvs.push(i / N, j / M);
      }
    }

    for (var i2 = 0; i2 < N; i2++) {
      for (var j2 = 0; j2 < M; j2++) {
        var A = i2 * (M + 1) + j2;
        var B = A + 1;
        var C = A + M + 1;
        var D = C + 1;
        indices.push(A, B, C, B, D, C);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function buildStrap(opts) {
    var tMid = opts.tMid;
    var amp = opts.amp;
    var width = opts.width;
    var offset = opts.offset;
    var dir = opts.dir;
    var S = 260;
    var K = 6;
    var W2 = width / 2;
    var positions = [];
    var uvs = [];
    var indices = [];
    var edgeA = [];
    var edgeB = [];

    var tAt = function (u) { return tMid + dir * amp * Math.sin(2 * Math.PI * (u - 0.5)); };

    for (var i = 0; i <= S; i++) {
      var u = i / S;
      var t = tAt(u);
      var s0 = surf(t, u, offset);
      var eps = 0.0008;
      var pA = surf(tAt(u - eps), u - eps, offset).pos;
      var pB = surf(tAt(u + eps), u + eps, offset).pos;
      var along = pB.clone().sub(pA).normalize();
      var across = new THREE.Vector3().crossVectors(s0.normal, along).normalize();

      for (var j = 0; j <= K; j++) {
        var w = j / K * 2 - 1;
        var p = s0.pos.clone()
          .addScaledVector(across, w * W2)
          .addScaledVector(s0.normal, 0.0042 * (1 - w * w));
        positions.push(p.x, p.y, p.z);
        uvs.push(u, j / K);
        if (j === 0) edgeA.push(p.clone());
        if (j === K) edgeB.push(p.clone());
      }
    }

    for (var i2 = 0; i2 < S; i2++) {
      for (var j2 = 0; j2 < K; j2++) {
        var a = i2 * (K + 1) + j2;
        var b = a + 1;
        var c = a + K + 1;
        var d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    var group = new THREE.Group();
    var mesh = new THREE.Mesh(geo, materialStore.strap);
    group.add(mesh);

    var curveA = new THREE.CatmullRomCurve3(edgeA.slice(0, S), true, 'centripetal');
    var curveB = new THREE.CatmullRomCurve3(edgeB.slice(0, S), true, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curveA, 320, 0.0046, 8, true), rimMat));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curveB, 320, 0.0046, 8, true), rimMat));

    return group;
  }

  function makeVelcroPatch(t, u) {
    var s = surf(t, u, 0.014);
    var y = s.f.tan.clone().normalize();
    var z = s.normal.clone().normalize();
    var x = new THREE.Vector3().crossVectors(y, z).normalize();
    var m = new THREE.Matrix4().makeBasis(x, y, z);
    var mesh = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.068, 0.016, 4, 0.007), materialStore.velcro);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.copy(s.pos);
    return mesh;
  }

  function createSleeve() {
    var group = new THREE.Group();
    var base = new THREE.Mesh(buildTube({ segU: 200, segV: 220, wrinkles: 1 }), baseMat);
    var liner = new THREE.Mesh(buildTube({ offset: -0.014, segU: 96, segV: 80 }), materialStore.liner);
    var topTrim = new THREE.Mesh(buildTube({ t0: 0.947, t1: 1, offset: 0.0025, edgeFrac: 0.3, segU: 200, segV: 16, vNorm: true }), trimMat);
    var botTrim = new THREE.Mesh(buildTube({ t0: 0, t1: 0.045, offset: 0.0025, edgeFrac: 0.3, segU: 200, segV: 16, vNorm: true }), trimMat);
    var band = new THREE.Mesh(buildTube({ t0: 0.842, t1: 0.948, offset: 0.009, edgeFrac: 0.12, segU: 200, segV: 26, vNorm: true }), materialStore.band);
    var rimTop = new THREE.Mesh(buildRim(0.992), rimMat);
    var rimBot = new THREE.Mesh(buildRim(0.008), rimMat);
    var strapA = buildStrap({ tMid: 0.46, amp: 0.265, width: 0.092, offset: 0.013, dir: 1 });
    var strapB = buildStrap({ tMid: 0.46, amp: 0.265, width: 0.092, offset: 0.0185, dir: -1 });
    var velcro = makeVelcroPatch(0.896, 0.53);

    var parts = [base, liner, topTrim, botTrim, band, rimTop, rimBot, strapA, strapB, velcro];
    for (var i = 0; i < parts.length; i++) {
      parts[i].traverse(function (obj) {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      group.add(parts[i]);
    }
    return group;
  }
  function applySleeveBend(material) {
    if (!material || material.userData.flexproBend) return;
    material.userData.flexproBend = true;
    material.onBeforeCompile = function (shader) {
      shader.uniforms.uKneeAngle = bendUniforms.uKneeAngle;
      shader.uniforms.uKneeY = bendUniforms.uKneeY;
      shader.uniforms.uBendHalf = bendUniforms.uBendHalf;
      shader.vertexShader =
        'uniform float uKneeAngle;\nuniform float uKneeY;\nuniform float uBendHalf;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n' +
        'float bendF1 = 1.0 - smoothstep(uKneeY - uBendHalf, uKneeY + uBendHalf, position.y);\n' +
        'float bendA1 = uKneeAngle * bendF1;\n' +
        'float bendS1 = sin(bendA1);\n' +
        'float bendC1 = cos(bendA1);\n' +
        'objectNormal = vec3(objectNormal.x, objectNormal.y * bendC1 - objectNormal.z * bendS1, objectNormal.y * bendS1 + objectNormal.z * bendC1);'
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float bendF2 = 1.0 - smoothstep(uKneeY - uBendHalf, uKneeY + uBendHalf, position.y);\n' +
        'float bendA2 = uKneeAngle * bendF2;\n' +
        'float bendS2 = sin(bendA2);\n' +
        'float bendC2 = cos(bendA2);\n' +
        'vec3 bendP = vec3(position.x, position.y - uKneeY, position.z);\n' +
        'transformed = vec3(bendP.x, uKneeY + bendP.y * bendC2 - bendP.z * bendS2, bendP.y * bendS2 + bendP.z * bendC2);'
      );
    };
    material.customProgramCacheKey = function () { return 'flexpro-sleeve-bend'; };
    material.needsUpdate = true;
  }

  function buildSleeve() {
    initSpine();
    var sleeve = createSleeve();
    sleeve.updateMatrixWorld(true);
    sleeveGroup = new THREE.Group();
    var fit = new THREE.Matrix4().makeTranslation(
      0,
      KNEE_Y - SLEEVE_KNEE_LOCAL * SLEEVE_SCALE,
      0
    );
    fit.multiply(new THREE.Matrix4().makeScale(SLEEVE_SCALE, SLEEVE_SCALE, SLEEVE_SCALE));

    sleeveDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide
    });
    applySleeveBend(sleeveDepthMat);

    sleeve.traverse(function (obj) {
      if (!obj.isMesh) return;
      obj.updateMatrixWorld(true);
      var geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrixWorld);
      geo.applyMatrix4(fit);
      var mesh = new THREE.Mesh(geo, obj.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = sleeveDepthMat;
      var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (var m = 0; m < mats.length; m++) applySleeveBend(mats[m]);
      sleeveGroup.add(mesh);
    });

    scene.add(sleeveGroup);
    sleeveGroup.updateMatrixWorld(true);
  }

  /* ===== Perna de manequim (GLB) ===== */
  function slimGeometry(geo, factor) {
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) * factor);
      pos.setZ(i, pos.getZ(i) * factor);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }

  function tuneLegMaterial(mat) {
    if (!mat || mat.userData.flexproTuned) return;
    mat.userData.flexproTuned = true;
    mat.envMapIntensity = 0.45;
    if (mat.name === 'Pele') {
      mat.color.setHex(0xc7a084);
      mat.roughness = 0.62;
      mat.metalness = 0;
    } else if (mat.name === 'Verde') {
      mat.color.set(accent);
      if (mat.emissive) mat.emissive.set(shadeHex(accent, -0.5));
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.18;
      mat.roughness = 0.55;
      legAccentMaterials.push(mat);
    } else if (mat.name === 'Branco') {
      mat.roughness = 0.62;
    } else {
      mat.roughness = Math.max(0.72, mat.roughness || 0.8);
    }
    mat.needsUpdate = true;
  }

  function loadLeg() {
    return new Promise(function (resolve, reject) {
      var loader = new GLTFLoader();
      loader.load('assets/perna-flexpro.glb', function (gltf) {
        legGroup = gltf.scene;
        legGroup.scale.setScalar(LEG_SCALE);
        var slimParts = {
          Coxa_pele: true,
          Canela_pele: true,
          Joelho_junta: true,
          Patela: true,
          Panturrilha: true
        };
        legGroup.traverse(function (obj) {
          if (!obj.isMesh) return;
          var nodeName = obj.name || '';
          if (slimParts[nodeName]) slimGeometry(obj.geometry, LEG_SLIM);
          obj.castShadow = true;
          obj.receiveShadow = true;
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (var m = 0; m < mats.length; m++) tuneLegMaterial(mats[m]);
        });
        var patela = legGroup.getObjectByName('Patela');
        if (patela) patela.position.z *= LEG_SLIM;
        var calf = legGroup.getObjectByName('Panturrilha');
        if (calf) calf.position.z *= LEG_SLIM;
        ['Bermuda', 'Bermuda_vivo'].forEach(function (name) {
          var shorts = legGroup.getObjectByName(name);
          if (shorts) shorts.visible = false;
        });
        var thigh = legGroup.getObjectByName('Coxa_pele');
        if (thigh && thigh.geometry.boundingBox) {
          var bb = thigh.geometry.boundingBox;
          var capR = Math.max(bb.max.x, bb.max.z);
          var cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 32, 16), thigh.material);
          cap.position.set(0, bb.max.y, 0);
          cap.scale.y = 0.55;
          cap.castShadow = true;
          cap.receiveShadow = true;
          thigh.add(cap);
        }
        legKneePivot = legGroup.getObjectByName('Joelho_pivo');
        scene.add(legGroup);
        legGroup.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(legGroup);
        legGroup.position.y -= box.min.y;
        legGroup.updateMatrixWorld(true);
        if (legKneePivot) {
          var kneeWorld = new THREE.Vector3().setFromMatrixPosition(legKneePivot.matrixWorld);
          KNEE_Y = kneeWorld.y;
        }
        resolve();
      }, undefined, reject);
    });
  }

  function buildContactShadow() {
    contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.7),
      new THREE.MeshBasicMaterial({
        map: makeTexture(contactShadowCanvas()),
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.002;
    scene.add(contact);
  }

  /* ===== Capturas geradas do modelo ===== */
  function captureViews() {
    if (!ready || !renderer || !photoCamera) return;
    var savedSize = new THREE.Vector2();
    renderer.getSize(savedSize);
    var savedRatio = renderer.getPixelRatio();
    var legVisible = legGroup.visible;
    var groundVisible = ground.visible;
    var contactVisible = contact.visible;
    var savedAngle = angle;

    legGroup.visible = false;
    ground.visible = false;
    contact.visible = false;
    applyKneePose(0);
    scene.updateMatrixWorld(true);

    renderer.setPixelRatio(1);
    renderer.setSize(1000, 1000, false);
    photoCamera.aspect = 1;
    photoCamera.updateProjectionMatrix();

    function shot(imgId, wrapName, targetY, phi, theta, radius) {
      var target = new THREE.Vector3(0, targetY, 0);
      var offset = new THREE.Vector3().setFromSphericalCoords(radius, phi, theta);
      photoCamera.position.copy(target).add(offset);
      photoCamera.lookAt(target);
      renderer.render(scene, photoCamera);
      var url = renderer.domElement.toDataURL('image/png');
      var img = document.getElementById(imgId);
      if (img) img.src = url;
      var wrap = document.querySelector('[data-shot-wrap="' + wrapName + '"]');
      if (wrap) wrap.hidden = false;
    }

    try {
      shot('shotSuperior', 'superior', KNEE_Y, 0.62, 0.7, 2.3);
      shot('shotInferior', 'inferior', KNEE_Y, 2.08, 0.7, 2.3);
    } catch (error) {
      console.warn('Não foi possível gerar as vistas 3D da galeria.', error);
    }

    legGroup.visible = legVisible;
    ground.visible = groundVisible;
    contact.visible = contactVisible;
    applyKneePose(savedAngle);
    renderer.setPixelRatio(savedRatio);
    renderer.setSize(savedSize.x, savedSize.y, false);
    if (isOpen) renderer.render(scene, camera);
  }

  /* ===== Início ===== */
  if (document.readyState === 'complete') {
    ensureInit();
  } else {
    window.addEventListener('load', function () { ensureInit(); }, { once: true });
  }
})();
