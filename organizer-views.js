// organizer-views.js — bkk festival organizer views (certificates + program planning).
// Injected into /admin-entries via CDP evaluate; idempotent (re-inject replaces the UI).
// Read-only against the DB: fetches the three admin data endpoints fresh on every
// load/refresh; planning day-assignments persist in localStorage only.
globalThis.__bkkOrganizerViewsBoot = async function boot() {
  "use strict";
  const ROOT_ID = "bkk-organizer-views";
  const DAYS_KEY = "bkk_plan_days_v1";
  const ENDPOINTS = {
    entries: "blk_4963fa51e0e44103",
    entrants: "blk_993cfd14c332cc88",
    schools: "blk_71392f0f5279d5d0",
    members: "blk_816146243d4910d9",
  };
  const FESTIVAL_DAYS = (() => {
    const days = [];
    for (let d = 15; d <= 21; d++) {
      const date = new Date(Date.UTC(2026, 7, d));
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
      days.push({ id: "D" + (d - 14), label: wd + " " + d + " Aug" });
    }
    return days;
  })();

  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(ROOT_ID + "-pill")?.remove();
  document.body.style.marginTop = "";

  const base = localStorage.getItem("ls_web_token_cloud");
  const token = localStorage.getItem("ls_web_token");
  const tokenExp = Number(localStorage.getItem("ls_web_token_exp") || 0);
  const tokenExpired = tokenExp > 0 && tokenExp * (tokenExp < 1e12 ? 1000 : 1) < Date.now();
  if (!base || !token || tokenExpired) {
    if (confirm("organizer-views: admin session " + (tokenExpired ? "expired" : "missing") + " — go to sign-in now?")) {
      location.href = "/signin?backTo=" + encodeURIComponent(location.pathname);
    }
    return;
  }

  async function fetchBlock(key) {
    const r = await fetch(base + "/api/dt-block/" + key, { headers: { "x-ls-web-token": token } });
    if (!r.ok) throw new Error("fetch " + key + " -> " + r.status);
    return (await r.json()).data;
  }

  const [entriesRaw, entrantsRaw, schoolsRaw, membersRaw] = await Promise.all([
    fetchBlock(ENDPOINTS.entries),
    fetchBlock(ENDPOINTS.entrants),
    fetchBlock(ENDPOINTS.schools),
    fetchBlock(ENDPOINTS.members),
  ]);
  // Phone is NOT in any LS collection — it comes from a once-off 12s CRM
  // harvest stored per-origin (contact_id -> phone). Empty map = column blank.
  const phoneByContact = (() => {
    try {
      return JSON.parse(localStorage.getItem("bkk_phone_map_v1") || "{}");
    } catch {
      return {};
    }
  })();
  const memberById = new Map(membersRaw.map((m) => [String(m.values.id), m.values]));

  const entrantById = new Map(entrantsRaw.map((r) => [r.id, r.values]));
  const schoolById = new Map(schoolsRaw.map((r) => [r.id, r.values]));
  const schoolName = (id) => (id && schoolById.get(id) ? schoolById.get(id).name : "");

  // picklist_label is an i18n object with MIXED key conventions across
  // picklists: {af, en} on some, {afr, eng} on others. Afrikaans preferred,
  // except dance items which are always English.
  function localized(v, pref = "af") {
    if (v && typeof v === "object") {
      const order = pref === "en" ? ["en", "eng", "af", "afr"] : ["af", "afr", "en", "eng"];
      for (const k of order) if (v[k] != null) return v[k];
      return Object.values(v)[0] ?? "";
    }
    return v ?? "";
  }
  // grade_ord: -2 = Gr RR, -1 = Gr R, 0-12 = numeric grades.
  function gradeLabel(ord) {
    if (ord == null || ord === "") return "";
    if (ord === -2) return "RR";
    if (ord === -1) return "R";
    return String(ord);
  }

  function entrantIdList(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  }

  // Name fields follow each entry's locale (Dans vs Dance, Individueel vs
  // Individual), so views group by the id and show one merged label per id.
  function mergedLabelMap(idKey, nameKey) {
    const names = new Map();
    for (const rec of entriesRaw) {
      const v = rec.values;
      if (!v[idKey] || !v[nameKey]) continue;
      if (!names.has(v[idKey])) names.set(v[idKey], new Set());
      names.get(v[idKey]).add(v[nameKey]);
    }
    return new Map([...names.entries()].map(([id, s]) => [id, [...s].sort().join(" / ")]));
  }
  const divisionLabel = mergedLabelMap("division_id", "division_name");
  const categoryLabel = mergedLabelMap("category_id", "category_name");
  const variantLabel = mergedLabelMap("variant_id", "variant_name");
  const classLabel = mergedLabelMap("class_id", "class_name");

  // Organizer-ruled duplicates: excluded from all views (reason lives in the
  // entry's own notes field).
  const IGNORED_ENTRIES = new Set(["E-000679"]);

  // Certificate rows: one per entrant per entry; group entries (members stripped
  // server-side) collapse to a single flagged group_name row.
  const certRows = [];
  for (const rec of entriesRaw) {
    const v = rec.values;
    if (IGNORED_ENTRIES.has(v.entry_number)) continue;
    const ids = entrantIdList(v.entrant_ids);
    const paid = Boolean(v._invoice_number);
    const common = {
      entryId: rec.id,
      entryNo: v.entry_number || "",
      division: divisionLabel.get(v.division_id) ?? (v.division_name || ""),
      category: categoryLabel.get(v.category_id) ?? (v.category_name || ""),
      klass: classLabel.get(v.class_id) ?? (v.class_name || ""),
      variant: variantLabel.get(v.variant_id) ?? (v.variant_name || ""),
      divisionRaw: v.division_name || "",
      categoryRaw: v.category_name || "",
      klassRaw: v.class_name || "",
      affiliate: v.affiliate_name || "",
      item: localized(v.picklist_label, /dans|dance/i.test(v.division_name || "") ? "en" : "af") ||
        localized(v.picklist_value),
      title: typeof v.title === "string" ? v.title : "",
      invoice: v._invoice_number || "",
      paid,
      memberId: v.member_id != null ? String(v.member_id) : "",
      memberEmail: memberById.get(String(v.member_id))?.email ?? "",
      memberPhone: phoneByContact[String(memberById.get(String(v.member_id))?.contact_id ?? "")] ?? "",
      participants: v.participants_count != null ? v.participants_count : "",
    };
    // One row per ENTRY. Duet/trio: all names on the one certificate, Qty_A4 =
    // number of exact copies. Group: group_name master cert.
    const members = ids.map((id) => entrantById.get(id)).filter(Boolean);
    const names = ids.map((id) => {
      const e = entrantById.get(id);
      return e
        ? ((e.first_name || "") + " " + (e.last_name || "")).trim()
        : "(unknown entrant " + id.slice(0, 8) + ")";
    });
    const joinedNames = names.length > 1
      ? names.slice(0, -1).join(", ") + " & " + names[names.length - 1]
      : (names[0] ?? "");
    const isGroup = ids.length === 0 && Boolean(v.group_name);
    certRows.push({
      ...common,
      first: isGroup
        ? v.group_name
        : (joinedNames || ((v.entrant_first_name || "") + " " + (v.entrant_last_name || "")).trim()),
      last: "",
      school: [...new Set(members.map((e) => schoolName(e.school_id)).filter(Boolean))].join(", "),
      grade: [...new Set(members.map((e) => gradeLabel(e.grade_ord)).filter(Boolean))].join(", "),
      isGroup,
      nMembers: ids.length,
    });
  }

  // Blank titles are acceptable (they print blank on the certificate); only flag
  // titles whose CONTENT looks wrong.
  function titleSuspicion(row) {
    const tl = row.title.trim().toLowerCase();
    if (tl === "") return "";
    if (tl === (row.first + " " + row.last).trim().toLowerCase()) return "name-as-title";
    if (tl === row.category.trim().toLowerCase() || tl === row.division.trim().toLowerCase()) return "category-as-title";
    if (/^(test|toets|123|n\/?a|x+|\?|\.+|-+)$/i.test(tl)) return "placeholder";
    return "";
  }
  for (const row of certRows) row.suspect = titleSuspicion(row);

  // FE-derived certificate columns, computed from the snapshot/join data.
  // Extend here: key = exact CSV header, value = fn(row) -> cell text.
  // Qty assumption (editable): individuals get one A4 each, groups one A5.
  const CERT_DERIVED = {
    Certificate_Name: (r) => (r.isGroup ? r.first : (r.first + " " + r.last).trim()),
    Certificate_Title: (r) => r.title.trim(),
    Qty_A4: (r) => (r.isGroup ? 1 : Math.max(1, r.nMembers)),
    Qty_A5: (r) => (r.isGroup ? "" : 0),
    Participants: (r) => r.participants,
    // Cer_* columns are certificate-print-ready: the ENTRY's own stored locale
    // (no merged "x / y" labels), item capitalized.
    // School + Affiliate, deduped: both only when genuinely different.
    // Placeholder affiliates ("No Affiliate", "Privaat", test rows) never print.
    Cer_School: (r) => {
      const parts = [];
      for (const x of [r.school, r.affiliate]) {
        const t = (x ?? "").trim();
        if (!t || /^(no affiliate|privaat|postfix)/i.test(t)) continue;
        if (!parts.some((p) => p.toLowerCase() === t.toLowerCase())) parts.push(t);
      }
      return parts.join(", ");
    },
    Cer_Division: (r) => r.divisionRaw,
    Cer_Item: (r) => [r.categoryRaw, r.item ? r.item[0].toUpperCase() + r.item.slice(1) : ""].filter(Boolean).join(" – "),
    Cer_Level: (r) => r.klassRaw || (r.grade ? "Gr " + r.grade : ""),
  };
  // Whitespace-sanitize every derived value: collapse runs, trim ends.
  for (const row of certRows) {
    for (const [key, fn] of Object.entries(CERT_DERIVED)) {
      row[key] = String(fn(row) ?? "").replace(/\s+/g, " ").trim();
    }
  }

  // Planning pivot: school x division entry/entrant counts off the same cert rows.
  const dayAssign = (() => {
    try {
      return JSON.parse(localStorage.getItem(DAYS_KEY) || "{}");
    } catch {
      return {};
    }
  })();
  const saveDays = () => localStorage.setItem(DAYS_KEY, JSON.stringify(dayAssign));

  const divisions = [...new Set(certRows.map((r) => r.division).filter(Boolean))].sort();
  const planBySchool = new Map();
  for (const row of certRows) {
    // Mixed-school duets list under each school — both need the entry present.
    const keys = row.school ? row.school.split(", ") : ["(no school / groups)"];
    const headCount = row.nMembers || Number(row.participants) || (row.isGroup ? 0 : 1);
    for (const key of keys) {
      if (!planBySchool.has(key)) {
        planBySchool.set(key, { school: key, entries: new Set(), entrants: 0, perDiv: {} });
      }
      const p = planBySchool.get(key);
      p.entries.add(row.entryId);
      p.entrants += headCount;
      if (row.division) {
        if (!p.perDiv[row.division]) p.perDiv[row.division] = new Set();
        p.perDiv[row.division].add(row.entryId);
      }
    }
  }
  const planRows = [...planBySchool.values()].sort((a, b) => a.school.localeCompare(b.school));

  // ---------- UI ----------
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
<style>
#${ROOT_ID}{position:fixed;inset:0;z-index:999999;background:#fff;color:#222;font:13px/1.45 system-ui,sans-serif;display:flex;flex-direction:column}
#${ROOT_ID}.pagemode{bottom:auto}
#${ROOT_ID}.pagemode .bar,#${ROOT_ID}.pagemode .body{display:none}
#${ROOT_ID} header{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#22333b;color:#fff;flex-wrap:wrap}
#${ROOT_ID} header b{font-size:15px}
#${ROOT_ID} .tab{cursor:pointer;padding:5px 12px;border-radius:5px;background:#3c4f58}
#${ROOT_ID} .tab.on{background:#e07a5f}
#${ROOT_ID} .bar{display:flex;gap:10px;align-items:center;padding:8px 14px;background:#f2f2f2;flex-wrap:wrap}
#${ROOT_ID} .body{flex:1;overflow:auto;padding:0 14px 20px}
#${ROOT_ID} table{border-collapse:collapse;width:100%;margin-top:8px}
#${ROOT_ID} th,#${ROOT_ID} td{border:1px solid #ddd;padding:3px 7px;text-align:left;white-space:nowrap}
#${ROOT_ID} th{position:sticky;top:0;background:#22333b;color:#fff;cursor:pointer}
#${ROOT_ID} tr.cfilters th{top:25px;background:#e9e6e0;cursor:default;padding:2px 4px}
#${ROOT_ID} tr.cfilters select,#${ROOT_ID} tr.cfilters input{display:block;width:100%;min-width:70px;box-sizing:border-box;font-size:11px;margin:1px 0;color:#222}
#${ROOT_ID} tr.grp{background:#fdf3e7}
#${ROOT_ID} tr.sus{background:#fde8e8}
#${ROOT_ID} .btn{cursor:pointer;padding:5px 12px;border:0;border-radius:5px;background:#4a7c59;color:#fff;font:inherit}
#${ROOT_ID} .btn.gray{background:#666}
#${ROOT_ID} select{font:inherit;padding:2px}
#${ROOT_ID} .sum{font-weight:600;margin-left:auto}
#${ROOT_ID} .daytotals{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;font-weight:600}
#${ROOT_ID} .lnk{color:#1a6fb5;text-decoration:underline;cursor:pointer}
</style>
<header>
  <b>BKK Organizer Views</b>
  <span class="tab" data-tab="cert">Certificates</span>
  <span class="tab" data-tab="plan">Planning</span>
  <button class="btn gray" id="ov-refresh">Refresh data</button>
  <button class="btn gray" id="ov-page">Show page</button>
  <button class="btn gray" id="ov-close">Close</button>
  <span class="sum" id="ov-sum"></span>
</header>
<div class="bar" id="ov-bar"></div>
<div class="body" id="ov-body"></div>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const bar = $("#ov-bar");
  const body = $("#ov-body");
  const state = { tab: "cert", paidOnly: true, suspectsOnly: false, search: "", colFilters: {} };

  function csvDownload(filename, headerCells, rowCells) {
    const esc = (x) => '"' + String(x ?? "").replaceAll('"', '""') + '"';
    const lines = [headerCells.map(esc).join(",")];
    for (const r of rowCells) lines.push(r.map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const today = new Date().toISOString().slice(0, 10);

  function certFiltered() {
    return certRows.filter((r) =>
      (!state.paidOnly || r.paid) &&
      (!state.suspectsOnly || r.suspect) &&
      (!state.search ||
        (r.first + " " + r.last + " " + r.school + " " + r.title + " " + r.entryNo)
          .toLowerCase().includes(state.search)) &&
      Object.entries(state.colFilters).every(([k, f]) => {
        const v = String(r[k] ?? "");
        if (f.sel && v.trim() !== f.sel) return false;
        if (f.txt && !v.toLowerCase().includes(f.txt)) return false;
        return true;
      })
    );
  }

  const CERT_COLS = [
    ...Object.keys(CERT_DERIVED).map((k) => [k, k]),
    ["entryNo", "E#"], ["memberId", "Member"], ["memberEmail", "Member_Email"],
    ["memberPhone", "Member_Phone"], ["invoice", "Invoice"], ["suspect", "Title_Flag"],
  ];
  let certSort = { key: "school", dir: 1 };

  // E# opens the admin block's entry drawer; Member opens its member modal.
  // Both links only work for rows with an E# (the block search targets it).
  function certCell(r, key) {
    const val = String(r[key] ?? "");
    if (key === "entryNo" && val) return `<a class="lnk" data-open="entry" data-e="${val}">${val}</a>`;
    if (key === "memberId" && val && r.entryNo) return `<a class="lnk" data-open="member" data-e="${r.entryNo}">${val}</a>`;
    return val;
  }

  // The page's .grid-content (z-index:2) traps the drawer/modal in a low
  // stacking context, so they can never paint above this overlay. Instead:
  // hide the overlay while the drawer/modal is open and restore it the moment
  // it closes — view state (filters, sort, expansions) is untouched.
  function openInAdminBlock(entryNo, what) {
    const blockRoot = document.getElementById("dt-block-blk_4963fa51e0e44103")?.shadowRoot;
    if (!blockRoot) return;
    const search = blockRoot.querySelector(".dt-adm-search");
    search.value = entryNo;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => {
      const td = [...blockRoot.querySelectorAll(".dt-admin-table tbody td")]
        .find((t) => t.textContent.trim() === entryNo);
      if (!td) return;
      const target = what === "member" ? td.parentElement.querySelector(".dt-adm-link") : td;
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      root.style.display = "none";
      const isOpen = () => {
        const d = blockRoot.querySelector(".dt-adm-drawerwrap");
        const m = blockRoot.querySelector(".dt-adm-modal");
        return (d && d.classList.contains("open")) || (m && m.offsetHeight > 0);
      };
      setTimeout(() => {
        const iv = setInterval(() => {
          if (!isOpen()) {
            clearInterval(iv);
            root.style.display = "flex";
          }
        }, 250);
      }, 400);
    }, 700);
  }

  const escAttr = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

  // Header re-renders only on full renderCert; filter/sort changes update the
  // tbody alone so typing in a column search never loses focus.
  function renderCert() {
    bar.innerHTML = `
<label><input type="checkbox" id="f-paid" ${state.paidOnly ? "checked" : ""}> Paid only</label>
<label><input type="checkbox" id="f-sus" ${state.suspectsOnly ? "checked" : ""}> Title flags only</label>
<input id="f-search" placeholder="search all…" value="${escAttr(state.search)}" style="font:inherit;padding:3px 6px;width:180px">
<button class="btn gray" id="ov-clear-filters">Clear filters</button>
<button class="btn" id="ov-export-cert">Export CSV (Excel)</button>`;
    $("#f-paid").onchange = (e) => { state.paidOnly = e.target.checked; updateCertRows(); };
    $("#f-sus").onchange = (e) => { state.suspectsOnly = e.target.checked; updateCertRows(); };
    $("#f-search").oninput = (e) => { state.search = e.target.value.toLowerCase(); updateCertRows(); };
    $("#ov-clear-filters").onclick = () => {
      state.colFilters = {};
      state.search = "";
      renderCert();
    };
    $("#ov-export-cert").onclick = () => {
      const rows = certVisibleRows();
      csvDownload("bkk-certificates-" + today + ".csv", CERT_COLS.map((c) => c[1]),
        rows.map((r) => CERT_COLS.map((c) => r[c[0]])));
    };

    const distinct = {};
    for (const c of CERT_COLS) {
      const set = new Set();
      for (const r of certRows) {
        const v = String(r[c[0]] ?? "").trim();
        if (v) set.add(v);
      }
      distinct[c[0]] = [...set].sort((a, b) => a.localeCompare(b, "af", { numeric: true }));
    }
    body.innerHTML = `<table><thead><tr>${
      CERT_COLS.map((c) => `<th data-k="${c[0]}">${c[1]}</th>`).join("")
    }</tr><tr class="cfilters">${
      CERT_COLS.map((c) => {
        const f = state.colFilters[c[0]] ?? {};
        return `<th><select data-fsel="${c[0]}"><option value="">(all)</option>${
          distinct[c[0]].map((v) => `<option value="${escAttr(v)}" ${f.sel === v ? "selected" : ""}>${escAttr(v)}</option>`).join("")
        }</select><input data-ftxt="${c[0]}" placeholder="search" value="${escAttr(f.txt ?? "")}"></th>`;
      }).join("")
    }</tr></thead><tbody></tbody></table>`;
    body.querySelectorAll("thead tr:first-child th").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        certSort = { key: k, dir: certSort.key === k ? -certSort.dir : 1 };
        updateCertRows();
      };
    });
    body.querySelectorAll("[data-fsel]").forEach((sel) => {
      sel.onchange = () => {
        const k = sel.dataset.fsel;
        state.colFilters[k] = { ...state.colFilters[k], sel: sel.value };
        updateCertRows();
      };
    });
    body.querySelectorAll("[data-ftxt]").forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.ftxt;
        state.colFilters[k] = { ...state.colFilters[k], txt: inp.value.toLowerCase() };
        updateCertRows();
      };
    });
    updateCertRows();
  }

  function certVisibleRows() {
    return certFiltered().slice().sort((a, b) => {
      const va = String(a[certSort.key] ?? ""), vb = String(b[certSort.key] ?? "");
      return va.localeCompare(vb, "af", { numeric: true }) * certSort.dir;
    });
  }

  function updateCertRows() {
    const rows = certVisibleRows();
    body.querySelectorAll("thead tr:first-child th").forEach((th) => {
      const c = CERT_COLS.find((x) => x[0] === th.dataset.k);
      th.textContent = c[1] + (certSort.key === c[0] ? (certSort.dir > 0 ? " ▲" : " ▼") : "");
    });
    body.querySelector("tbody").innerHTML = rows.map((r) =>
      `<tr class="${r.isGroup ? "grp" : ""}${r.suspect ? " sus" : ""}">${
        CERT_COLS.map((c) => `<td>${certCell(r, c[0])}</td>`).join("")
      }</tr>`).join("");
    body.querySelectorAll("tbody [data-open]").forEach((a) => {
      a.onclick = () => openInAdminBlock(a.dataset.e, a.dataset.open);
    });
    const nGroups = rows.filter((r) => r.isGroup).length;
    const nSus = rows.filter((r) => r.suspect).length;
    $("#ov-sum").textContent =
      rows.length + " certificate rows (" + nGroups + " groups without members, " + nSus + " title flags)";
  }

  // Per-school drill-down: one line per entry, with the same drawer/modal links
  // as the certificate view — the two are available from every view.
  const planExpanded = new Set();
  function schoolEntryRows(schoolKey) {
    const seen = new Set();
    const out = [];
    for (const r of certRows) {
      const key = r.school || "(no school / groups)";
      if (key !== schoolKey || seen.has(r.entryId)) continue;
      seen.add(r.entryId);
      const names = certRows.filter((x) => x.entryId === r.entryId)
        .map((x) => x.Certificate_Name).join(", ");
      out.push({ ...r, names });
    }
    return out;
  }
  function planExpansionHtml(schoolKey, colspan) {
    const rows = schoolEntryRows(schoolKey);
    return `<tr><td colspan="${colspan}" style="padding:6px 12px;background:#f8f6f2">
<table style="width:auto">${
      rows.map((r) =>
        `<tr><td>${certCell(r, "entryNo") || "(unpaid)"}</td><td>${r.names}</td><td>${r.division}</td><td>${r.category}</td><td>${certCell(r, "memberId")}</td></tr>`).join("")
    }</table></td></tr>`;
  }

  function renderPlan() {
    bar.innerHTML = `<span>Assign each school to a day — totals recompute instantly. Stored locally (localStorage), not in the DB.</span>
<button class="btn" id="ov-export-plan">Export CSV (Excel)</button>
<button class="btn gray" id="ov-clear-days">Reset days</button>`;
    $("#ov-clear-days").onclick = () => {
      for (const k of Object.keys(dayAssign)) delete dayAssign[k];
      saveDays();
      renderPlan();
    };
    $("#ov-export-plan").onclick = () =>
      csvDownload("bkk-planning-" + today + ".csv",
        ["School", "Day", "Entries", "Participants", ...divisions],
        planRows.map((p) => [
          p.school,
          FESTIVAL_DAYS.find((d) => d.id === dayAssign[p.school])?.label ?? "",
          p.entries.size, p.entrants,
          ...divisions.map((d) => p.perDiv[d] ? p.perDiv[d].size : 0),
        ]));

    const totals = FESTIVAL_DAYS.map((d) => {
      const schools = planRows.filter((p) => dayAssign[p.school] === d.id);
      return {
        day: d,
        schools: schools.length,
        entries: schools.reduce((s, p) => s + p.entries.size, 0),
        entrants: schools.reduce((s, p) => s + p.entrants, 0),
      };
    });
    const unassigned = planRows.filter((p) => !dayAssign[p.school]).length;
    $("#ov-sum").textContent = planRows.length + " schools, " + unassigned + " unassigned";

    body.innerHTML = `<div class="daytotals">${
      totals.map((t) =>
        `<span>${t.day.label}: ${t.schools} schools / ${t.entries} entries / ${t.entrants} participants</span>`).join("")
    }</div>
<table><thead><tr><th>School</th><th>Day</th><th>Entries</th><th>Participants</th>${
      divisions.map((d) => `<th>${d}</th>`).join("")
    }</tr></thead><tbody>${
      planRows.map((p) =>
        `<tr><td><span class="lnk" data-expand="${p.school.replaceAll('"', "&quot;")}">${p.school}</span></td><td><select data-school="${p.school.replaceAll('"', "&quot;")}">
<option value="">— day —</option>${
          FESTIVAL_DAYS.map((d) => `<option value="${d.id}" ${dayAssign[p.school] === d.id ? "selected" : ""}>${d.label}</option>`).join("")
        }</select></td><td>${p.entries.size}</td><td>${p.entrants}</td>${
          divisions.map((d) => `<td>${p.perDiv[d] ? p.perDiv[d].size : ""}</td>`).join("")
        }</tr>${planExpanded.has(p.school) ? planExpansionHtml(p.school, 4 + divisions.length) : ""}`).join("")
    }</tbody></table>`;
    body.querySelectorAll("[data-expand]").forEach((el) => {
      el.onclick = () => {
        const s = el.dataset.expand;
        if (planExpanded.has(s)) planExpanded.delete(s);
        else planExpanded.add(s);
        renderPlan();
      };
    });
    body.querySelectorAll("[data-open]").forEach((a) => {
      a.onclick = () => openInAdminBlock(a.dataset.e, a.dataset.open);
    });
    body.querySelectorAll("select[data-school]").forEach((sel) => {
      sel.onchange = () => {
        const school = sel.dataset.school;
        if (sel.value) dayAssign[school] = sel.value;
        else delete dayAssign[school];
        saveDays();
        renderPlan();
      };
    });
  }

  function render() {
    root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === state.tab));
    if (state.tab === "cert") renderCert();
    else renderPlan();
  }
  root.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => {
      state.tab = t.dataset.tab;
      if (root.classList.contains("pagemode")) setPageMode(false);
      else render();
    };
  });
  // Page mode: collapse the overlay to just the toolbar and reveal the original
  // admin page beneath it (body pushed down so nothing is covered).
  function setPageMode(on) {
    root.classList.toggle("pagemode", on);
    document.body.style.marginTop = on ? root.offsetHeight + "px" : "";
    $("#ov-page").textContent = on ? "Show views" : "Show page";
    if (!on) render();
  }
  $("#ov-page").onclick = () => setPageMode(!root.classList.contains("pagemode"));
  $("#ov-close").onclick = () => {
    document.body.style.marginTop = "";
    root.remove();
  };
  $("#ov-refresh").onclick = () => globalThis.__bkkOrganizerViewsBoot();

  render();
};
globalThis.__bkkOrganizerViewsBoot();
