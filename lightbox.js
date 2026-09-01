// ---------- Logo lightbox (shared across pages) ----------
(function () {
  var mark = document.querySelector('.logo .mark');
  if (!mark) return;

  var lb = document.createElement('div');
  lb.className = 'logo-lightbox';
  lb.innerHTML =
    '<img src="data:image/jpeg;base64,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" alt="Kenjaku — Otaku News mascot, full size">lightbox.js
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
