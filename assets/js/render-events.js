async function loadEvents() {
  const res = await fetch("assets/data/events.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load events.json");
  const events = await res.json();

  // sort by date asc
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function eventCard(ev) {
  const badge = `<span class="pill">${ev.type}</span>`;
  const link = ev.registrationUrl && ev.registrationUrl !== "#"
    ? `${ev.registrationUrl}Register</a>`
    : `get-involved.htmlHost / Sponsor</a>`;

  return `
    <article class="card event">
      <div class="event-top">
        ${badge}
        <h3>${ev.title}</h3>
        <p class="muted">${formatDate(ev.date)} • ${ev.time}</p>
      </div>
      <p>${ev.details}</p>
      <p class="tiny muted"><strong>${ev.venue}</strong> • ${ev.city}</p>
      <div class="event-actions">
        ${link}
        events.htmlDetails</a>
      </div>
    </article>
  `;
}

function eventCompact(ev) {
  return `
    <div class="next-event">
      <p class="pill">${ev.type}</p>
      <h3>${ev.title}</h3>
      <p class="muted">${formatDate(ev.date)} • ${ev.time}</p>
      <p class="tiny muted"><strong>${ev.venue}</strong> • ${ev.city}</p>
    </div>
  `;
}

(async () => {
  try {
    const events = await loadEvents();

    // HOME "next" preview
    const nextTarget = document.querySelector('[data-events-target="next"]');
    if (nextTarget) {
      const next = events.find(e => e.featured) || events[0];
      nextTarget.innerHTML = next ? eventCompact(next) : `<p class="muted">No events yet.</p>`;
    }

    // HOME list (subset)
    const listTarget = document.querySelector('[data-events-target="list"]');
    if (listTarget) {
      const subset = events.slice(0, 3);
      listTarget.innerHTML = subset.map(eventCard).join("");
    }

    // EVENTS page all
    const allTarget = document.querySelector('[data-events-target="all"]');
    if (allTarget) {
      allTarget.innerHTML = events.map(eventCard).join("");

      // filtering UI (only on events page)
      const search = document.getElementById("search");
      const type = document.getElementById("type");

      const apply = () => {
        const q = (search?.value || "").toLowerCase().trim();
        const t = (type?.value || "");

        const filtered = events.filter(ev => {
          const hay = `${ev.title} ${ev.venue} ${ev.city} ${ev.details}`.toLowerCase();
          const matchesQuery = !q || hay.includes(q);
          const matchesType = !t || ev.type === t;
          return matchesQuery && matchesType;
        });

        allTarget.innerHTML = filtered.length
          ? filtered.map(eventCard).join("")
          : `<p class="muted">No matching events.</p>`;
      };

      search?.addEventListener("input", apply);
      type?.addEventListener("change", apply);
    }
  } catch (err) {
    console.error(err);
  }
})();