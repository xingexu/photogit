(() => {
  const background = document.querySelector('.ascii-background');
  const toggle = document.querySelector('.ascii-toggle');
  const layers = Array.from(background.querySelectorAll('canvas'), (canvas) => ({
    canvas,
    context: canvas.getContext('2d'),
    photo: null,
  }));
  const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!sampler || layers.some(({ context }) => !context)) return;

  const sources = ['photos/lake.webp', 'photos/ocean.webp', 'photos/stars.webp', 'photos/desert.webp'];
  const glyphs = ' .,:;-+=*#%@';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let photos = [];
  let photoIndex = 0;
  let layerIndex = 0;
  let inView = false;
  let paused = false;
  let timer;

  function paint({ canvas, context, photo }, width, height) {
    if (!photo || !width || !height) return;

    const scale = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.scale(scale, scale);
    const fontSize = width < 680 ? 9 : 11;
    context.font = `${fontSize}px ui-monospace, monospace`;
    context.textBaseline = 'middle';
    context.fillStyle = '#a9c1e5';

    const cellHeight = fontSize * 1.25;
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
        line += glyphs[Math.round(brightness ** 1.35 * (glyphs.length - 1))];
      }
      context.fillText(line, 0, (row + 0.5) * cellHeight);
    }
  }

  function showPhoto() {
    const layer = layers[layerIndex];
    layer.photo = photos[photoIndex];
    paint(layer, background.clientWidth, background.clientHeight);
    layer.canvas.classList.add('is-current');
    layers[1 - layerIndex].canvas.classList.remove('is-current');
  }

  function schedule() {
    clearTimeout(timer);
    const canRotate = photos.length > 1 && !reducedMotion.matches;
    toggle.hidden = !canRotate;
    if (!canRotate || paused || !inView || document.hidden) return;

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
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    schedule();
  }).observe(background);
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    for (const layer of layers) paint(layer, width, height);
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
