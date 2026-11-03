# Requerimientos — App de Finanzas Personales

> Documento vivo. Fase 1 (definición de requerimientos). Última actualización: 2026-11-03.

## 1. Visión

Una app personal, muy visual y rápida, para registrar **todos** los ingresos, egresos y transferencias,
controlar el dinero en cada banco y en efectivo, y ver en tiempo real cómo van las finanzas.
**Prioridad absoluta:** registrar un movimiento en menos de 5 segundos desde el iPhone.

## 2. Usuarios

- Multiusuario con **cuentas independientes**: cada persona (p. ej. la usuaria y su mamá) inicia sesión
  con su correo y ve **solo sus propios datos**. No hay datos compartidos entre usuarios.
- Dispositivo principal: **iPhone**. También uso en computador.
- Volumen esperado: más de 300 movimientos/mes por usuario.

## 3. Arquitectura

| Aspecto | Decisión |
|---|---|
| Tipo de app | PWA instalable (iPhone, Android, computador) |
| Interfaz | React + TypeScript |
| Almacenamiento | Local primero (IndexedDB) + sincronización con la nube |
| Nube / autenticación | Supabase (PostgreSQL + login por correo + seguridad por filas: cada usuario solo accede a lo suyo) |
| Sin conexión | Sí: se registra sin internet y se sincroniza al recuperar conexión |
| Montos | Enteros en pesos (sin decimales) para evitar errores de redondeo |
| Saldos | **Calculados** a partir de los movimientos (nunca se descuadran al editar/eliminar) |
| Moneda | COP. Modelo de datos preparado para multimoneda, sin activarlo aún |
| Bloqueo PIN/biometría | **No** (descartado por la usuaria) |

## 4. Registro rápido (iPhone)

- Acceso mediante **Toque posterior** (Ajustes › Accesibilidad › Tocar › Toque posterior → doble toque)
  ejecutando un Atajo de iOS que abre la app directamente en la pantalla de registro.
- Alternativa adicional: ícono de la app en la pantalla de inicio que abre en registro rápido.
- Diseño de pantalla: **teclado numérico primero** (estilo Moneyfy), luego cuadrícula de categorías con íconos.
- Campos:
  - **Obligatorios:** tipo (ingreso/egreso), valor, cuenta/banco, categoría, y subcategoría *si la categoría tiene subcategorías*.
  - **Automáticos:** fecha = hoy; cuenta preseleccionada = última usada.
  - **Opcionales (expandibles):** cambiar fecha, nota/descripción.
- También debe existir el formulario completo para registrar con todos los datos.
- **Plantillas/favoritos:** movimientos frecuentes registrables con un toque.

## 5. Cuentas

- Tipos: ahorros, corriente, billetera digital, efectivo, tarjeta de crédito (soportado para el futuro; hoy no se usa), inversión, otra.
- Campos: nombre, tipo, ícono/color, saldo inicial, saldo actual (calculado).
- **No hay cuentas predeterminadas:** cada usuario crea las suyas al empezar (pantalla de bienvenida guiada).
  Ejemplo de la usuaria principal: Bancolombia y Efectivo.
- **Todas** las cuentas suman al total disponible (no se excluye ninguna).
- Se pueden **archivar** cuentas sin perder su historial.
- **Transferencias** entre cuentas propias: no cuentan como ingreso ni egreso.

## 6. Categorías

- **Cada usuario crea sus propias categorías** desde cero (no se cargan predeterminadas ni se copian entre usuarios).
  La usuaria principal enviará su lista para precargarla en su cuenta.
- Categorías de ingreso y de egreso, cada una con subcategorías opcionales.
- Cada categoría tiene **ícono y color**.
- Crear, editar, eliminar. Al eliminar una categoría con movimientos, la app pide **reasignarlos** a otra antes de borrar.

### 6.1 Categorías iniciales de la usuaria principal

Los valores se usan como **presupuesto mensual** por categoría/subcategoría desde la versión 1 (avance "llevas X de Y"). Las alertas llegan en la Etapa 2.

**Egresos**

| Categoría | Subcategorías | Valor ref. |
|---|---|---:|
| Gimnasio | — | 120.000 |
| Salidas | Alimentación (100.000), Transporte (160.000), Extras (100.000) | 360.000 |
| Universidad | Alimentación (180.000), Transporte (280.000), Gastos extra (40.000) | 500.000 |
| Suplementos | — | 200.000 |
| Gastos extra | — | 200.000 |
| Insumos panes | — | 540.000 |
| **Total** | | **1.920.000** |

