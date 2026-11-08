/* Journal Club Psykiatri Malmö — v2
 * Reads the existing Google Sheet through the Apps Script endpoint and renders
 * the pages. All sheet text is inserted with textContent, never as HTML.
 */
(function () {
  "use strict";

  const CONFIG = {
    scriptURL: "https://script.google.com/macros/s/AKfycbwc2NQL5Kd1Zx5F-Rd8k4VGunhBWGg-WrykQqjtY8nVr9Zkby-U3tUwk7iTfEN9Nmr7ng/exec",
    sheets: { schedule: "Schema", archive: "Artiklar och Presentationer", tips: "Tips och inspiration" },
    teamsURL: "", // Lägg in Teams-länken här så visas knappen "Anslut via Teams"
    startTime: "13:00",
    endTime: "14:00",
    location: "Psykiatrihuset, Jan Waldenströms gata 6, Malmö (även via Teams)",
    cacheMinutes: 10,
  };

  /* ---------- Data loading (with short session cache) ---------- */
  async function fetchSheet(name) {
    const key = "jc:" + name;
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || "null");
      if (hit && Date.now() - hit.t < CONFIG.cacheMinutes * 60000) return hit.d;
    } catch (e) { /* storage unavailable */ }
    const res = await fetch(CONFIG.scriptURL + "?sheet=" + encodeURIComponent(name));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* ignore */ }
    return Array.isArray(data) ? data : [];
  }

  /* ---------- Cleaning helpers ---------- */
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, dec: 11 };
  const MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const MONTH_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
  const WEEKDAYS = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

  // Accepts "15 maj 2026", "28:e november 2025", "**KOMMANDE!** 9 jan 2026", "2026-01-09", ISO timestamps.
  function parseDate(value) {
    if (!value) return null;
    const s = String(value).toLowerCase();
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/(\d{1,2})(?::?e|:a)?\.?\s+([a-zåäö]{3,})\.?\s+(\d{4})/);
    if (m) {
      const mon = MONTHS[m[2].slice(0, 3)];
      if (mon !== undefined) return new Date(+m[3], mon, +m[1]);
    }
    m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }

  function clean(text) { return String(text || "").replace(/\s+/g, " ").trim(); }

  function cleanTitle(text) {
    const t = clean(text).replace(/\s*-\s*PubMed\s*$/i, "");
    return /^(tba|tbd|-|)$/i.test(t) ? "" : t;
  }

  function cleanURL(url) {
    let u = clean(url);
    if (!/^https?:\/\//i.test(u)) return "";
    try {
      const parsed = new URL(u);
      if (/safelinks\.protection\.outlook\.com$/i.test(parsed.hostname) && parsed.searchParams.get("url")) {
        u = parsed.searchParams.get("url");
      }
    } catch (e) { return ""; }
    return u;
  }

  function normKey(text) { return cleanTitle(text).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40); }

  function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function initials(name) {
    const parts = clean(name).split(" ").filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function fmtDate(d) { return d ? d.getDate() + " " + MONTH_SHORT[d.getMonth()] + " " + d.getFullYear() : ""; }
  function fmtLong(d) { return d ? d.getDate() + " " + MONTH_LONG[d.getMonth()] : ""; }

  function daysUntil(d) { return Math.round((d - today()) / 86400000); }

  function countdownText(d) {
    const n = daysUntil(d);
    if (n === 0) return "idag";
    if (n === 1) return "imorgon";
    return "om " + n + " dagar";
  }

  /* ---------- Model ---------- */
  function buildSessions(scheduleRows, archiveRows) {
    const archive = archiveRows.map((r) => ({
      date: parseDate(r.Datum),
      who: clean(r["Presentatör"]),
      title: cleanTitle(r.Artikeltitel),
      articleURL: cleanURL(r["Länk till artikel"]),
      slidesURL: cleanURL(r["Länk till presentation"]),
      slidesNote: cleanURL(r["Länk till presentation"]) ? "" : clean(r["Länk till presentation"]),
    }));
    const byTitle = new Map();
    archive.forEach((a) => { if (a.title) byTitle.set(normKey(a.title), a); });

    const schedule = scheduleRows.map((r) => {
      const s = { date: parseDate(r.Datum), who: clean(r["Presentatör"]), title: cleanTitle(r.Titel), articleURL: "", slidesURL: "", slidesNote: "" };
      const match = s.title && byTitle.get(normKey(s.title));
      if (match) {
        // The schedule's date wins; the archive tab supplies links.
        match.date = s.date || match.date;
        match.who = s.who || match.who;
        s.articleURL = match.articleURL;
        s.slidesURL = match.slidesURL;
        match.inSchedule = true;
      }
      return s;
    }).filter((s) => s.date);

    const t = today();
    const upcoming = schedule.filter((s) => s.date >= t).sort((a, b) => a.date - b.date);

    const pastFromSchedule = schedule.filter((s) => s.date < t && s.title && !byTitle.get(normKey(s.title)));
    const past = archive
      .filter((a) => a.title && (!a.date || a.date < t))
      .concat(pastFromSchedule)
      .sort((a, b) => (b.date || 0) - (a.date || 0));

    return { upcoming, past };
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => { if (c) node.append(c); });
    return node;
  }

  function extLink(href, label) {
    return el("a", { href, target: "_blank", rel: "noopener", text: label });
  }

  function linksFor(s) {
    const items = [];
    if (s.articleURL) items.push(extLink(s.articleURL, "Artikel"));
    if (s.slidesURL) items.push(extLink(s.slidesURL, "Bilder"));
    else if (s.date && s.date < today()) items.push(el("span", { class: "muted", text: "Bilder saknas" }));
    return items;
  }

  /* ---------- Calendar (.ics) ---------- */
  function icsFor(s) {
    const pad = (n) => String(n).padStart(2, "0");
    const day = s.date.getFullYear() + pad(s.date.getMonth() + 1) + pad(s.date.getDate());
    const t = (hhmm) => hhmm.replace(":", "") + "00";
    const esc = (v) => String(v).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const summary = "Journal Club: " + (s.title || "artikel meddelas") + (s.who ? " (" + s.who + ")" : "");
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Journal Club Psykiatri Malmo//SV",
      "BEGIN:VEVENT",
      "UID:jc-" + day + "@jillykid.github.io",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      "DTSTART;TZID=Europe/Stockholm:" + day + "T" + t(CONFIG.startTime),
      "DTEND;TZID=Europe/Stockholm:" + day + "T" + t(CONFIG.endTime),
      "SUMMARY:" + esc(summary),
      "LOCATION:" + esc(CONFIG.location),
      s.articleURL ? "URL:" + s.articleURL : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
  }

  function downloadICS(s) {
    const blob = new Blob([icsFor(s)], { type: "text/calendar;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "journal-club-" + fmtDate(s.date).replace(/ /g, "-") + ".ics" });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Home ---------- */
  function renderNext(s) {
    const card = document.getElementById("next-card");
    if (!card) return;
    const top = el("div", { class: "next-top" }, [
      el("span", { class: "eyebrow", text: "Nästa tillfälle" }),
      s ? el("span", { class: "countdown", text: countdownText(s.date) }) : null,
    ]);

    let body;
    if (!s) {
      body = el("div", { class: "next-body" }, [
        el("div", { class: "next-title pending", text: "Nästa datum meddelas snart." }),
        el("p", { class: "meta", style: "margin:0", text: "Journal Club hålls ungefär en gång i månaden i anslutning till ST-seminarier/APT, kl. 13–14. Under tiden finns alla tidigare artiklar i arkivet." }),
        el("div", { class: "btn-row" }, [el("a", { class: "btn btn-soft btn-sm", href: "arkiv.html", text: "Till arkivet" })]),
      ]);
    } else {
      const buttons = [];
      if (CONFIG.teamsURL) buttons.push(el("a", { class: "btn btn-coral btn-sm", href: CONFIG.teamsURL, target: "_blank", rel: "noopener", text: "Anslut via Teams" }));
      if (s.articleURL) buttons.push(el("a", { class: "btn btn-soft btn-sm", href: s.articleURL, target: "_blank", rel: "noopener", text: "Läs artikeln" }));
      buttons.push(el("button", { type: "button", class: "btn btn-soft btn-sm", text: "Lägg till i kalendern", onclick: () => downloadICS(s) }));

      body = el("div", { class: "next-body" }, [
        el("div", { class: "next-main" }, [
          el("div", { class: "date-tile", "aria-hidden": "true" }, [
            el("small", { text: WEEKDAYS[s.date.getDay()] }),
            el("strong", { text: String(s.date.getDate()) }),
            el("small", { text: MONTH_SHORT[s.date.getMonth()] }),
          ]),
          el("div", {}, [
            el("span", { class: "sr-only", text: WEEKDAYS[s.date.getDay()] + " " + fmtDate(s.date) }),
            el("h2", { class: "next-title" + (s.title ? "" : " pending"), text: s.title || "Artikel meddelas senare" }),
          ]),
        ]),
        el("div", { class: "person" }, [
          el("span", { class: "avatar", "aria-hidden": "true", text: initials(s.who) }),
          el("span", { class: "person-text" }, [
            el("strong", { text: s.who || "Presentatör meddelas" }),
            el("span", { class: "meta", text: "kl. " + CONFIG.startTime.replace(":00", "") + "–" + CONFIG.endTime.replace(":00", "") + " · Psykiatrihuset & Teams" }),
          ]),
        ]),
        el("div", { class: "btn-row" }, buttons),
      ]);
    }
    card.replaceChildren(top, body);
  }

  function renderUpcoming(list) {
    const box = document.getElementById("upcoming");
    if (!box) return;
    if (!list.length) {
      box.replaceChildren(el("div", { class: "card empty" }, [
        el("span", { class: "card-title", text: "Inga fler datum inlagda ännu" }),
        el("span", { class: "meta", text: "Vill du presentera? Hör av dig till arrangörerna." }),
      ]));
      return;
    }
    box.replaceChildren(...list.map((s) => {
      if (!s.who) {
        return el("div", { class: "card open" }, [
          el("span", { class: "card-date", text: fmtLong(s.date) }),
          el("strong", { style: "color: var(--coral-ink)", text: "Ledig plats" }),
          el("span", { class: "meta", style: "color:#5A3A30", text: "Vill du presentera? Hör av dig till arrangörerna." }),
        ]);
      }
      return el("div", { class: "card" }, [
        el("span", { class: "card-date", text: fmtLong(s.date) }),
        el("span", { class: "card-title", text: s.title || "Artikel meddelas senare" }),
        el("span", { class: "person-sm" }, [el("span", { class: "avatar avatar-sm", "aria-hidden": "true", text: initials(s.who) }), document.createTextNode(s.who)]),
      ]);
    }));
  }

  function archiveCard(s) {
    return el("article", { class: "card" }, [
      el("span", { class: "chip chip-green", text: fmtDate(s.date) || "Datum saknas" }),
      el("h3", { class: "card-title big", text: s.title }),
      el("span", { class: "meta", text: s.who }),
      el("span", { class: "card-links" }, linksFor(s)),
    ]);
  }

  async function initHome() {
    try {
      const [schedule, archive] = await Promise.all([fetchSheet(CONFIG.sheets.schedule), fetchSheet(CONFIG.sheets.archive)]);
      const { upcoming, past } = buildSessions(schedule, archive);
      renderNext(upcoming[0] || null);
      renderUpcoming(upcoming.slice(1));
      const recent = document.getElementById("recent");
      if (recent) recent.replaceChildren(...past.slice(0, 3).map(archiveCard));
    } catch (e) {
      console.error(e);
      ["next-card", "upcoming", "recent"].forEach((id) => {
        const n = document.getElementById(id);
        if (n) n.replaceChildren(el("p", { class: "notice", style: "padding:24px;margin:0", text: "Kunde inte hämta schemat just nu. Försök igen om en stund." }));
      });
    }
  }

  /* ---------- Archive ---------- */
  async function initArchive() {
    const listNode = document.getElementById("archive-list");
    const filterNode = document.getElementById("year-filters");
    const search = document.getElementById("archive-search");
    const count = document.getElementById("archive-count");
    let items = [];
    let year = "alla";

    function draw() {
      const q = clean(search.value).toLowerCase();
      const shown = items.filter((s) =>
        (year === "alla" || (s.date && String(s.date.getFullYear()) === year)) &&
        (!q || (s.title + " " + s.who).toLowerCase().includes(q)));
      count.textContent = shown.length + (shown.length === 1 ? " artikel" : " artiklar");
      if (!shown.length) {
        listNode.replaceChildren(el("li", { class: "archive-item notice", text: "Inga träffar." }));
        return;
      }
      listNode.replaceChildren(...shown.map((s) => el("li", { class: "archive-item" }, [
        el("span", { class: "archive-date", text: fmtDate(s.date) || "—" }),
        el("span", { class: "archive-main" }, [
          el("span", { class: "card-title", text: s.title }),
          el("span", { class: "person-sm" }, [el("span", { class: "avatar avatar-sm", "aria-hidden": "true", text: initials(s.who) }), document.createTextNode(s.who)]),
        ]),
        el("span", { class: "archive-links" }, linksFor(s)),
      ])));
    }

    try {
      const [schedule, archive] = await Promise.all([fetchSheet(CONFIG.sheets.schedule), fetchSheet(CONFIG.sheets.archive)]);
      items = buildSessions(schedule, archive).past;
      const years = Array.from(new Set(items.filter((s) => s.date).map((s) => String(s.date.getFullYear())))).sort().reverse();
      const buttons = ["alla"].concat(years).map((y) => el("button", {
        type: "button", class: "filter", "aria-pressed": String(y === year), text: y === "alla" ? "Alla" : y,
        onclick: (ev) => {
          year = y;
          filterNode.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b === ev.currentTarget)));
          draw();
        },
      }));
      filterNode.replaceChildren(...buttons);
      search.addEventListener("input", draw);
      draw();
    } catch (e) {
      console.error(e);
      listNode.replaceChildren(el("li", { class: "archive-item notice", text: "Kunde inte hämta arkivet just nu. Försök igen om en stund." }));
    }
  }

  /* ---------- Tips ---------- */
  async function initTips() {
    const box = document.getElementById("tips-list");
    try {
      const rows = (await fetchSheet(CONFIG.sheets.tips)).slice().reverse();
      if (!rows.length) { box.replaceChildren(el("p", { class: "notice", text: "Inga tips än – bli först!" })); return; }
      box.replaceChildren(...rows.map((r) => {
        const url = cleanURL(r["Länk"]);
        const title = clean(r.Titel) || "Tips";
        return el("article", { class: "card" }, [
          r.Kategori ? el("span", { class: "chip chip-green", text: clean(r.Kategori) }) : null,
          el("h3", { class: "card-title big" }, [url ? extLink(url, title) : document.createTextNode(title)]),
          clean(r.Kommentar) ? el("p", { style: "margin:0", text: clean(r.Kommentar) }) : null,
          el("span", { class: "tip-meta", text: [clean(r.Namn) || "Anonym", fmtDate(parseDate(r.Datum)) || clean(r.Datum)].filter(Boolean).join(" · ") }),
        ]);
      }));
    } catch (e) {
      console.error(e);
      box.replaceChildren(el("p", { class: "notice", text: "Kunde inte hämta tips just nu." }));
    }
  }

  const page = document.body.dataset.page;
  if (page === "home") initHome();
  if (page === "archive") initArchive();
  if (page === "tips") initTips();
})();
