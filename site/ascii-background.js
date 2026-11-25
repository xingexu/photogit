(() => {
  const background = document.querySelector('.ascii-background');
  const toggle = document.querySelector('.ascii-toggle');
  const layers = Array.from(background.querySelectorAll('.ascii-photo'), (canvas) => ({
    canvas,
    context: canvas.getContext('2d'),
    photo: null,
  }));
  const trailCanvas = background.querySelector('.ascii-trail');
  const trailContext = trailCanvas.getContext('2d');
  const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!sampler || layers.some(({ context }) => !context)) return;

  const sources = ['photos/lake.webp', 'photos/ocean.webp', 'photos/stars.webp', 'photos/desert.webp'];
  const glyphs = ' .,:;-~+=!iltfrxvuznXYTLCJ0OZQwm#MW&8%B@$';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const trail = [];
  const trailLifetime = 620;
  let trailFrame = 0;
  let width = background.clientWidth;
  let height = background.clientHeight;
  let scale = Math.min(window.devicePixelRatio, 2);
  let photos = [];
  let photoIndex = 0;
  let layerIndex = 0;
  let paused = false;
  let timer;

  function sizeCanvas(canvas, context) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function paint({ canvas, context, photo }) {
    if (!photo || !width || !height) return;

    sizeCanvas(canvas, context);
    const fontSize = width < 680 ? 7 : 8;
    context.font = `${fontSize}px ui-monospace, monospace`;
    context.textBaseline = 'middle';
    context.fillStyle = '#a5bfdf';

    const cellHeight = fontSize * 1.18;
    const columns = Math.ceil(width / context.measureText('M').width);
    const rows = Math.ceil(height / cellHeight);
    sampler.canvas.width = columns;
    sampler.canvas.height = rows;

    const cover = Math.max(width / photo.naturalWidth, height / photo.naturalHeight);
    const cropWidth = width / cover;
    const cropHeight = height / cover;
    sampler.drawImage(photo, (photo.naturalWidth - cropWidth) / 2, (photo.naturalHeight - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, columns, rows);
    const pixels = sampler.getImageData(0, 0, columns, rows).data;

    for (let row = 0; row < rows; row++) {
      let line = '';
      for (let column = 0; column < columns; column++) {
        // The bundled photos are grayscale, so any one color channel gives the brightness.
        const brightness = pixels[(row * columns + column) * 4] / 255;
        line += glyphs[Math.round(brightness ** 1.25 * (glyphs.length - 1))];
      }
      context.fillText(line, 0, (row + 0.5) * cellHeight);
    }
  }

  function showPhoto() {
    const layer = layers[layerIndex];
    layer.photo = photos[photoIndex];
    paint(layer);
    layer.canvas.classList.add('is-current');
    layers[1 - layerIndex].canvas.classList.remove('is-current');
  }

  function drawTrail(time) {
    trailFrame = 0;
    trailContext.clearRect(0, 0, width, height);
    while (trail.length && time - trail[0].time >= trailLifetime) trail.shift();
    if (!trail.length) return;

    for (const { x, y, time: started } of trail) {
      const life = Math.max(0, 1 - (time - started) / trailLifetime);
      const radius = 26 + 57 * life;
      const glow = trailContext.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgb(185 252 255 / ${life * 0.95})`);
      glow.addColorStop(0.45, `rgb(112 166 255 / ${life * 0.52})`);
      glow.addColorStop(1, 'rgb(121 168 255 / 0)');
      trailContext.fillStyle = glow;
      trailContext.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // Keep the moving light inside the shapes of the photo's ASCII characters.
    trailContext.save();
    trailContext.globalCompositeOperation = 'destination-in';
    trailContext.drawImage(layers[layerIndex].canvas, 0, 0, width, height);

    const tip = trail.at(-1);
    const remaining = Math.max(0, 1 - (time - tip.time) / trailLifetime);
    const halo = trailContext.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 100);
    halo.addColorStop(0, `rgb(56 138 255 / ${remaining * 0.24})`);
    halo.addColorStop(1, 'rgb(56 138 255 / 0)');
    trailContext.globalCompositeOperation = 'destination-over';
    trailContext.fillStyle = halo;
    trailContext.fillRect(tip.x - 100, tip.y - 100, 200, 200);
    trailContext.restore();
    trailFrame = requestAnimationFrame(drawTrail);
  }

  function clearTrail() {
    if (!trailContext) return;
    cancelAnimationFrame(trailFrame);
    trailFrame = 0;
    trail.length = 0;
    trailContext.clearRect(0, 0, width, height);
  }

  function motionEnabled() {
    return !paused && !reducedMotion.matches && !document.hidden;
  }

  function schedule() {
    clearTimeout(timer);
    toggle.hidden = !photos.length || reducedMotion.matches;
    if (!motionEnabled()) clearTrail();
    if (photos.length < 2 || !motionEnabled()) return;

    timer = setTimeout(() => {
      photoIndex = (photoIndex + 1) % photos.length;
      layerIndex = 1 - layerIndex;
      showPhoto();
      schedule();
    }, 8000);
  }

  toggle.addEventListener('click', () => {
    paused = !paused;
    toggle.textContent = paused ? 'Resume background' : 'Pause background';
    schedule();
  });
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('blur', clearTrail);
  window.addEventListener('pointermove', ({ clientX, clientY, pointerType }) => {
    if (!trailContext || pointerType === 'touch' || !photos.length || !motionEnabled()) return;

    const last = trail.at(-1);
    if (last && Math.hypot(clientX - last.x, clientY - last.y) < 8) return;
    trail.push({ x: clientX, y: clientY, time: performance.now() });
    if (trail.length > 16) trail.shift();
    if (!trailFrame) trailFrame = requestAnimationFrame(drawTrail);
  }, { passive: true });
  new ResizeObserver(() => {
    width = background.clientWidth;
    height = background.clientHeight;
    scale = Math.min(window.devicePixelRatio, 2);
    clearTrail();
    if (trailContext) sizeCanvas(trailCanvas, trailContext);
    for (const layer of layers) paint(layer);
  }).observe(background);

  // Shuffle once per visit so every available photo appears before the sequence repeats.
  for (let i = sources.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sources[i], sources[j]] = [sources[j], sources[i]];
  }
  Promise.all(sources.map(async (source) => {
    const photo = new Image();
    photo.src = source;
    try {
      await photo.decode();
      return photo;
    } catch {
      return null;
    }
  })).then((loaded) => {
    photos = loaded.filter(Boolean);
    if (!photos.length) return;
    showPhoto();
    schedule();
  });
})();
