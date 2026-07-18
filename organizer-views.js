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
  if (!base || !token) {
    alert("organizer-views: no admin token in localStorage — sign in first.");
    return;
  }

  async function fetchBlock(key) {
    const r = await fetch(base + "/api/dt-block/" + key, { headers: { "x-ls-web-token": token } });
    if (!r.ok) throw new Error("fetch " + key + " -> " + r.status);
    return (await r.json()).data;
  }

  const [entriesRaw, entrantsRaw, schoolsRaw] = await Promise.all([
    fetchBlock(ENDPOINTS.entries),
    fetchBlock(ENDPOINTS.entrants),
    fetchBlock(ENDPOINTS.schools),
  ]);

  const entrantById = new Map(entrantsRaw.map((r) => [r.id, r.values]));
  const schoolById = new Map(schoolsRaw.map((r) => [r.id, r.values]));
  const schoolName = (id) => (id && schoolById.get(id) ? schoolById.get(id).name : "");

  // picklist_label arrives as an i18n object {af, en}; prefer Afrikaans.
  function localized(v) {
    if (v && typeof v === "object") return v.af ?? v.en ?? Object.values(v)[0] ?? "";
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

  // division_name follows each entry's locale (Dans vs Dance), so views group by
  // division_id and show one merged label per id.
  const divisionNames = new Map();
  for (const rec of entriesRaw) {
    const v = rec.values;
    if (!v.division_id || !v.division_name) continue;
    if (!divisionNames.has(v.division_id)) divisionNames.set(v.division_id, new Set());
    divisionNames.get(v.division_id).add(v.division_name);
  }
  const divisionLabel = new Map(
    [...divisionNames.entries()].map(([id, names]) => [id, [...names].sort().join(" / ")]),
  );

  // Certificate rows: one per entrant per entry; group entries (members stripped
  // server-side) collapse to a single flagged group_name row.
  const certRows = [];
  for (const rec of entriesRaw) {
    const v = rec.values;
    const ids = entrantIdList(v.entrant_ids);
    const paid = Boolean(v._invoice_number);
    const common = {
      entryId: rec.id,
      entryNo: v.entry_number || "",
      division: divisionLabel.get(v.division_id) ?? (v.division_name || ""),
      category: v.category_name || "",
      klass: v.class_name || "",
      variant: v.variant_name || "",
      item: localized(v.picklist_label) || localized(v.picklist_value),
      title: typeof v.title === "string" ? v.title : "",
      invoice: v._invoice_number || "",
      paid,
    };
    if (ids.length === 0) {
      certRows.push({
        ...common,
        first: v.group_name || v.entrant_first_name || "",
        last: v.group_name ? "" : (v.entrant_last_name || ""),
        school: "",
        grade: "",
        isGroup: Boolean(v.group_name),
      });
      continue;
    }
    for (const id of ids) {
      const e = entrantById.get(id);
      certRows.push({
        ...common,
        first: e ? e.first_name || "" : "(onbekende inskrywer " + id.slice(0, 8) + ")",
        last: e ? e.last_name || "" : "",
        school: e ? schoolName(e.school_id) : "",
        grade: e ? gradeLabel(e.grade_ord) : "",
        isGroup: false,
      });
    }
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
  const CERT_DERIVED = {
    Certificate_Name: (r) => (r.isGroup ? r.first : (r.first + " " + r.last).trim()),
    Certificate_Title: (r) => r.title.trim(),
  };
  for (const row of certRows) {
    for (const [key, fn] of Object.entries(CERT_DERIVED)) row[key] = fn(row);
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
    const key = row.school || "(no school / groups)";
    if (!planBySchool.has(key)) {
      planBySchool.set(key, { school: key, entries: new Set(), entrants: 0, perDiv: {} });
    }
    const p = planBySchool.get(key);
    p.entries.add(row.entryId);
    p.entrants += 1;
    if (row.division) {
      if (!p.perDiv[row.division]) p.perDiv[row.division] = new Set();
      p.perDiv[row.division].add(row.entryId);
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
#${ROOT_ID} tr.grp{background:#fdf3e7}
#${ROOT_ID} tr.sus{background:#fde8e8}
#${ROOT_ID} .btn{cursor:pointer;padding:5px 12px;border:0;border-radius:5px;background:#4a7c59;color:#fff;font:inherit}
#${ROOT_ID} .btn.gray{background:#666}
#${ROOT_ID} select{font:inherit;padding:2px}
#${ROOT_ID} .sum{font-weight:600;margin-left:auto}
#${ROOT_ID} .daytotals{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;font-weight:600}
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
  const state = { tab: "cert", paidOnly: true, division: "", suspectsOnly: false, search: "" };

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
      (!state.division || r.division === state.division) &&
      (!state.suspectsOnly || r.suspect) &&
      (!state.search ||
        (r.first + " " + r.last + " " + r.school + " " + r.title + " " + r.entryNo)
          .toLowerCase().includes(state.search))
    );
  }

  const CERT_COLS = [
    ...Object.keys(CERT_DERIVED).map((k) => [k, k]),
    ["school", "School"], ["grade", "Grade"],
    ["division", "Division"], ["category", "Category"], ["klass", "Class"],
    ["variant", "Variant"], ["item", "Item"],
    ["entryNo", "E#"], ["invoice", "Invoice"], ["suspect", "Title_Flag"],
  ];
  let certSort = { key: "school", dir: 1 };

  function renderCert() {
    const rows = certFiltered().slice().sort((a, b) => {
      const va = String(a[certSort.key] ?? ""), vb = String(b[certSort.key] ?? "");
      return va.localeCompare(vb, "af", { numeric: true }) * certSort.dir;
    });
    bar.innerHTML = `
<label><input type="checkbox" id="f-paid" ${state.paidOnly ? "checked" : ""}> Paid only</label>
<label><input type="checkbox" id="f-sus" ${state.suspectsOnly ? "checked" : ""}> Title flags only</label>
<select id="f-div"><option value="">All divisions</option>${divisions.map((d) => `<option ${state.division === d ? "selected" : ""}>${d}</option>`).join("")}</select>
<input id="f-search" placeholder="search…" value="${state.search}" style="font:inherit;padding:3px 6px;width:180px">
<button class="btn" id="ov-export-cert">Export CSV (Excel)</button>`;
    $("#f-paid").onchange = (e) => { state.paidOnly = e.target.checked; renderCert(); };
    $("#f-sus").onchange = (e) => { state.suspectsOnly = e.target.checked; renderCert(); };
    $("#f-div").onchange = (e) => { state.division = e.target.value; renderCert(); };
    $("#f-search").oninput = (e) => { state.search = e.target.value.toLowerCase(); renderCert(); };
    $("#ov-export-cert").onclick = () =>
      csvDownload("bkk-certificates-" + today + ".csv", CERT_COLS.map((c) => c[1]),
        rows.map((r) => CERT_COLS.map((c) => r[c[0]])));

    const nGroups = rows.filter((r) => r.isGroup).length;
    const nSus = rows.filter((r) => r.suspect).length;
    $("#ov-sum").textContent =
      rows.length + " certificate rows (" + nGroups + " groups without members, " + nSus + " title flags)";
    body.innerHTML = `<table><thead><tr>${
      CERT_COLS.map((c) => `<th data-k="${c[0]}">${c[1]}${certSort.key === c[0] ? (certSort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")
    }</tr></thead><tbody>${
      rows.map((r) =>
        `<tr class="${r.isGroup ? "grp" : ""}${r.suspect ? " sus" : ""}">${
          CERT_COLS.map((c) => `<td>${String(r[c[0]] ?? "")}</td>`).join("")
        }</tr>`).join("")
    }</tbody></table>`;
    body.querySelectorAll("th").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        certSort = { key: k, dir: certSort.key === k ? -certSort.dir : 1 };
        renderCert();
      };
    });
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
        `<tr><td>${p.school}</td><td><select data-school="${p.school.replaceAll('"', "&quot;")}">
<option value="">— day —</option>${
          FESTIVAL_DAYS.map((d) => `<option value="${d.id}" ${dayAssign[p.school] === d.id ? "selected" : ""}>${d.label}</option>`).join("")
        }</select></td><td>${p.entries.size}</td><td>${p.entrants}</td>${
          divisions.map((d) => `<td>${p.perDiv[d] ? p.perDiv[d].size : ""}</td>`).join("")
        }</tr>`).join("")
    }</tbody></table>`;
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
    t.onclick = () => { state.tab = t.dataset.tab; render(); };
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
