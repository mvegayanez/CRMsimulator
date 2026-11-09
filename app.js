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

  const { data } = await sb.from('perfiles').select('nombre, rol').eq('id', usuario.id).maybeSingle();

  if (data?.rol === 'profesor') {
    $('#nombre-profesor').textContent = data.nombre;
    mostrar('#vista-app', false);
    mostrar('#vista-profesor', true);
    await cargarPanelProfesor();
    await cargarSesion2Profesor();
    return;
  }

  mostrar('#vista-profesor', false);
  mostrar('#vista-app', true);
  $('#nombre-usuario').textContent = data?.nombre ?? usuario.email;
  mostrarSesion('s1');

  await cargarTodo();
}

function salirDeApp() {
  mostrar('#vista-app', false);
  mostrar('#vista-profesor', false);
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

// ---------- Panel del profesor (solo lectura) ----------

let datosProfesor = null;

// Agrupa una lista de filas por el valor de un campo: { valor: [filas] }
function agrupar(filas, campo) {
  return filas.reduce((mapa, fila) => {
    (mapa[fila[campo]] ??= []).push(fila);
    return mapa;
  }, {});
}

async function cargarPanelProfesor() {
  const [alumnos, todosClientes, todasInteracciones, todasOportunidades] = await Promise.all([
    sb.from('perfiles').select('id, nombre').eq('rol', 'alumno').order('nombre'),
    sb.from('clientes').select('id, alumno_id, nombre, empresa'),
    sb.from('interacciones').select('id, alumno_id, cliente_id, canal, resultado, notas, fecha').order('fecha'),
    sb.from('oportunidades').select('id, alumno_id, cliente_id, titulo, importe, fase'),
  ]);

  const error = alumnos.error || todosClientes.error || todasInteracciones.error || todasOportunidades.error;
  if (error) return avisar(error.message, 'error');

  datosProfesor = {
    alumnos: alumnos.data,
    clientes: todosClientes.data,
    interacciones: todasInteracciones.data,
    oportunidades: todasOportunidades.data,
  };

  const clientesPorAlumno = agrupar(datosProfesor.clientes, 'alumno_id');
  const interaccionesPorAlumno = agrupar(datosProfesor.interacciones, 'alumno_id');
  const oportunidadesPorAlumno = agrupar(datosProfesor.oportunidades, 'alumno_id');

  $('#tabla-alumnos').innerHTML = datosProfesor.alumnos.length
    ? datosProfesor.alumnos.map((a) => {
        const ops = oportunidadesPorAlumno[a.id] ?? [];
        const importe = ops.reduce((suma, o) => suma + Number(o.importe), 0);
        return `
          <tr>
            <td>${escapar(a.nombre)}</td>
            <td>${(clientesPorAlumno[a.id] ?? []).length}</td>
            <td>${(interaccionesPorAlumno[a.id] ?? []).length}</td>
            <td>${ops.length}</td>
            <td>${formatearEuros(importe)}</td>
            <td><button class="secundario" data-alumno="${a.id}">Ver cartera</button></td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="vacio">Todavía no hay alumnos registrados.</td></tr>';
}

$('#tabla-alumnos').addEventListener('click', (e) => {
  const id = e.target.dataset.alumno;
  if (id) mostrarCarteraAlumno(id);
});

function mostrarCarteraAlumno(idAlumno) {
  const { alumnos, clientes, interacciones, oportunidades } = datosProfesor;
  const alumno = alumnos.find((a) => a.id === idAlumno);
  if (!alumno) return;

  const clientesAlumno = clientes.filter((c) => c.alumno_id === idAlumno);
  const interaccionesPorCliente = agrupar(interacciones.filter((i) => i.alumno_id === idAlumno), 'cliente_id');
  const oportunidadesPorCliente = agrupar(oportunidades.filter((o) => o.alumno_id === idAlumno), 'cliente_id');

  $('#titulo-detalle').textContent = `Cartera de ${alumno.nombre}`;

  $('#tabla-detalle').innerHTML = clientesAlumno.length
    ? clientesAlumno.map((c) => {
        const ints = interaccionesPorCliente[c.id] ?? [];
        const ops = oportunidadesPorCliente[c.id] ?? [];
        return `
          <tr>
            <td><strong>${escapar(c.nombre)}</strong><br><span class="vacio">${escapar(c.empresa)}</span></td>
            <td>
              ${ints.length
                ? '<ul>' + ints.map((i) => `
                    <li>${formatearFecha(i.fecha)} · ${CANALES[i.canal] ?? escapar(i.canal)} · ${RESULTADOS[i.resultado] ?? '—'}
                    ${i.notas ? '<br>' + escapar(i.notas) : ''}</li>`).join('') + '</ul>'
                : '<span class="vacio">Sin interacciones.</span>'}
              ${ops.map((o) => `<p><strong>Oportunidad:</strong> ${escapar(o.titulo)} · ${formatearEuros(o.importe)} · ${FASES[o.fase] ?? escapar(o.fase)}</p>`).join('')}
            </td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="2" class="vacio">Este alumno todavía no tiene clientes.</td></tr>';

  mostrar('#detalle-alumno', true);
  $('#detalle-alumno').scrollIntoView({ behavior: 'smooth' });
}

$('#btn-salir-profesor').addEventListener('click', () => sb.auth.signOut());

// ---------- Sesión 2 · Base de datos (alumno) ----------

const SECTORES = ['Industria', 'Construcción', 'Retail', 'Educación', 'Salud', 'Servicios financieros', 'Tecnología', 'Hostelería', 'Moda'];
const DIVISIONES = ['Suministros industriales', 'Formación y servicios', 'Tiendas y comercio'];
const CAMPOS_REGLA = {
  division: { etiqueta: 'División', tipo: 'lista', opciones: DIVISIONES },
  sector: { etiqueta: 'Sector', tipo: 'lista', opciones: SECTORES },
  tipo: { etiqueta: 'Tipo de cliente', tipo: 'lista', opciones: ['B2B', 'B2C'] },
  canal: { etiqueta: 'Último canal', tipo: 'lista', opciones: Object.keys(CANALES) },
  estado: { etiqueta: 'Estado', tipo: 'lista', opciones: ['activo', 'inactivo'] },
  email_valido: { etiqueta: 'Email válido', tipo: 'si_no' },
  sin_sector: { etiqueta: 'Sin sector', tipo: 'si_no' },
  dias_sin_contacto: { etiqueta: 'Días sin contacto', tipo: 'numero' },
  importe_anual: { etiqueta: 'Importe anual', tipo: 'importe' },
};
const TAM_PAGINA = 50;
const ACCIONES_TXT = { llamar: 'Llamar', email: 'Enviar email', visita: 'Visitar' };

// Misma comprobación que usa la base de datos para decidir si un email es válido
const EMAIL_VALIDO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Explica por qué un email no es válido (cadena vacía si lo es)
function motivoEmail(email) {
  const e = email ?? '';
  if (EMAIL_VALIDO.test(e)) return '';
  if (e !== e.trim()) return 'Tiene un espacio al principio o al final.';
  if (!e.includes('@')) return 'Falta la @.';
  if (!/\.[a-z]{2,}$/i.test(e)) return 'Falta la extensión del dominio (por ejemplo .es o .com).';
  return 'El formato no es correcto.';
}
const ESTADO_S2 = {
  pagina: 0,
  total: 0,
  filas: [],
  registroActivo: null,
  vista: { reglas: [], texto: '' },
  reglasConstruccion: [],
  segmentos: [],
};

function etiquetaValor(valor) {
  return CANALES[valor] ?? valor;
}

function rellenarOpciones(select, opciones, vacio = null) {
  const inicio = vacio !== null ? `<option value="">${escapar(vacio)}</option>` : '';
  select.innerHTML = inicio + opciones
    .map((o) => `<option value="${escapar(o)}">${escapar(etiquetaValor(o))}</option>`).join('');
}

function rellenarSiNo(select, vacio) {
  select.innerHTML = `<option value="">${escapar(vacio)}</option>
    <option value="true">Sí</option><option value="false">No</option>`;
}

function inicializarSesion2() {
  const f = $('#form-filtros');
  rellenarOpciones(f.elements.division, DIVISIONES, 'Todas');
  rellenarOpciones(f.elements.sector, SECTORES, 'Todos');
  rellenarOpciones(f.elements.tipo, ['B2B', 'B2C'], 'Todos');
  rellenarOpciones(f.elements.canal, Object.keys(CANALES), 'Todos');
  rellenarOpciones(f.elements.estado, ['activo', 'inactivo'], 'Todos');
  rellenarSiNo(f.elements.email_valido, 'Todos');
  rellenarSiNo(f.elements.sin_sector, 'Todos');
  rellenarOpciones($('#form-editar').elements.sector, SECTORES, 'Sin sector');
  $('#regla-campo').innerHTML = Object.entries(CAMPOS_REGLA)
    .map(([clave, c]) => `<option value="${clave}">${escapar(c.etiqueta)}</option>`).join('');
  dibujarValorRegla();
}

// Cambia entre la sesión 1 y la sesión 2 del alumno
function mostrarSesion(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activa', b.dataset.tab === id));
  mostrar('#s1', id === 's1');
  mostrar('#s2', id === 's2');
  if (id === 's2') cargarSesion2();
}

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => mostrarSesion(b.dataset.tab));
});