**Ingresos**

| Categoría | Valor ref. |
|---|---:|
| Trabajo mamá | 600.000 |
| Panes | 1.300.000 |
| Papá | 260.000 |
| Sostenimiento Sapiencia | 180.000 |
| **Total** | **2.340.000** |

(Se eliminaron "Boxeo" de egresos y "Eliani" de ingresos.)

### 6.2 Reglas especiales

- **Gasto cubierto por un ingreso (Universidad ← Papá):** una categoría de egreso puede vincularse a una categoría
  de ingreso que la financia. El dashboard muestra:
  - **Total de gastos** (todos).
  - **Mi aporte** = total de gastos − gastos de categorías cubiertas (equivale al "Total mi aporte" del Excel: 1.920.000 − 500.000 = 1.420.000).
  - Tarjeta "Universidad": recibido de Papá vs. gastado.
- **Ganancia del negocio (Panes):** tarjeta en el dashboard = ingresos "Panes" − egresos "Insumos panes"
  (referencia: 1.300.000 − 540.000 = 760.000/mes). Diseñado de forma general ("proyecto" que agrupa una categoría
  de ingreso y una de egreso) para poder crear otros negocios en el futuro.

## 7. Dashboard

- Dinero total disponible y saldo por cuenta.
- Ingresos, egresos y balance del periodo.
- % de ingresos gastado (periodo actual) **y promedio de los últimos 3 periodos**.
- Top de categorías de gasto.
- Últimos movimientos.
- Gráficos: ingresos vs egresos, distribución por categoría, evolución del gasto en el periodo, evolución del saldo en el tiempo.
- Actualización inmediata al registrar.

## 8. Historial

- Listado de todos los movimientos.
- Filtros: tipo, cuenta, categoría, subcategoría, rango de fechas; búsqueda por descripción.
- Editar y eliminar, con recálculo automático de saldos y estadísticas.

## 9. Resumen por periodo

- **Periodo configurable**: mes calendario o día de inicio personalizado (p. ej. del 15 al 14).
- Totales, balance, top categorías, comparación con periodos anteriores, movimientos del periodo.
- Consulta de periodos anteriores sin pérdida de información.

## 10. Diseño

- Moderno, minimalista, identidad propia (referencia: Moneyfy).
- Paleta **Esmeralda**: verde esmeralda profundo como color principal con acentos dorados suaves; ingresos en verde, egresos en coral/rojo.
- Modo claro y oscuro (automático según el sistema, con opción manual).
- Interfaz **adaptada** a celular y a computador, no solo reducida.
- Nombre de la app: **Monedi** (provisional).

## 11. Respaldo

- Copia en la nube (sincronización automática).
- **Exportar** respaldo completo (Excel/CSV/JSON) e **importar** desde ese respaldo.

## 12. Hoja de ruta de funcionalidades adicionales

| Prioridad | Funcionalidad |
|---|---|
| Versión 1 | Plantillas/favoritos · Ocultar saldos · Exportar/importar respaldo · Soporte de tarjeta de crédito (modelo de datos) |
| Etapa 2 | Presupuestos por categoría con alertas · Gastos/ingresos recurrentes · Deudas y préstamos |
| Etapa 3 | Metas de ahorro · Recordatorios de pago |
| Futuro | Etiquetas · Foto de recibo · Cálculo de 4×1000 (GMF) · Exportar a PDF · Multimoneda |

## 13. Fases

1. Requerimientos y planificación ✅
2. Diseño UX y estructura visual ← **actual**
3. Cuentas, categorías, ingresos, egresos, transferencias
4. Dashboard, gráficos, resúmenes
5. Registro rápido y optimización móvil
6. Pruebas, seguridad y mejoras

## 14. Pendientes para cerrar la Fase 1

- [x] Cuentas: cada usuario crea las suyas (usuaria principal: Bancolombia, Efectivo)
- [x] Lista de categorías y subcategorías (sección 6.1)
- [x] Valores de referencia = presupuesto mensual
- [x] "Total mi aporte" = gastos sin Universidad (cubierta por Papá)

**Fase 1 cerrada el 2026-11-03.**
- [x] Nombre de la app: Monedi (provisional)
- [x] Paleta de colores: Esmeralda
