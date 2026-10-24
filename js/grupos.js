// =========================================================
// Control de Obra: navegación por secciones (grupos) y registro de vistas nuevas
// Debe cargarse ANTES de app.js.
// =========================================================
window.OBRA_GRUPOS = [
  { id: "avance", nombre: "Avance", vistas: ["dashboard", "control", "kpis", "restricciones", "gantt", "avance", "asistente"] },
  { id: "costos", nombre: "Costos", vistas: ["valorizacion", "costos", "pagos", "adicionales", "flujo"] },
  { id: "campo", nombre: "Campo", vistas: ["diario", "semanal", "cuaderno"] },
  { id: "docs", nombre: "Documentos", vistas: ["documentos", "rfi"] },
  { id: "plan", nombre: "Planificación", vistas: ["edt", "partidas", "lineasbase", "cargar", "usuarios"] },
];
window.OBRA_VISTAS = {};        // id -> { titulo, onShow }
window.OBRA_HOOKS = [];         // funciones que se llaman al cambiar de proyecto

// Registra una vista nueva: crea el botón de pestaña y la sección.
window.registerVista = function (v) {
  window.OBRA_VISTAS[v.id] = v;
  const main = document.querySelector("main.content");
  const nav = document.querySelector("nav.tabs:not(#gruposNav)");
  if (!main || !nav || document.getElementById("view-" + v.id)) return;
  const btn = document.createElement("button");
  btn.className = "tab-btn";
  btn.dataset.view = v.id;
  btn.textContent = v.titulo;
  nav.appendChild(btn);
  const sec = document.createElement("section");
  sec.className = "view";
  sec.id = "view-" + v.id;
  sec.innerHTML = v.html || "";
  main.appendChild(sec);
  if (v.init) { try { v.init(sec); } catch (e) { console.error("init " + v.id, e); } }
};

function grupoDe(vista) { return OBRA_GRUPOS.find(g => g.vistas.includes(vista)); }

function mostrarGrupo(gid) {
  const nav = document.querySelector("nav.tabs:not(#gruposNav)");
  if (!nav) return;
  const g = OBRA_GRUPOS.find(x => x.id === gid);
  nav.querySelectorAll(".tab-btn").forEach(b => {
    const dentro = g && g.vistas.includes(b.dataset.view);
    b.classList.toggle("fuera-grupo", !dentro);
  });
  // orden de las pestañas según la lista del grupo
  if (g) g.vistas.forEach(v => { const b = nav.querySelector(`.tab-btn[data-view="${v}"]`); if (b) nav.appendChild(b); });
  document.querySelectorAll("#gruposNav .grupo-btn").forEach(b => b.classList.toggle("active", b.dataset.grupo === gid));
}

function activarVista(vista) {
  document.querySelectorAll("nav.tabs .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === vista));
  document.querySelectorAll("main.content .view").forEach(v => v.classList.toggle("active", v.id === "view-" + vista));
  const def = window.OBRA_VISTAS[vista];
  if (def && def.onShow) { try { def.onShow(); } catch (e) { console.error("onShow " + vista, e); } }
}

function visibleEnGrupo(g) {
  const nav = document.querySelector("nav.tabs:not(#gruposNav)");
  return g.vistas.some(v => { const b = nav.querySelector(`.tab-btn[data-view="${v}"]`); return b && b.style.display !== "none"; });
}

window.refrescarGrupos = function () {
  const bar = document.getElementById("gruposNav");
  if (!bar) return;
  bar.querySelectorAll(".grupo-btn").forEach(b => {
    const g = OBRA_GRUPOS.find(x => x.id === b.dataset.grupo);
    b.style.display = visibleEnGrupo(g) ? "" : "none";
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector("nav.tabs");
  if (!nav) return;
  const st = document.createElement("style");
  st.textContent = `.tab-btn.fuera-grupo{display:none !important}
    #gruposNav{background:var(--surface-1);border-bottom:1px solid var(--border);}
    .grupo-btn{padding:9px 16px;border:none;background:transparent;border-radius:8px 8px 0 0;font-size:13.5px;font-weight:700;color:var(--text-secondary);cursor:pointer;white-space:nowrap;}
    .grupo-btn.active{color:var(--blue);background:var(--page-plane);border-bottom:2px solid var(--blue);}
    nav.tabs:not(#gruposNav){background:#f6f7f9;}
    .num{text-align:right;white-space:nowrap;}`;
  document.head.appendChild(st);
  const bar = document.createElement("nav");
  bar.className = "tabs";
  bar.id = "gruposNav";
  bar.innerHTML = OBRA_GRUPOS.map(g => `<button class="grupo-btn" data-grupo="${g.id}">${g.nombre}</button>`).join("");
  nav.parentNode.insertBefore(bar, nav);
  bar.addEventListener("click", (e) => {
    const b = e.target.closest(".grupo-btn");
    if (!b) return;
    const g = OBRA_GRUPOS.find(x => x.id === b.dataset.grupo);
    mostrarGrupo(g.id);
    const navTabs = document.querySelector("nav.tabs:not(#gruposNav)");
    const primera = g.vistas.find(v => { const t = navTabs.querySelector(`.tab-btn[data-view="${v}"]`); return t && t.style.display !== "none"; });
    if (primera) activarVista(primera);
  });
  // clic en una pestaña: se activa y se ejecuta su onShow (app.js ya cambia la vista; esto cubre las nuevas)
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".tab-btn");
    if (!b) return;
    activarVista(b.dataset.view);
  });
  mostrarGrupo("avance");
  // las pestañas de rol (Usuarios, Líneas Base, Cargar) se muestran un poco después del arranque
  [300, 1200, 3000].forEach(ms => setTimeout(window.refrescarGrupos, ms));
  window.refrescarGrupos();
});

// utilidades compartidas por los módulos nuevos
window.puedeEscribirObra = function (roles) {
  return typeof CURRENT_PROFILE !== "undefined" && CURRENT_PROFILE && roles.includes(CURRENT_PROFILE.rol);
};
window.hoyLocalISO = function () { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
window.fdmy = function (iso) { return iso ? iso.split("-").reverse().join("/") : ""; };
window.solesFmt = function (n) { return n == null || n === "" || isNaN(n) ? "" : Number(n).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
window.descargarCSV = function (nombre, cabecera, filas) {
  const celda = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const t = "﻿" + [cabecera, ...filas].map(f => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
