(() => {
  const stage = document.querySelector('.studio-stage');
  const scene = stage.querySelector('.studio-scene');
  const interactiveMotion = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let frame = 0;

  function reset() {
    cancelAnimationFrame(frame);
    scene.style.removeProperty('--pitch');
    scene.style.removeProperty('--yaw');
  }

  stage.addEventListener('pointermove', (event) => {
    if (!interactiveMotion.matches || event.pointerType === 'touch') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const bounds = stage.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      scene.style.setProperty('--pitch', `${-y * 13}deg`);
      scene.style.setProperty('--yaw', `${x * 16}deg`);
    });
  });

  stage.addEventListener('pointerleave', reset);
  stage.addEventListener('pointercancel', reset);
  interactiveMotion.addEventListener('change', reset);
  window.addEventListener('blur', reset);
})();
