// ---------- Logo lightbox (shared across pages) ----------
(function () {
  var mark = document.querySelector('.logo .mark');
  if (!mark) return;

  var lb = document.createElement('div');
  lb.className = 'logo-lightbox';
  lb.innerHTML =
    '<img src="assets/logo.jpg" alt="Kenjaku — Otaku News mascot, full size">' +
    '<div class="lb-caption">KENJAKU · EDITOR-IN-CHIEF — LLOYD FRONTERA · HEAD OF SCHEMES</div>';
  document.body.appendChild(lb);

  function openLb() {
    lb.classList.add('open');
    document.body.classList.add('lb-locked'); // freeze background scroll
  }
  function closeLb() {
    lb.classList.remove('open');
    document.body.classList.remove('lb-locked');
  }

  mark.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation(); // don't trigger the logo link navigation
    openLb();
  });

  lb.addEventListener('click', closeLb);
  // swallow scroll/touch gestures so they never reach the page behind
  lb.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  lb.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLb();
  });
})();
