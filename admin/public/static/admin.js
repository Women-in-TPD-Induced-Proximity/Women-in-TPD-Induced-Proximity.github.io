// Progressive enhancement for the admin portal. Every form works without
// this file; it adds confirmations, a list filter, and shrinks photos in the
// browser before upload (the Worker has no image library, and the review
// queue stores photos in D1, whose rows are capped at ~2 MB).

document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

const filter = document.querySelector('[data-filter]');
if (filter) {
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    document.querySelectorAll('.item').forEach((li) => {
      li.hidden = q !== '' && !li.dataset.text.includes(q);
    });
  });
}

async function shrink(file, maxSide) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  // Already small: keep the original bytes (and format).
  if (scale === 1 && file.size < 600_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

document.querySelectorAll('input[type=file][data-resize]').forEach((input) => {
  const preview = document.createElement('figure');
  preview.className = 'upload-preview';
  input.after(preview);
  input.addEventListener('change', async () => {
    preview.textContent = '';
    const file = input.files[0];
    if (!file) return;
    const form = input.form;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const small = await shrink(file, Number(input.dataset.resize) || 1600);
      if (small !== file) {
        const dt = new DataTransfer();
        dt.items.add(small);
        input.files = dt.files;
      }
      const img = document.createElement('img');
      img.src = URL.createObjectURL(small);
      img.alt = '';
      const cap = document.createElement('figcaption');
      cap.textContent = `${small.name} · ${Math.round(small.size / 1024)} KB`;
      preview.append(img, cap);
    } catch {
      // Unreadable in this browser (e.g. HEIC): send it as-is and let the
      // server's type check explain.
    } finally {
      button.disabled = false;
    }
  });
});
