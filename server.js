const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const XLSX = require('xlsx');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DESKTOP_DIR = process.env.DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
const PUNTERO_FILE = path.join(DATA_DIR, 'ronda-actual.txt');
const PORT = process.env.PORT || 3000;

fs.mkdirSync(DATA_DIR, { recursive: true });

function pad(n) {
  return String(n).padStart(2, '0');
}

// Sufijo de ronda: '' = ronda original (scores.json), o 'YYYY-MM-DD_HH-mm-ss' tras un reinicio.
function leerRondaActual() {
  try {
    return fs.readFileSync(PUNTERO_FILE, 'utf-8').trim();
  } catch (err) {
    return '';
  }
}

function guardarRondaActual(sufijo) {
  fs.writeFileSync(PUNTERO_FILE, sufijo, 'utf-8');
}

let rondaSufijo = leerRondaActual();

function rutaDatosRonda() {
  const nombre = rondaSufijo ? `scores-${rondaSufijo}.json` : 'scores.json';
  return path.join(DATA_DIR, nombre);
}

function rutaExcelRonda() {
  const nombre = rondaSufijo
    ? `Concurso Top3 - Participantes (desde ${rondaSufijo.replace('_', ' ')}).xlsx`
    : 'Concurso Top3 - Participantes.xlsx';
  return path.join(DESKTOP_DIR, nombre);
}