// ----- Llamadas a la base de datos -----

async function contarRegistros(reglas, texto = null) {
  const { data, error } = await sb.rpc('contar_registros', { p_reglas: reglas, p_texto: texto });
  if (error) throw error;
  return Number(data);
}

// Todas las filas de un segmento, en bloques de 1.000 (Supabase limita cada consulta)
async function obtenerRegistrosSegmento(reglas, texto = null) {
  const filas = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.rpc('filtrar_registros', {
      p_reglas: reglas, p_texto: texto, p_offset: offset, p_limit: 1000,
    });
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

// Todos los registros del alumno, para buscar duplicados (una sola vez)
async function obtenerTodosRegistros() {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from('registros_base')
      .select('id, nombre, email, es_duplicado')
      .order('id')
      .range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

// ----- Exploración y filtros -----

function aplicarFiltros() {
  const f = $('#form-filtros');
  const reglas = ['division', 'sector', 'tipo', 'canal', 'estado', 'email_valido', 'sin_sector']
    .filter((campo) => f.elements[campo].value !== '')
    .map((campo) => ({ campo, valor: f.elements[campo].value }));
  ESTADO_S2.vista = { reglas, texto: f.elements.texto.value.trim() };
  $('#vista-actual').textContent = '';
  cargarRegistros(0).catch((err) => avisar(err.message, 'error'));
}

let temporizadorBusqueda = null;
$('#form-filtros').addEventListener('change', aplicarFiltros);
$('#form-filtros').addEventListener('input', (e) => {
  if (e.target.name !== 'texto') return;
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(aplicarFiltros, 300);
});

async function cargarRegistros(pagina = 0) {
  const { reglas, texto } = ESTADO_S2.vista;
  const [lista, total] = await Promise.all([
    sb.rpc('filtrar_registros', { p_reglas: reglas, p_texto: texto || null, p_offset: pagina * TAM_PAGINA, p_limit: TAM_PAGINA }),
    sb.rpc('contar_registros', { p_reglas: reglas, p_texto: texto || null }),
  ]);
  if (lista.error || total.error) return avisar((lista.error || total.error).message, 'error');
  ESTADO_S2.pagina = pagina;
  ESTADO_S2.total = Number(total.data);
  ESTADO_S2.filas = lista.data;
  dibujarRegistros();
}

function dibujarRegistros() {
  const filas = ESTADO_S2.filas;
  $('#tabla-registros').innerHTML = filas.length ? filas.map((r) => `
    <tr data-id="${r.id}" class="${r.id === ESTADO_S2.registroActivo ? 'seleccionado' : ''}">
      <td>${escapar(r.nombre)}</td>
      <td>${escapar(r.empresa ?? '—')}</td>
      <td>${escapar(r.sector ?? 'Sin sector')}</td>
      <td>${escapar(r.email)}${motivoEmail(r.email) ? ` <span class="aviso" title="${escapar(motivoEmail(r.email))}">⚠</span>` : ''}</td>
      <td>${r.ultimo_contacto ? new Date(r.ultimo_contacto).toLocaleDateString('es-ES') : '—'}</td>
      <td>${escapar(r.estado)}</td>
      <td>${formatearEuros(r.importe_anual)}</td>
      <td>${r.es_duplicado ? 'Duplicado' : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="8" class="vacio">Ningún registro cumple estos filtros.</td></tr>';

  const desde = ESTADO_S2.total ? ESTADO_S2.pagina * TAM_PAGINA + 1 : 0;
  const hasta = Math.min((ESTADO_S2.pagina + 1) * TAM_PAGINA, ESTADO_S2.total);
  $('#paginacion-texto').textContent = `Mostrando ${desde}–${hasta} de ${ESTADO_S2.total}`;
  $('#btn-anterior').disabled = ESTADO_S2.pagina === 0;
  $('#btn-siguiente').disabled = hasta >= ESTADO_S2.total;
}

$('#btn-anterior').addEventListener('click', () => cargarRegistros(ESTADO_S2.pagina - 1));
$('#btn-siguiente').addEventListener('click', () => cargarRegistros(ESTADO_S2.pagina + 1));

$('#tabla-registros').addEventListener('click', (e) => {
  const fila = e.target.closest('tr[data-id]');
  if (fila) seleccionarRegistro(fila.dataset.id);
});

function seleccionarRegistro(id) {
  const r = ESTADO_S2.filas.find((x) => x.id === id);
  if (!r) return;
  ESTADO_S2.registroActivo = id;
  const f = $('#form-editar');
  mostrar('#sin-registro', false);
  mostrar('#form-editar', true);
  f.elements.nombre.value = r.nombre ?? '';
  f.elements.empresa.value = r.empresa ?? '';
  f.elements.sector.value = r.sector ?? '';
  f.elements.email.value = r.email ?? '';
  f.elements.telefono.value = r.telefono ?? '';
  f.elements.es_duplicado.checked = r.es_duplicado;
  $('#email-original').textContent = r.email_original ?? '—';
  mostrarMotivoEmail(r.email);
  dibujarRegistros();
}

function mostrarMotivoEmail(email) {
  const motivo = motivoEmail(email);
  $('#motivo-email').textContent = motivo ? `Este email no es válido. ${motivo}` : '';
  mostrar('#motivo-email', Boolean(motivo));
}

$('#form-editar').elements.email.addEventListener('input', (e) => mostrarMotivoEmail(e.target.value));

$('#form-editar').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ESTADO_S2.registroActivo) return;
  const f = e.target;
  const datos = limpiar({
    nombre: f.elements.nombre.value.trim(),
    empresa: f.elements.empresa.value.trim(),
    sector: f.elements.sector.value,
    email: f.elements.email.value.trim(),
    telefono: f.elements.telefono.value.trim(),
  });
  datos.es_duplicado = f.elements.es_duplicado.checked;

  const { error } = await sb.from('registros_base').update(datos).eq('id', ESTADO_S2.registroActivo);
  if (error) return avisar(error.message, 'error');
  avisar('Registro actualizado.');
  await cargarRegistros(ESTADO_S2.pagina);
  seleccionarRegistro(ESTADO_S2.registroActivo);
  await cargarKpis();
});

// ----- Indicadores de diagnóstico -----

async function cargarKpis() {
  const [total, email, sinSector, sinContacto, inactivos] = await Promise.all([
    contarRegistros([]),
    contarRegistros([{ campo: 'email_valido', valor: 'false' }]),
    contarRegistros([{ campo: 'sin_sector', valor: 'true' }]),
    contarRegistros([{ campo: 'dias_sin_contacto', valor: '90' }]),
    contarRegistros([{ campo: 'estado', valor: 'inactivo' }]),
  ]);
  $('#kpi-total').textContent = total;
  $('#kpi-email').textContent = email;
  $('#kpi-sin-sector').textContent = sinSector;
  $('#kpi-sin-contacto').textContent = sinContacto;
  $('#kpi-inactivos').textContent = inactivos;
}

// ----- Duplicados -----

$('#btn-buscar-duplicados').addEventListener('click', async () => {
  try {
    const todas = await obtenerTodosRegistros();
    const porEmail = agrupar(todas.map((r) => ({ ...r, clave: (r.email ?? '').trim().toLowerCase() })), 'clave');
    const grupos = Object.values(porEmail).filter((g) => g.length > 1 && g[0].clave !== '');
    $('#lista-duplicados').innerHTML = grupos.length ? grupos.map((g) => `
      <div class="grupo-dup">
        <strong>${escapar(g[0].clave)}</strong>
        ${g.map((r) => `<label><input type="checkbox" data-dup="${r.id}" ${r.es_duplicado ? 'checked' : ''}> ${escapar(r.nombre)}</label>`).join('')}
      </div>`).join('')
      : '<p class="vacio">No se han encontrado posibles duplicados.</p>';
    avisar(`${grupos.length} grupos de posibles duplicados.`);
  } catch (err) {
    avisar(err.message, 'error');
  }
});

$('#lista-duplicados').addEventListener('change', async (e) => {
  const id = e.target.dataset.dup;
  if (!id) return;
  const { error } = await sb.from('registros_base').update({ es_duplicado: e.target.checked }).eq('id', id);
  if (error) {
    e.target.checked = !e.target.checked;
    return avisar(error.message, 'error');
  }
  avisar(e.target.checked ? 'Marcado como duplicado.' : 'Marca quitada.');
  await cargarRegistros(ESTADO_S2.pagina);
});

// ----- Constructor de segmentos -----

function dibujarValorRegla() {
  const config = CAMPOS_REGLA[$('#regla-campo').value];
  const cont = $('#regla-valor');
  if (config.tipo === 'lista') {
    cont.innerHTML = `<label>Valor<select id="valor-regla">${config.opciones
      .map((o) => `<option value="${escapar(o)}">${escapar(etiquetaValor(o))}</option>`).join('')}</select></label>`;
  } else if (config.tipo === 'si_no') {
    cont.innerHTML = `<label>Valor<select id="valor-regla"><option value="true">Sí</option><option value="false">No</option></select></label>`;
  } else if (config.tipo === 'numero') {
    cont.innerHTML = `<label>Más de (días)<input id="valor-regla" type="number" min="0" value="90"></label>`;
  } else {
    cont.innerHTML = `<label>Condición<select id="op-regla"><option value=">">mayor que</option><option value="<">menor que</option></select></label>
      <label>Importe (€)<input id="valor-regla" type="number" min="0" value="5000"></label>`;
  }
}

function describirRegla(r) {
  const c = CAMPOS_REGLA[r.campo];
  let valor;
  if (c.tipo === 'si_no') valor = r.valor === 'true' ? 'Sí' : 'No';
  else if (c.tipo === 'numero') valor = `más de ${r.valor} días`;
  else if (c.tipo === 'importe') valor = `${r.op === '<' ? 'menor' : 'mayor'} que ${Number(r.valor).toLocaleString('es-ES')} €`;
  else valor = etiquetaValor(r.valor);
  return `${c.etiqueta}: ${valor}`;
}

function dibujarReglas() {
  const reglas = ESTADO_S2.reglasConstruccion;
  $('#lista-reglas').innerHTML = reglas.length
    ? reglas.map((r, i) => `<li>${escapar(describirRegla(r))} <button class="secundario" data-quitar="${i}" type="button">Quitar</button></li>`).join('')
    : '<li class="vacio">Sin reglas todavía. Añade al menos una.</li>';
}

$('#regla-campo').addEventListener('change', dibujarValorRegla);

$('#btn-agregar-regla').addEventListener('click', () => {
  const campo = $('#regla-campo').value;
  const valor = $('#valor-regla')?.value ?? '';
  if (valor === '') return avisar('Indica un valor para la regla.', 'error');
  const op = $('#op-regla')?.value;
  ESTADO_S2.reglasConstruccion.push({ campo, valor, ...(op ? { op } : {}) });
  dibujarReglas();
});

$('#lista-reglas').addEventListener('click', (e) => {
  const i = e.target.dataset.quitar;
  if (i === undefined) return;
  ESTADO_S2.reglasConstruccion.splice(Number(i), 1);
  dibujarReglas();
});

$('#btn-contar-regla').addEventListener('click', async () => {
  try {
    const n = await contarRegistros(ESTADO_S2.reglasConstruccion);
    $('#conteo-segmento').textContent = `${n} clientes cumplen estas reglas.`;
  } catch (err) {
    avisar(err.message, 'error');
  }
});

$('#btn-ver-regla').addEventListener('click', () => {
  ESTADO_S2.vista = { reglas: [...ESTADO_S2.reglasConstruccion], texto: '' };
  $('#vista-actual').textContent = 'Mostrando las reglas del segmento en construcción.';
  cargarRegistros(0).catch((err) => avisar(err.message, 'error'));
});

$('#form-segmento').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ESTADO_S2.reglasConstruccion.length === 0) return avisar('Añade al menos una regla antes de guardar.', 'error');
  const nombre = e.target.elements.nombre.value.trim();
  const { error } = await sb.from('segmentos').insert({
    alumno_id: usuario.id,
    nombre,
    reglas: ESTADO_S2.reglasConstruccion,
  });
  if (error) return avisar(error.message, 'error');
  e.target.reset();
  ESTADO_S2.reglasConstruccion = [];
  dibujarReglas();
  $('#conteo-segmento').textContent = '';
  avisar('Segmento guardado.');
  await cargarSegmentos();
});

// ----- Mis segmentos y acciones de seguimiento -----

async function cargarSegmentos() {
  const { data, error } = await sb.from('segmentos').select('id, nombre, reglas').order('creado_en');
  if (error) throw error;
  ESTADO_S2.segmentos = data;
  const conteos = await Promise.all(data.map((s) => contarRegistros(s.reglas)));
  $('#lista-segmentos').innerHTML = data.length ? data.map((s, i) => `
    <li>
      <strong>${escapar(s.nombre)}</strong> · ${conteos[i]} clientes<br>
      <button class="secundario" data-ver="${s.id}" type="button">Ver</button>
      <button class="primario" data-tarea="${s.id}" type="button">Crear acción</button>
      <button class="secundario" data-borrar="${s.id}" type="button">Eliminar</button>
    </li>`).join('') : '<li class="vacio">Todavía no tienes segmentos.</li>';
  dibujarEncargo();
}

$('#lista-segmentos').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.ver) {
      const s = ESTADO_S2.segmentos.find((x) => x.id === t.dataset.ver);
      ESTADO_S2.vista = { reglas: s.reglas, texto: '' };
      $('#vista-actual').textContent = `Mostrando el segmento «${s.nombre}».`;
      await cargarRegistros(0);
    } else if (t.dataset.tarea) {
      await crearAccion(t.dataset.tarea);
    } else if (t.dataset.borrar) {
      const { error } = await sb.from('segmentos').delete().eq('id', t.dataset.borrar);
      if (error) throw error;
      avisar('Segmento eliminado.');
      await cargarSegmentos();
    }
  } catch (err) {
    avisar(err.message, 'error');
  }
});

async function crearAccion(segmentoId) {
  const s = ESTADO_S2.segmentos.find((x) => x.id === segmentoId);
  const tipo = $('#tipo-accion').value;
  const registros = await obtenerRegistrosSegmento(s.reglas);
  if (registros.length === 0) return avisar('El segmento no tiene clientes.', 'error');
  const filas = registros.map((r) => ({ alumno_id: usuario.id, registro_id: r.id, tipo, segmento_id: segmentoId }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb.from('acciones_seguimiento').insert(filas.slice(i, i + 500));
    if (error) throw error;
  }
  avisar(`Acción creada para ${filas.length} clientes del segmento «${s.nombre}».`);
}

// ----- Encargo de campaña -----

async function cargarEncargo() {
  const { data, error } = await sb.rpc('mi_encargo');
  if (error) throw error;
  ESTADO_S2.encargo = data && data.length ? data[0] : null;
  dibujarEncargo();
}

function dibujarEncargo() {
  const caja = $('#encargo-contenido');
  const e = ESTADO_S2.encargo;
  if (!e) {
    caja.innerHTML = '<p class="vacio">No tienes un encargo asignado. Avisa al profesor.</p>';
    return;
  }
  const validos = (ESTADO_S2.segmentos ?? []).filter((s) => (s.reglas ?? []).length > 0);
  const entregado = validos.find((s) => s.id === e.segmento_id);
  const opciones = validos.length
    ? validos.map((s) => `<option value="${s.id}" ${s.id === e.segmento_id ? 'selected' : ''}>${escapar(s.nombre)}</option>`).join('')
    : '<option value="">Guarda primero un segmento con reglas</option>';
  caja.innerHTML = `
    <div class="encargo-texto"><strong>${escapar(e.titulo)}</strong><br>${escapar(e.enunciado)}</div>
    <ol>
      <li>Crea un segmento con las reglas que describen a esos clientes y comprueba cuántos son con «Contar clientes».</li>
      <li>Elige aquí el segmento y pulsa «Entregar segmento».</li>
      <li>En «Mis segmentos y acciones», elige <strong>${escapar(ACCIONES_TXT[e.accion] ?? e.accion)}</strong> y pulsa «Crear acción» en ese segmento.</li>
    </ol>
    <div class="acciones">
      <select id="encargo-segmento">${opciones}</select>
      <button class="primario" id="btn-entregar-encargo" type="button">Entregar segmento</button>
    </div>
    <p class="encargo-estado">${entregado ? `Entregado: «${escapar(entregado.nombre)}».` : 'Todavía no has entregado ningún segmento.'}</p>`;
}

$('#encargo-contenido').addEventListener('click', async (e) => {
  if (e.target.id !== 'btn-entregar-encargo') return;
  const id = $('#encargo-segmento').value;
  if (!id) return avisar('Primero guarda un segmento con al menos una regla.', 'error');
  const { error } = await sb.rpc('entregar_encargo', { p_segmento: id });
  if (error) return avisar(error.message, 'error');
  avisar('Segmento entregado.');
  try { await cargarEncargo(); } catch (err) { avisar(err.message, 'error'); }
});

// ----- Consultas y calificación -----

async function cargarConsultas() {
  const [preguntas, respuestas] = await Promise.all([
    sb.from('preguntas_caso').select('orden, enunciado, opciones').order('orden'),
    sb.from('respuestas_consultas').select('orden, opcion'),
  ]);
  const error = preguntas.error || respuestas.error;
  if (error) throw error;
  const marcadas = Object.fromEntries(respuestas.data.map((r) => [r.orden, r.opcion]));
  $('#lista-consultas').innerHTML = preguntas.data.length ? preguntas.data.map((p) => `
    <fieldset class="pregunta">
      <legend>${p.orden}. ${escapar(p.enunciado)}</legend>
      ${p.opciones.map((valor, i) => `
        <label><input type="radio" name="p${p.orden}" value="${i + 1}" ${marcadas[p.orden] === i + 1 ? 'checked' : ''}>
        ${typeof valor === 'number' ? valor.toLocaleString('es-ES') : escapar(String(valor))}</label>`).join('')}
    </fieldset>`).join('')
    : '<p class="vacio">Todavía no tienes consultas. Espera a que el profesor genere la base.</p>';
}

$('#btn-guardar-consultas').addEventListener('click', async () => {
  const filas = [];
  for (let orden = 1; orden <= 5; orden++) {
    const marcada = document.querySelector(`input[name="p${orden}"]:checked`);
    if (marcada) filas.push({ alumno_id: usuario.id, orden, opcion: Number(marcada.value) });
  }
  if (filas.length === 0) return avisar('Responde al menos una pregunta.', 'error');
  const { error } = await sb.from('respuestas_consultas').upsert(filas, { onConflict: 'alumno_id,orden' });
  if (error) return avisar(error.message, 'error');
  avisar(`${filas.length} respuestas guardadas.`);
});

$('#btn-mi-resultado').addEventListener('click', async () => {
  const { data, error } = await sb.rpc('mi_resultado_sesion2');
  if (error) return avisar(error.message, 'error');
  if (!data) return avisar('Todavía no tienes base asignada.', 'error');
  const coincidencia = data.segmento_entregado
    ? `tu segmento coincide en un ${data.coincidencia} % con lo pedido`
    : 'todavía no has entregado ningún segmento';
  $('#resultado-sesion2').innerHTML = `
    <p><strong>Nota automática: ${data.nota} / 10</strong></p>
    <ul>
      <li>Emails corregidos (1,5 pts): ${data.emails} · ${Math.min(data.emails_corregidos, data.objetivo_emails)} de ${data.objetivo_emails} del objetivo</li>
      <li>Duplicados (2 pts): ${data.duplicados} · ${Math.min(data.duplicados_netos, data.objetivo_duplicados)} de ${data.objetivo_duplicados} del objetivo</li>
      <li>Segmento del encargo (2,5 pts): ${data.segmentos} · ${coincidencia}</li>
      <li>Acción del encargo (1 pt): ${data.tareas} · acción sobre el ${data.cobertura_accion} % de los clientes pedidos</li>
      <li>Consultas (3 pts): ${data.consultas} · ${data.aciertos_consultas} de 5 correctas</li>
    </ul>`;
});

// ----- Carga de la sesión 2 -----

async function cargarSesion2() {
  try {
    const total = await contarRegistros([]);
    mostrar('#s2-sin-caso', total === 0);
    mostrar('#s2-contenido', total > 0);
    if (total === 0) return;
    await Promise.all([cargarKpis(), cargarRegistros(0), cargarSegmentos(), cargarEncargo(), cargarConsultas()]);
    dibujarReglas();
  } catch (err) {
    avisar(err.message, 'error');
  }
}

// ---------- Sesión 2 · Panel del profesor ----------

async function cargarSesion2Profesor() {
  const [resumen, respuestas, referencias, banco] = await Promise.all([
    sb.rpc('resumen_sesion2'),
    sb.from('respuestas_consultas').select('alumno_id, orden, opcion'),
    sb.from('referencia_sesion2').select('alumno_id, clave, valor').in('clave', ['correctas', 'preguntas']),
    sb.from('banco_preguntas').select('id, enunciado').order('id'),
  ]);
  const error = resumen.error || respuestas.error || referencias.error || banco.error;
  if (error) return avisar(error.message, 'error');

  $('#tabla-sesion2').innerHTML = resumen.data.length ? resumen.data.map((r) => {
    const d = r.resultado;
    if (!d) return `<tr><td>${escapar(r.nombre_alumno)}</td><td colspan="7" class="vacio">Sin caso generado</td></tr>`;
    return `<tr>
      <td>${escapar(r.nombre_alumno)}</td>
      <td>${escapar(d.encargo ?? '—')}</td>
      <td><strong>${d.nota}</strong></td>
      <td>${d.emails} (${Math.min(d.emails_corregidos, d.objetivo_emails)}/${d.objetivo_emails})</td>
      <td>${d.duplicados} (${Math.min(d.duplicados_netos, d.objetivo_duplicados)}/${d.objetivo_duplicados})</td>
      <td>${d.segmentos} · ${d.coincidencia} %</td>
      <td>${d.tareas} · ${d.cobertura_accion} %</td>
      <td>${d.consultas} (${d.aciertos_consultas}/5)</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="vacio">No hay alumnos registrados.</td></tr>';

  // Acierto por pregunta del banco: cada alumno recibe cinco, así que se agrupa por pregunta y no por posición
  const refs = {};
  for (const r of referencias.data) (refs[r.alumno_id] ??= {})[r.clave] = r.valor;
  const stats = {};
  for (const r of respuestas.data) {
    const ref = refs[r.alumno_id];
    if (!ref || !ref.preguntas || !ref.correctas) continue;
    const id = ref.preguntas[r.orden - 1];
    const s = (stats[id] ??= { n: 0, ok: 0 });
    s.n += 1;
    if (r.opcion === ref.correctas[r.orden - 1]) s.ok += 1;
  }
  $('#tabla-respuestas').innerHTML = banco.data.map((b) => {
    const s = stats[b.id] ?? { n: 0, ok: 0 };
    const pct = s.n ? `${Math.round((s.ok / s.n) * 100)} %` : '—';
    return `<tr><td>${b.id}. ${escapar(b.enunciado)}</td><td>${s.n}</td><td>${pct}</td></tr>`;
  }).join('');
}

$('#btn-generar-casos').addEventListener('click', async (e) => {
  const aviso = '¿Generar la base de la sesión 2 para los alumnos que todavía no la tienen? Los alumnos que ya tienen caso no se modifican.';
  if (!confirm(aviso)) return;
  const boton = e.currentTarget;
  boton.disabled = true;
  boton.textContent = 'Generando…';
  const { data, error } = await sb.rpc('generar_casos_sesion2');
  boton.disabled = false;
  boton.textContent = 'Generar casos de la sesión 2';
  if (error) return avisar(error.message, 'error');
  avisar(`Casos generados para ${data} alumnos.`);
  await cargarSesion2Profesor();
});

// ---------- Arranque ----------

inicializarSesion2();

if (cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
  avisar('Falta configurar config.js con la URL y la clave de tu proyecto Supabase.', 'error');
}
