# Monedi

App de finanzas personales (PWA) para registrar ingresos, egresos y transferencias en segundos.

## Estado

| Fase | Estado |
|---|---|
| 1. Requerimientos | ✅ ([docs/REQUERIMIENTOS.md](docs/REQUERIMIENTOS.md)) |
| 2. Diseño | ✅ Bocetos aprobados |
| 3. Cuentas, categorías, ingresos, egresos, transferencias | ✅ |
| 4. Dashboard, gráficos y resumen mensual | Pendiente |
| 5. Registro rápido desde el iPhone (toque posterior) y sincronización | Pendiente |
| 6. Pruebas, seguridad y mejoras | Pendiente |

## Cómo funciona (en sencillo)

- **Datos:** se guardan en el propio dispositivo (IndexedDB), al instante y sin internet.
  La sincronización en la nube entre dispositivos llega en la Fase 5.
- **Saldos:** nunca se guardan "a mano": se calculan a partir de los movimientos,
  por eso editar o eliminar un movimiento siempre deja todo cuadrado.
- **Montos:** enteros en pesos (COP), sin decimales.
- **Importar categorías** (Categorías › botón de subir): desde una foto o captura, un Excel (.xlsx), un CSV o texto pegado.
  Las imágenes se leen en el propio dispositivo (OCR en español con Tesseract); no se envían a ningún servidor.
- **Respaldo:** Más › Respaldo permite descargar un `.json` completo, exportar a Excel (`.csv`) y restaurar.

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm test         # pruebas de la lógica (saldos, periodos, validaciones, respaldo)
npm run build    # versión de producción en dist/
```

Se publica automáticamente en GitHub Pages con `.github/workflows/deploy.yml`.

## Estructura

```
src/
  db/          modelo de datos y base local (Dexie / IndexedDB)
  lib/         lógica: cálculos, periodos, validaciones, respaldo, rutas
  components/  íconos y piezas de interfaz
  screens/     pantallas (Inicio, Registro, Historial, Cuentas, Categorías, Más, Bienvenida)
public/        manifest, íconos, service worker, plantillas
```
