(() => {
  const background = document.querySelector('.ascii-background');
  const wordmark = document.querySelector('.wordmark');
  const tryLink = document.querySelector('.try-link');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const resetTilt = () => {
    wordmark.style.removeProperty('--tilt-x');
    wordmark.style.removeProperty('--tilt-y');
  };
  wordmark.addEventListener('pointermove', ({ clientX, clientY, pointerType }) => {
    if (pointerType === 'touch' || reducedMotion.matches) return;
    const { left, top, width, height } = wordmark.getBoundingClientRect();
    const x = (clientX - left) / width - 0.5;
    const y = (clientY - top) / height - 0.5;
    wordmark.style.setProperty('--tilt-x', `${-y * 44}deg`);
    wordmark.style.setProperty('--tilt-y', `${x * 60}deg`);
  });
  wordmark.addEventListener('pointerleave', resetTilt);
  wordmark.addEventListener('pointercancel', resetTilt);
  window.addEventListener('blur', resetTilt);
  reducedMotion.addEventListener('change', resetTilt);

  tryLink.addEventListener('pointermove', ({ clientX, clientY, pointerType }) => {
    if (pointerType === 'touch' || reducedMotion.matches) return;
    const { left, top } = tryLink.getBoundingClientRect();
    tryLink.style.setProperty('--glint-x', `${clientX - left}px`);
    tryLink.style.setProperty('--glint-y', `${clientY - top}px`);
  });

  const photoCanvas = background.querySelector('.ascii-photo');
  const context = photoCanvas.getContext('2d');
  const trailCanvas = background.querySelector('.ascii-trail');
  const trailContext = trailCanvas.getContext('2d');
  const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!sampler || !context) return;

  const sources = ['photos/lake.webp', 'photos/ocean.webp', 'photos/stars.webp', 'photos/desert.webp'];
  const glyphs = ' .,:;-~+=!iltfrxvuznXYTLCJ0OZQwm#MW&8%B@$';
  const trail = [];
  const trailLifetime = 620;
  let trailFrame = 0;
  let width = background.clientWidth;
  let height = background.clientHeight;
  let scale = Math.min(window.devicePixelRatio, 2);
  let photo;

  function sizeCanvas(canvas, context) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function paint() {
    if (!photo || !width || !height) return;

    sizeCanvas(photoCanvas, context);
    const fontSize = width < 680 ? 7 : 8;
    context.font = `${fontSize}px ui-monospace, monospace`;
    context.textBaseline = 'middle';
    context.fillStyle = '#fff';

    const cellHeight = fontSize * 1.18;
    const cellWidth = context.measureText('M').width;
    const columns = Math.ceil(width / cellWidth);
    const rows = Math.ceil(height / cellHeight);
    sampler.canvas.width = columns;
    sampler.canvas.height = rows;

    const cover = Math.max(width / photo.naturalWidth, height / photo.naturalHeight);
    const cropWidth = width / cover;
    const cropHeight = height / cover;
    sampler.drawImage(photo, (photo.naturalWidth - cropWidth) / 2, (photo.naturalHeight - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, columns, rows);
    const colors = sampler.getImageData(0, 0, columns, rows);
    const pixels = colors.data;

    for (let row = 0; row < rows; row++) {
      let line = '';
      for (let column = 0; column < columns; column++) {
        const offset = (row * columns + column) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        line += glyphs[Math.round(luminance ** 0.9 * (glyphs.length - 1))];
        // Lift dark colors so sparse glyphs remain visible against the backdrop.
        const lift = 0.76 + 66 / Math.max(32, red, green, blue);
        pixels[offset] = red * lift;
        pixels[offset + 1] = green * lift;
        pixels[offset + 2] = blue * lift;
      }
      context.fillText(line, 0, (row + 0.5) * cellHeight);
    }

    // Mask the enlarged color grid with the text, so each cell keeps its own color.
    sampler.putImageData(colors, 0, 0);
    context.save();
    context.globalCompositeOperation = 'source-in';
    context.imageSmoothingEnabled = false;
    context.drawImage(sampler.canvas, 0, 0, columns * cellWidth, rows * cellHeight);
    context.restore();
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
    trailContext.drawImage(photoCanvas, 0, 0, width, height);

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

  reducedMotion.addEventListener('change', clearTrail);
  document.addEventListener('visibilitychange', clearTrail);
  window.addEventListener('blur', clearTrail);
  window.addEventListener('pointermove', ({ clientX, clientY, pointerType }) => {
    if (!trailContext || pointerType === 'touch' || !photo || reducedMotion.matches || document.hidden) return;

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
    paint();
  }).observe(background);

  // Choose one landscape per load, with fallbacks if a photo cannot be decoded.
  for (let i = sources.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sources[i], sources[j]] = [sources[j], sources[i]];
  }
  async function loadPhoto() {
    for (const source of sources) {
      const candidate = new Image();
      candidate.src = source;
      try {
        await candidate.decode();
      } catch {
        continue;
      }
      photo = candidate;
      paint();
      return;
    }
  }
  loadPhoto();
})();
