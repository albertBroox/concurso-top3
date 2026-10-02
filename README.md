# Concurso Top 3

App de concurso con puntuaciones para un evento presencial: una pantalla pública muestra el podio (las 3 mejores puntuaciones) en tiempo real y un formulario web, pensado para móvil, registra a cada participante. Todo funciona en la **red local**, sin internet.

- **Marcador** (`/marcador.html`): diseño del cliente a 1920×1080, se actualiza solo por Socket.io. Doble clic en la pantalla muestra/oculta la URL del formulario.
- **Formulario** (`/formulario.html`): nombre (obligatorio), apellido (opcional, solo para el Excel), teléfono o email (al menos uno) y puntuación (entero 0–9999). Menú ☰ con "Reiniciar marcador".
- **Aplicación de escritorio**: Electron abre el marcador en modo kiosco y arranca el servidor Express para los móviles. `Esc` cierra la aplicación.
- **Datos**: se guardan en JSON y se vuelcan a un Excel en el Escritorio (`Nombre, Apellido, Teléfono, Email, Puntuación`). "Reiniciar marcador" abre una ronda nueva con ficheros fechados y conserva la anterior.

## Desarrollo

```bash
npm install
npm start            # solo el servidor: http://localhost:3000/marcador.html
```

Variables opcionales: `PORT` (3000), `DATA_DIR` (datos JSON), `DESKTOP_DIR` (carpeta del Excel).

## Empaquetado (PC del evento)

```powershell
npm install
npm run empaquetar   # genera dist\ConcursoTop3\ConcursoTop3.exe (carpeta portable)
```

Añade `-Zip` al script (`scripts/empaquetar.ps1 -Zip`) para generar también `dist\ConcursoTop3.zip`. El paquete incluye el runtime de Electron y las dependencias: en el PC del evento solo hay que descomprimir la carpeta entera y ejecutar `ConcursoTop3.exe` (Windows 10/11 de 64 bits, sin instalar nada más).

El script existe porque `electron-builder` descarga herramientas desde GitHub y falla en redes que bloquean esos dominios; `npm run dist` sigue disponible en redes normales.

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/top3` | Las 3 mejores puntuaciones de la ronda actual |
| GET | `/api/info` | IP local y URL del formulario |
| POST | `/api/puntuaciones` | Registra una puntuación (`nombre`, `apellido?`, `telefono?`, `email?`, `puntuacion`) |
| POST | `/api/reiniciar` | Abre una ronda nueva (la anterior queda archivada) |

## Documentación

- [Manual técnico para el cliente](docs/Manual-Tecnico-Concurso-Top3.pdf): montaje del hardware, arranque, uso y solución de problemas.

## Licencias de terceros

La tipografía Pixel Operator (`public/fonts/`) se distribuye con su licencia en `public/fonts/LICENSE-PixelOperator.txt`. El fondo del marcador (`public/images/`) es material de diseño del cliente: mantener el repositorio privado.
