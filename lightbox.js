// ---------- Logo lightbox (shared across pages) ----------
(function () {
  var mark = document.querySelector('.logo .mark');
  if (!mark) return;

  var lb = document.createElement('div');
  lb.className = 'logo-lightbox';
  lb.innerHTML =
    '<div class="lb-logo-svg"><img id="lb-logo-img" src="logo.svg" alt="Otaku News Logo" style="width:260px;height:260px;object-fit:cover;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,0.6);margin-bottom:12px;" /></div>' +
    '<div class="lb-caption">KENJAKU · EDITOR-IN-CHIEF — LLOYD FRONTERA · HEAD OF SCHEMES</div>' +
    '<div style="margin-top:16px;text-align:center;"><label for="logo-file-input" style="background:#334155;color:white;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;display:inline-block;">Upload logo.jpg</label><input type="file" id="logo-file-input" accept="image/*" style="display:none"></div>';
  document.body.appendChild(lb);

  var fileInput = document.getElementById('logo-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(evt) {
        var dataUrl = evt.target.result;
        try {
          localStorage.setItem('otaku-custom-logo', dataUrl);
        } catch(err) {}
        applyCustomLogo();
      };
      reader.readAsDataURL(file);
    });
  }

  function applyCustomLogo() {
    try {
      var custom = localStorage.getItem('otaku-custom-logo');
      if (custom) {
        document.querySelectorAll('.logo .mark img, #lb-logo-img').forEach(function(img) {
          img.src = custom;
        });
      }
    } catch(e) {}
  }

  function applyCustomSiteName() {
    try {
      var customName = localStorage.getItem('otaku-site-name');
      var customJp = localStorage.getItem('otaku-site-jp');
      if (customName) {
        document.querySelectorAll('.logo .word').forEach(function(el) {
          var jpSpan = el.querySelector('.jp');
          var jpText = jpSpan ? jpSpan.outerHTML : (customJp ? '<span class="jp">' + customJp + '</span>' : '');
          el.innerHTML = customName + (customJp ? '<span class="jp">' + customJp + '</span>' : jpText);
        });
      }
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyCustomLogo();
      applyCustomSiteName();
    });
  } else {
    applyCustomLogo();
    applyCustomSiteName();
  }

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

  lb.addEventListener('click', function(e) {
    if (e.target === lb || e.target.classList.contains('lb-caption')) {
      closeLb();
    }
  });
  // swallow scroll/touch gestures so they never reach the page behind
  lb.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  lb.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLb();
  });
})();
