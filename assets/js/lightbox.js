// Shared image viewer (lightbox) for any page with .photo-tile photos.
// Progressive enhancement: photos are fully visible without JS; this only adds
// the click-to-expand overlay. Used by photo-gallery.html and scholarship.html.
(() => {
  const tiles = Array.from(document.querySelectorAll(".photo-tile")).filter(
    (tile) => tile.querySelector("img")
  );
  if (!tiles.length) return;

  // Signal to CSS that tiles are now interactive (enables hover/zoom hints).
  document.documentElement.classList.add("js-lightbox");

  // Collect the photo set once, in document order, for prev/next navigation.
  const items = tiles.map((tile) => {
    const img = tile.querySelector("img");
    const caption = tile.querySelector(".photo-caption");
    return {
      tile,
      src: img.currentSrc || img.src,
      alt: img.getAttribute("alt") || "",
      captionHTML: caption ? caption.innerHTML : "",
    };
  });

  // Build the overlay once and reuse it.
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Image viewer");
  overlay.hidden = true;
  overlay.innerHTML = [
    '<button type="button" class="lightbox-close" data-lb-close aria-label="Close (Esc)">&times;</button>',
    '<button type="button" class="lightbox-nav lightbox-prev" data-lb-prev aria-label="Previous image">&#8249;</button>',
    '<figure class="lightbox-figure">',
    '  <img class="lightbox-img" alt="" />',
    '  <figcaption class="lightbox-caption"></figcaption>',
    "</figure>",
    '<button type="button" class="lightbox-nav lightbox-next" data-lb-next aria-label="Next image">&#8250;</button>',
    '<div class="lightbox-counter" aria-hidden="true"></div>',
  ].join("");
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector(".lightbox-img");
  const captionEl = overlay.querySelector(".lightbox-caption");
  const counterEl = overlay.querySelector(".lightbox-counter");
  const prevBtn = overlay.querySelector(".lightbox-prev");
  const nextBtn = overlay.querySelector(".lightbox-next");
  const closeBtn = overlay.querySelector(".lightbox-close");

  const multiple = items.length > 1;
  prevBtn.hidden = nextBtn.hidden = !multiple;
  counterEl.hidden = !multiple;

  let current = -1;
  let lastFocused = null;

  function render(i) {
    const item = items[i];
    imgEl.src = item.src;
    imgEl.alt = item.alt;
    captionEl.innerHTML = item.captionHTML;
    captionEl.hidden = !item.captionHTML;
    counterEl.textContent = `${i + 1} / ${items.length}`;
    overlay.setAttribute("aria-label", item.alt || "Image viewer");
  }

  function open(i) {
    current = i;
    lastFocused = document.activeElement;
    render(i);
    overlay.hidden = false;
    document.body.classList.add("lightbox-open");
    closeBtn.focus();
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    overlay.hidden = true;
    document.body.classList.remove("lightbox-open");
    document.removeEventListener("keydown", onKeydown);
    imgEl.removeAttribute("src");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function step(delta) {
    if (!multiple) return;
    current = (current + delta + items.length) % items.length;
    render(current);
  }

  function onKeydown(e) {
    switch (e.key) {
      case "Escape":
        close();
        break;
      case "ArrowRight":
        step(1);
        break;
      case "ArrowLeft":
        step(-1);
        break;
      case "Tab": {
        // Simple focus trap: keep focus on the overlay's controls.
        const focusable = Array.from(
          overlay.querySelectorAll("button:not([hidden])")
        );
        if (!focusable.length) break;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        break;
      }
    }
  }

  // Make each tile behave like a button that opens the viewer.
  items.forEach((item, i) => {
    const tile = item.tile;
    tile.setAttribute("role", "button");
    tile.setAttribute("tabindex", "0");
    if (!tile.hasAttribute("aria-label")) {
      tile.setAttribute("aria-label", `View larger: ${item.alt || "photo"}`);
    }
    tile.addEventListener("click", (e) => {
      // Let real links inside a tile behave normally.
      if (e.target.closest("a")) return;
      open(i);
    });
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(i);
      }
    });
  });

  // Delegate the overlay's own controls.
  overlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-lb-close]")) return close();
    if (e.target.closest("[data-lb-prev]")) return step(-1);
    if (e.target.closest("[data-lb-next]")) return step(1);
    // Click on the backdrop (outside the figure) closes.
    if (e.target === overlay) close();
  });
})();
