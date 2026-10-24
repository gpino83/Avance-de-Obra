// Gestión de usuarios de la empresa (solo administrador)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLES = { admin: "Administrador", planner: "Planner", residente: "Residente", viewer: "Solo lectura", logistica: "Procura", calidad: "Calidad", ssoma: "SSOMA", postventa: "Post Venta" };
let YO = null, LISTA = [];

async function llamar(cuerpo) {
  const { data, error } = await supabaseClient.functions.invoke("usuarios", { body: cuerpo });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) {}
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function cargar() {
  const { data } = await supabaseClient.from("perfiles").select("id,nombre_completo,usuario,rol,activo").order("nombre_completo");
  LISTA = data || [];
  $("tUsr").querySelector("tbody").innerHTML = LISTA.map(p => {
    const yo = p.id === YO.id;
    const rolSel = yo ? esc(ROLES[p.rol] || p.rol) : `<select class="in" data-rol="${p.id}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === p.rol ? " selected" : ""}>${v}</option>`).join("")}</select>`;
    return `<tr><td>${esc(p.nombre_completo)}</td><td>${esc(p.usuario || "(ingresa con correo)")}</td><td>${rolSel}</td><td>${p.activo === false ? "Inactivo" : "Activo"}</td>
      <td style="white-space:nowrap;"><button class="btn secondary mini" data-clave="${p.id}">Nueva contraseña</button> ${yo ? "" : `<button class="btn secondary mini" data-est="${p.id}">${p.activo === false ? "Activar" : "Desactivar"}</button>`}</td></tr>`;
  }).join("");
}

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  const { data: perfil } = await supabaseClient.from("perfiles").select("*").eq("id", session.user.id).single();
  YO = perfil;
  if (!YO || YO.rol !== "admin") { window.location.href = "modulos.html"; return; }
  $("userName").textContent = YO.nombre_completo || session.user.email;
  $("userRole").textContent = "(" + YO.rol + ")";
  $("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "index.html"; });
  const { data: emp } = await supabaseClient.from("empresas").select("codigo").limit(1).maybeSingle();
  $("codEmpresa").textContent = (emp && emp.codigo) || "sin código (pídeselo al proveedor)";

  $("nuForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = $("nuMsg"); m.style.color = ""; m.textContent = "Creando...";
    try {
      await llamar({ accion: "crear", nombre: $("nuNombre").value.trim(), usuario: $("nuUsuario").value.trim().toLowerCase(), rol: $("nuRol").value, password: $("nuClave").value });
      m.style.color = "var(--green, #1a7f37)"; m.textContent = "Usuario creado.";
      $("nuForm").reset(); await cargar();
    } catch (err) { m.style.color = "var(--red)"; m.textContent = err.message; }
  });

  $("tUsr").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const msg = $("uMsg"); msg.style.color = ""; msg.textContent = "";
    try {
      if (b.dataset.clave) {
        const c = prompt("Nueva contraseña (mínimo 8 caracteres):"); if (!c) return;
        await llamar({ accion: "clave", id: b.dataset.clave, password: c }); msg.textContent = "Contraseña actualizada.";
      }
      if (b.dataset.est) {
        const p = LISTA.find(x => x.id === b.dataset.est);
        await llamar({ accion: "estado", id: p.id, activo: p.activo === false }); await cargar();
      }
    } catch (err) { msg.style.color = "var(--red)"; msg.textContent = err.message; }
  });
  $("tUsr").addEventListener("change", async (e) => {
    const s = e.target.closest("select[data-rol]"); if (!s) return;
    try { await llamar({ accion: "rol", id: s.dataset.rol, rol: s.value }); $("uMsg").textContent = "Rol actualizado."; }
    catch (err) { $("uMsg").style.color = "var(--red)"; $("uMsg").textContent = err.message; await cargar(); }
  });
  await cargar();
})();
