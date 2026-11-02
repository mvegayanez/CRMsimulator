// Simulacro CRM · Sesión 1 (CRM relacional)
// Lógica del frontend: acceso, cartera de clientes, interacciones y oportunidades.

const cfg = window.APP_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const $ = (selector) => document.querySelector(selector);

const CANALES = { email: 'Email', telefono: 'Teléfono', web: 'Web', redes: 'Redes sociales', presencial: 'Presencial' };
const RESULTADOS = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };
const FASES = { prospeccion: 'Prospección', propuesta: 'Propuesta', negociacion: 'Negociación', ganada: 'Ganada', perdida: 'Perdida' };

let usuario = null;
let clienteActivo = null;
let clientes = [];

// ---------- Utilidades ----------

function escapar(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Convierte los campos vacíos en null para que la base de datos los trate bien
function limpiar(objeto) {
  return Object.fromEntries(Object.entries(objeto).map(([k, v]) => [k, v === '' ? null : v]));
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function formatearEuros(cantidad) {
  return Number(cantidad || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function avisar(texto, tipo = 'ok') {
  const el = $('#mensaje');
  el.textContent = texto;
  el.className = `mensaje ${tipo}`;
  clearTimeout(avisar.temporizador);
  avisar.temporizador = setTimeout(() => el.classList.add('oculto'), 4000);
}

function mostrar(selector, visible) {
  $(selector).classList.toggle('oculto', !visible);
}

// ---------- Acceso ----------

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({
    email: f.get('email'),
    password: f.get('password'),
  });
  if (error) avisar(error.message, 'error');
});

$('#form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signUp({
    email: f.get('email'),
    password: f.get('password'),
    options: { data: { nombre: f.get('nombre') } },
  });
  if (error) return avisar(error.message, 'error');
  e.target.reset();
  avisar('Cuenta creada. Si el proyecto exige confirmar el correo, confírmalo antes de entrar.');
});

$('#btn-salir').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_evento, sesion) => {
  usuario = sesion?.user ?? null;
  if (usuario) entrarEnApp();
  else salirDeApp();
});

async function entrarEnApp() {
  mostrar('#vista-auth', false);
  mostrar('#vista-app', true);

  const { data } = await sb.from('perfiles').select('nombre').eq('id', usuario.id).maybeSingle();
  $('#nombre-usuario').textContent = data?.nombre ?? usuario.email;

  await cargarTodo();
}

function salirDeApp() {
  mostrar('#vista-app', false);
  mostrar('#vista-auth', true);
  clienteActivo = null;
  clientes = [];
  mostrar('#panel-cliente', false);
  mostrar('#sin-seleccion', true);
}

// ---------- Carga de datos ----------

async function cargarTodo() {
  await Promise.all([cargarClientes(), cargarContadores()]);
  if (clienteActivo) await cargarDetalle(clienteActivo);
}

async function cargarContadores() {
  const contar = (tabla) =>
    sb.from(tabla).select('*', { count: 'exact', head: true }).then((r) => r.count ?? 0);

  const [clientesN, interaccionesN, oportunidadesN] = await Promise.all([
    contar('clientes'), contar('interacciones'), contar('oportunidades'),
  ]);
  $('#kpi-clientes').textContent = clientesN;
  $('#kpi-interacciones').textContent = interaccionesN;
  $('#kpi-oportunidades').textContent = oportunidadesN;
}

async function cargarClientes() {
  const { data, error } = await sb
    .from('clientes')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error) return avisar(error.message, 'error');

  clientes = data;
  mostrar('#sin-clientes', clientes.length === 0);

  $('#tabla-clientes').innerHTML = clientes.map((c) => `
    <tr class="${c.id === clienteActivo ? 'seleccionado' : ''}">
      <td>${escapar(c.nombre)}</td>
      <td>${escapar(c.empresa)}</td>
      <td>${escapar(c.sector)}</td>
      <td><button class="secundario" data-id="${c.id}">Abrir</button></td>
    </tr>
  `).join('');
}

$('#tabla-clientes').addEventListener('click', (e) => {
  const id = e.target.dataset.id;
  if (id) seleccionarCliente(id);
});

async function seleccionarCliente(id) {
  clienteActivo = id;
  const cliente = clientes.find((c) => c.id === id);

  mostrar('#sin-seleccion', false);
  mostrar('#panel-cliente', true);
  $('#titulo-cliente strong').textContent =
    `${cliente.nombre}${cliente.empresa ? ' · ' + cliente.empresa : ''}`;

  await cargarDetalle(id);
  await cargarClientes(); // para marcar la fila seleccionada
}

async function cargarDetalle(id) {
  const [interacciones, oportunidades] = await Promise.all([
    sb.from('interacciones').select('*').eq('cliente_id', id).order('fecha', { ascending: false }),
    sb.from('oportunidades').select('*').eq('cliente_id', id).order('creado_en', { ascending: false }),
  ]);

  const error = interacciones.error || oportunidades.error;
  if (error) return avisar(error.message, 'error');

  $('#lista-interacciones').innerHTML = interacciones.data.length
    ? interacciones.data.map((i) => `
        <li>
          <strong>${formatearFecha(i.fecha)}</strong> · ${CANALES[i.canal]}
          ${i.resultado ? '· ' + RESULTADOS[i.resultado] : ''}
          ${i.notas ? '<br>' + escapar(i.notas) : ''}
        </li>`).join('')
    : '<li class="vacio">Sin interacciones todavía.</li>';

  $('#lista-oportunidades').innerHTML = oportunidades.data.length
    ? oportunidades.data.map((o) => `
        <li>${escapar(o.titulo)} · ${formatearEuros(o.importe)} · ${FASES[o.fase]}</li>`).join('')
    : '<li class="vacio">Sin oportunidades todavía.</li>';
}

// ---------- Formularios ----------

$('#form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = limpiar(Object.fromEntries(new FormData(e.target)));
  const { error } = await sb.from('clientes').insert({ ...datos, alumno_id: usuario.id });
  if (error) return avisar(error.message, 'error');

  e.target.reset();
  avisar('Cliente añadido a tu cartera.');
  await cargarTodo();
});

$('#form-interaccion').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!clienteActivo) return;

  const datos = limpiar(Object.fromEntries(new FormData(e.target)));
  const { error } = await sb.from('interacciones').insert({
    ...datos,
    alumno_id: usuario.id,
    cliente_id: clienteActivo,
  });
  if (error) return avisar(error.message, 'error');

  e.target.reset();
  avisar('Interacción registrada.');
  await cargarTodo();
});

$('#form-oportunidad').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!clienteActivo) return;

  const datos = limpiar(Object.fromEntries(new FormData(e.target)));
  const { error } = await sb.from('oportunidades').insert({
    ...datos,
    importe: Number(datos.importe) || 0,
    alumno_id: usuario.id,
    cliente_id: clienteActivo,
  });
  if (error) return avisar(error.message, 'error');

  e.target.reset();
  avisar('Oportunidad creada.');
  await cargarTodo();
});

// ---------- Arranque ----------

if (cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
  avisar('Falta configurar config.js con la URL y la clave de tu proyecto Supabase.', 'error');
}