if (!fs.existsSync(rutaDatosRonda())) {
  fs.writeFileSync(rutaDatosRonda(), '[]', 'utf-8');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Registro de eventos en memoria (consola lateral del marcador, tecla D).
const MAX_LOGS = 300;
const logs = [];
const SESION = Date.now();
let contadorLogs = 0;

function registrar(nivel, mensaje) {
  const entrada = { sesion: SESION, id: ++contadorLogs, ts: new Date().toISOString(), nivel, mensaje };
  logs.push(entrada);
  if (logs.length > MAX_LOGS) logs.shift();
  (nivel === 'error' ? console.error : console.log)(`[${nivel}] ${mensaje}`);
  io.emit('log', entrada);
}

process.on('unhandledRejection', (motivo) => {
  registrar('error', `Promesa rechazada sin controlar: ${motivo && motivo.message ? motivo.message : motivo}`);
});
process.on('uncaughtExceptionMonitor', (err) => {
  registrar('error', `Excepción no controlada: ${err && err.message ? err.message : err}`);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/marcador.html'));

// Evita repetir en la consola el mismo fallo de lectura en cada consulta.
let ultimoErrorLectura = '';

function avisarErrorLectura(detalle) {
  if (detalle !== ultimoErrorLectura) {
    ultimoErrorLectura = detalle;
    registrar('error', `No se pudo leer ${path.basename(rutaDatosRonda())}: ${detalle}. Se usa una lista vacía.`);
  }
}

function leerPuntuaciones() {
  try {
    const raw = fs.readFileSync(rutaDatosRonda(), 'utf-8');
    const datos = JSON.parse(raw);
    if (!Array.isArray(datos)) {
      avisarErrorLectura('el contenido no es una lista');
      return [];
    }
    ultimoErrorLectura = '';
    return datos;
  } catch (err) {
    avisarErrorLectura(err.message);
    return [];
  }
}

function guardarPuntuaciones(puntuaciones) {
  fs.writeFileSync(rutaDatosRonda(), JSON.stringify(puntuaciones, null, 2), 'utf-8');
}

function actualizarExcel(puntuaciones) {
  try {
    const filas = [...puntuaciones]
      .sort((a, b) => b.puntuacion - a.puntuacion)
      .map((p) => ({
        Nombre: p.nombre,
        Apellido: p.apellido || '',
        'Teléfono': p.telefono || '',
        Email: p.email || '',
        'Puntuación': p.puntuacion,
      }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 12 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Participantes');
    fs.mkdirSync(DESKTOP_DIR, { recursive: true });
    XLSX.writeFile(libro, rutaExcelRonda());
  } catch (err) {
    // El Excel puede estar abierto en ese momento (bloqueado) u otro fallo puntual:
    // no debe impedir que la puntuación se guarde igualmente.
    registrar('error', `No se pudo actualizar el Excel (¿está abierto?): ${err.message}`);
  }
}

function obtenerTop3() {
  const puntuaciones = leerPuntuaciones();
  return [...puntuaciones]
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, 3);
}

function obtenerIPsLocales() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const nombre of Object.keys(interfaces)) {
    for (const iface of interfaces[nombre]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// Cola de escritura: serializa lectura+escritura del fichero (y del Excel) para
// que dos peticiones concurrentes nunca pisen el resultado la una de la otra.
let colaEscritura = Promise.resolve();

function agregarPuntuacion(nuevaEntrada) {
  const tarea = colaEscritura.then(() => {
    const puntuaciones = leerPuntuaciones();
    puntuaciones.push(nuevaEntrada);
    guardarPuntuaciones(puntuaciones);
    actualizarExcel(puntuaciones);
    return obtenerTop3();
  });
  colaEscritura = tarea.catch(() => {});
  return tarea;
}

function reiniciarMarcador() {
  const tarea = colaEscritura.then(() => {
    const ahora = new Date();
    const sufijo = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}_${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;

    rondaSufijo = sufijo;
    guardarRondaActual(rondaSufijo);

    // Nuevo fichero de datos vacío: las puntuaciones anteriores quedan intactas
    // en su fichero de ronda anterior, a modo de histórico.
    guardarPuntuaciones([]);
    actualizarExcel([]);

    return { ronda: rondaSufijo, archivo: path.basename(rutaDatosRonda()) };
  });
  colaEscritura = tarea.catch(() => {});
  return tarea;
}

app.get('/api/top3', (req, res) => {
  res.json(obtenerTop3());
});

app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.get('/api/info', (req, res) => {
  const ips = obtenerIPsLocales();
  const ip = ips[0] || null;
  res.json({
    ip,
    puerto: PORT,
    formularioUrl: ip ? `http://${ip}:${PORT}/formulario.html` : null,
  });
});

app.post('/api/puntuaciones', async (req, res) => {
  const { nombre, apellido, telefono, email, puntuacion } = req.body || {};

  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const apellidoLimpio = typeof apellido === 'string' ? apellido.trim() : '';
  const telefonoLimpio = typeof telefono === 'string' ? telefono.trim() : '';
  const emailLimpio = typeof email === 'string' ? email.trim() : '';
  const puntuacionNum = Number(puntuacion);

  const rechazar = (mensaje) => {
    registrar('warn', `Puntuación rechazada (${nombreLimpio || 'sin nombre'}): ${mensaje}`);
    return res.status(400).json({ error: mensaje });
  };

  if (!nombreLimpio) {
    return rechazar('El nombre es obligatorio.');
  }
  if (!telefonoLimpio && !emailLimpio) {
    return rechazar('Indica al menos un teléfono o un email.');
  }
  if (!Number.isFinite(puntuacionNum)) {
    return rechazar('La puntuación debe ser un número.');
  }
  if (puntuacionNum < 0 || puntuacionNum > 9999 || !Number.isInteger(puntuacionNum)) {
    return rechazar('La puntuación debe ser un número entero entre 0 y 9999.');
  }

  const nuevaEntrada = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    nombre: nombreLimpio,
    apellido: apellidoLimpio,
    telefono: telefonoLimpio || null,
    email: emailLimpio || null,
    puntuacion: puntuacionNum,
    fecha: new Date().toISOString(),
  };

  try {
    const top3 = await agregarPuntuacion(nuevaEntrada);
    const entroEnTop3 = top3.some((p) => p.id === nuevaEntrada.id);
    const posicion = entroEnTop3 ? top3.findIndex((p) => p.id === nuevaEntrada.id) + 1 : null;

    io.emit('top3-actualizado', top3);

    const nombreCompleto = [nuevaEntrada.nombre, nuevaEntrada.apellido].filter(Boolean).join(' ');
    const contacto = [nuevaEntrada.telefono, nuevaEntrada.email].filter(Boolean).join(' / ');
    const puesto = posicion ? `puesto #${posicion}` : 'fuera del top 3';
    registrar('info', `Nueva puntuación: ${nombreCompleto} · ${nuevaEntrada.puntuacion} pts · ${contacto} · ${puesto}`);

    res.status(201).json({ entrada: nuevaEntrada, entroEnTop3, posicion, top3 });
  } catch (err) {
    registrar('error', `No se pudo guardar la puntuación de ${nuevaEntrada.nombre}: ${err.message}`);
    res.status(500).json({ error: 'No se pudo guardar la puntuación.' });
  }
});

app.post('/api/reiniciar', async (req, res) => {
  try {
    const resultado = await reiniciarMarcador();
    io.emit('top3-actualizado', []);
    registrar('info', `Marcador reiniciado. Ronda nueva: ${resultado.archivo}`);
    res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    registrar('error', `No se pudo reiniciar el marcador: ${err.message}`);
    res.status(500).json({ error: 'No se pudo reiniciar el marcador.' });
  }
});

io.on('connection', (socket) => {
  socket.emit('top3-actualizado', obtenerTop3());
  registrar('info', 'Pantalla del marcador conectada');
});

// Errores no previstos de Express (p. ej. JSON mal formado en una petición).
app.use((err, req, res, next) => {
  const estado = err.status || 500;
  registrar(estado >= 500 ? 'error' : 'warn', `${req.method} ${req.path}: ${err.message}`);
  res.status(estado).json({ error: estado >= 500 ? 'Error interno del servidor.' : 'Petición no válida.' });
});

server.listen(PORT, () => {
  registrar('info', `Servidor iniciado correctamente en el puerto ${PORT}`);
  registrar('info', `Ronda: ${rondaSufijo ? `scores-${rondaSufijo}.json` : 'scores.json'} · Excel: ${path.basename(rutaExcelRonda())}`);
  const ips = obtenerIPsLocales();
  if (ips.length === 0) {
    registrar('warn', 'No se ha detectado ninguna red local activa: los móviles no podrán abrir el formulario');
  } else {
    ips.forEach((ip) => registrar('info', `Formulario: http://${ip}:${PORT}/formulario.html`));
  }
});

module.exports = { app, server, io };
