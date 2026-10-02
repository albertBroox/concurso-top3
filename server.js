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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/marcador.html'));

function leerPuntuaciones() {
  try {
    const raw = fs.readFileSync(rutaDatosRonda(), 'utf-8');
    const datos = JSON.parse(raw);
    return Array.isArray(datos) ? datos : [];
  } catch (err) {
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
    console.error('No se pudo actualizar el Excel del escritorio:', err.message);
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

  if (!nombreLimpio) {
    return res.status(400).json({ error: 'El nombre es obligatorio.' });
  }
  if (!telefonoLimpio && !emailLimpio) {
    return res.status(400).json({ error: 'Indica al menos un teléfono o un email.' });
  }
  if (!Number.isFinite(puntuacionNum)) {
    return res.status(400).json({ error: 'La puntuación debe ser un número.' });
  }
  if (puntuacionNum < 0 || puntuacionNum > 9999 || !Number.isInteger(puntuacionNum)) {
    return res.status(400).json({ error: 'La puntuación debe ser un número entero entre 0 y 9999.' });
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

    res.status(201).json({ entrada: nuevaEntrada, entroEnTop3, posicion, top3 });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar la puntuación.' });
  }
});

app.post('/api/reiniciar', async (req, res) => {
  try {
    const resultado = await reiniciarMarcador();
    io.emit('top3-actualizado', []);
    res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo reiniciar el marcador.' });
  }
});

io.on('connection', (socket) => {
  socket.emit('top3-actualizado', obtenerTop3());
});

server.listen(PORT, () => {
  console.log(`Concurso Top 3 escuchando en el puerto ${PORT}`);
  console.log(`  Marcador (en el PC de la pantalla):   http://localhost:${PORT}/marcador.html`);
  console.log(`  Excel de participantes: ${rutaExcelRonda()}`);
  console.log('');
  console.log('  Formulario, abrir desde el móvil conectado a la misma red local:');
  const ips = obtenerIPsLocales();
  if (ips.length === 0) {
    console.log('    (no se ha detectado ninguna red local activa)');
  } else {
    ips.forEach((ip) => console.log(`    http://${ip}:${PORT}/formulario.html`));
  }
});

module.exports = { app, server, io };
