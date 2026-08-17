// Shared list sorter for any page carrying a <select data-sort-target="…">.
// Progressive enhancement: every list is already authored in a sensible order,
// so this only adds the ability to reorder it in the browser. The control stays
// hidden until this runs (see the .sort-bar rules in styles.css).
//
// Markup contract:
//   <select class="sort-select" data-sort-target=".pub-list">
//     <option value="date:desc">Newest first</option>   <!-- key:direction -->
//     <option value="default">Featured order</option>   <!-- authored order -->
//   </select>
//   …and each item in the target carries data-sort-<key> attributes.
//
// data-sort-target may match several containers (e.g. every DicTACtionary
// section); each is sorted independently, so section grouping survives.
(() => {
  const selects = Array.from(
    document.querySelectorAll("select[data-sort-target]")
  );
  if (!selects.length) return;

  // Signal to CSS that the controls are live.
  document.documentElement.classList.add("js-sort");

  const NUMERIC = /^-?\d+(\.\d+)?$/;

  // ISO dates (YYYY-MM-DD) and zero-padded numbers compare correctly as text,
  // so only genuinely numeric keys need the numeric branch.
  const compare = (a, b) => {
    if (NUMERIC.test(a) && NUMERIC.test(b)) return parseFloat(a) - parseFloat(b);
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  };

  selects.forEach((select) => {
    const containers = Array.from(
      document.querySelectorAll(select.dataset.sortTarget)
    );
    if (!containers.length) return;

    // The authored order is both the "default" option and the tiebreaker that
    // keeps every other sort stable.
    const authored = new Map(
      containers.map((container) => [container, Array.from(container.children)])
    );

    const apply = (value) => {
      const [key, dir] = value.split(":");
      const flip = dir === "desc" ? -1 : 1;

      containers.forEach((container) => {
        const items = authored.get(container).slice();

        if (key !== "default") {
          const rank = new Map(items.map((el, i) => [el, i]));
          items.sort((a, b) => {
            const av = (a.getAttribute("data-sort-" + key) || "").trim();
            const bv = (b.getAttribute("data-sort-" + key) || "").trim();
            // Items with no value for this key sort last in BOTH directions —
            // a conference with a TBA date shouldn't lead the list just
            // because the order flipped.
            if (!av !== !bv) return av ? -1 : 1;
            const cmp = av && bv ? compare(av, bv) : 0;
            return cmp ? cmp * flip : rank.get(a) - rank.get(b);
          });
        }

        // Re-append in one go; moving existing nodes preserves their state
        // (e.g. the hidden attribute a search filter set on them).
        const frag = document.createDocumentFragment();
        items.forEach((el) => frag.appendChild(el));
        container.appendChild(frag);
      });
    };

    select.addEventListener("change", () => apply(select.value));
    // Browsers restore a <select>'s value across a reload, so honour whatever
    // is selected now rather than assuming the first option is active.
    apply(select.value);
  });
})();
