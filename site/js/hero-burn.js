(() => {
  const hero = document.querySelector('.hero--illustrated');
  const image = hero?.querySelector('.hero__image');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!hero || !image || motion.matches) return;

  const finish = () => hero.classList.remove('is-burning');
  const play = () => {
    if (!image.naturalWidth || motion.matches) return;
    hero.classList.add('is-burning');
    hero.querySelector('.hero__burn-reveal')?.addEventListener('animationend', finish, { once: true });
    // Keep a final-state fallback if animation events are unavailable.
    window.setTimeout(finish, 3300);
  };
  motion.addEventListener('change', (event) => { if (event.matches) finish(); });
  if (image.complete) play();
  else image.addEventListener('load', play, { once: true });
})();
