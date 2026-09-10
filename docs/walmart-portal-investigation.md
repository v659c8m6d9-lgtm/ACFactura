# Investigación técnica: portal de facturación Walmart / Bodega Aurrera

**Fecha:** 2026-09-10
**Portal investigado:** https://facturacion-clientes.walmart.com/ticket
**Método:** inspección de solo lectura — DOM del formulario real, análisis estático
del bundle JS público de producción, y una prueba de CORS de lectura contra un
endpoint de catálogo (sin datos sensibles). **No se envió ningún dato — real ni
ficticio — al formulario real** (ver sección "Qué NO se hizo" al final).

---

## 1. Resumen ejecutivo

- El portal es un **SPA en React** servido estáticamente, que habla con un
  **backend propio en Azure Functions** montado en el mismo origen (`/api/*`).
- El flujo de "Facturar/Refacturar" pide exactamente **4 campos**:
  `membershipOrRFC`, `postalCode` (opcional), `ticketNumber` y
  `transactionNumber` — coincide 1:1 con lo que `WalmartParser` ya extrae
  como TC# y TR#.
- **CORS bloqueado**: confirmado empíricamente que el backend no acepta
  peticiones desde otro origen. Un frontend puro en GitHub Pages no puede
  hablar directo con esta API.
- **No hay CAPTCHA ni librería anti-bot** en el bundle (se buscó
  explícitamente: reCAPTCHA, hCaptcha, Turnstile, GeeTest, fingerprinting —
  cero coincidencias). El endpoint `VerificaTag`, que en la iteración anterior
  se documentó como "probable anti-bot", **en realidad no lo es**: verifica si
  el ticket corresponde a una venta de "Automotor" (motocicletas Italika),
  una regla de negocio, no una protección anti-automatización.
- El número de transacción (TR#) **no es una clave de búsqueda independiente**:
  el ticket (TC#) se desencripta en el servidor y el TR# ingresado por el
  usuario se compara contra el valor decodificado. Es un código de
  verificación embebido en el propio ticket, no un campo separado en una base
  de datos.
- Hay reglas de negocio explícitas que bloquean la facturación: tarjetas de
  regalo, ventana de 24 horas post-compra, cancelación activa del ticket,
  y tipo de ticket no facturable (grupal, manual, Horeca).

---

## 2. Flujo del portal, paso a paso

### Pantalla 1 — Bienvenida
`https://facturacion-clientes.walmart.com/` (redirige a `/ticket`)
Modal inicial "CFDI VERSION 4.0" con una imagen de ejemplo de cómo capturar
los datos fiscales (RFC, Razón Social, Calle, Número exterior/interior,
Colonia, Municipio/Delegación, Código Postal, Correo, Régimen Fiscal, Uso de
Factura). Botón único: **Aceptar**.

Esa misma imagen de ejemplo muestra un ticket real de Walmart con el texto
**"WAL★MART TR# 09286"** — confirma visualmente el formato `TR# ` (con
espacio) que ya contempla la normalización de `WalmartParser`.

### Pantalla 2 — Opciones
Botón **"Tengo un ticket" → Obtener factura**.

### Pantalla 3 — Formulario "Facturar / Refacturar"
Dos pestañas: **Facturar** (la que nos interesa) y **Consulta o reenvía tu
factura** (para re-obtener una factura ya generada — usa un formulario y flujo
distintos, con endpoints propios como `/GetSetInfo` y `/ConsultaSerie`, no
investigados a fondo por no ser el objetivo de esta iteración).

Campos reales del formulario "Facturar" (inspeccionados directo del DOM):

| Campo (`name`)       | Label mostrado      | Tipo  | Requerido | maxlength | pattern | Validación cliente |
|-----------------------|----------------------|-------|-----------|-----------|---------|---------------------|
| `membershipOrRFC`     | MEMBRESÍA O RFC      | text  | Sí        | 17        | —       | RFC persona física (`^[A-ZÑ&]{4}\d{6}([A-Z0-9]{3})?$`), RFC persona moral (`^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$`), el RFC genérico `XAXX010101000`, o puramente numérico 1-17 dígitos (membresía Sam's Club) |
| `postalCode`          | Código Postal        | text  | No        | 5         | —       | — |
| `ticketNumber`        | Número de Ticket     | text  | Sí        | 25        | `\d*`   | solo dígitos |
| `transactionNumber`   | # Transacción        | text  | Sí        | 5         | `\d*`   | solo dígitos, no vacío |

El campo `membershipOrRFC` acepta tanto un RFC como un número de membresía
Sam's Club — el mismo backend sirve Walmart, Bodega Aurrera **y** Sam's Club
(confirmado por el catálogo de tipos de cliente: `MembresiaSams`,
`PersonaFisica`, `PersonaMoral`, `PersonaFisicaGenerica`,
`PersonaMoralGenerica`, `Indeterminado`).

---

## 3. Secuencia real de llamadas de red

Reconstruida leyendo el código fuente del bundle de producción
(`/static/js/main.de689f7d.js`, 846 KB), no observada en vivo (ver sección
"Qué NO se hizo").

### Paso 1 — clic en "Continuar" del formulario Facturar

Antes de tocar el backend, valida en cliente: formato de `membershipOrRFC`,
que `ticketNumber` no esté vacío, que `transactionNumber` no esté vacío.
Si pasa, en orden:

1. **`GET /OnlyDecryptTicket?tc=<ticketNumber>`**
   Desencripta el ticket en el servidor y devuelve su información
   (`TicketInfo`), que incluye el número de transacción real embebido en el
   ticket.
2. **Verificación de transacción (sin llamada de red):**
   compara `Number(TicketInfo.Transaccion)` contra
   `Number(transactionNumber)` ingresado por el usuario. Si no coinciden:
   *"Número de transacción es incorrecto"*. Esto confirma que **TR# es un
   código de verificación embebido en el ticket, no una clave de búsqueda
   independiente** — el backend ya "sabe" cuál es antes de que el usuario lo
   escriba; solo lo usa para confirmar que quien factura tuvo el ticket físico
   en mano.
3. **`GET /ObtenerTipoFactura?tc=<ticketNumber>`** (con reintento automático:
   hasta 3 intentos, 1s de espera entre cada uno, solo ante error 5xx/404)
   Devuelve el tipo de ticket. Si el tipo es `TarjetaRegalo`, `Grupal`,
   `Manual` u `Horeca`, se bloquea: *"El ticket no puede ser facturado por
   este medio"*.
4. **`GET /ObtenerArticulos?tc=<ticketNumber>`**
   Devuelve los artículos del ticket (usado también para renglones de la
   factura). Sobre este resultado se revisan 3 casos que bloquean el flujo:
   - contiene `"ProgramaSF"` → *"Su ticket no puede ser facturado"*
   - contiene `"regalo"` → *"las tarjetas de regalo son artículos no
     facturables"*
   - contiene `"Por el momento"` → *"reintentarlo 24 horas posteriores a su
     compra"* — **ventana de embargo de 24h post-compra**.
5. **`POST /VerificaTag`** con body `{ xml: <artículos del paso anterior> }`
   Determina si el ticket corresponde a una venta de **Automotor**
   (motocicletas Italika). Si lo es y el flujo actual no es el de automotor,
   bloquea con *"El Automotor no puede facturarse por este medio"*.
   **No es anti-bot ni CAPTCHA** — corrijo así la hipótesis de la iteración
   anterior.
6. **`GET /CancelacionActiva?ticketNbr=<ticketNumber>`**
   Verifica que no exista ya una cancelación activa sobre ese ticket.

Si todo pasa, el estado se guarda en `sessionStorage` (clave `apiState`) y
la SPA navega (client-side, React Router) a la pantalla de captura/confirmación
de datos fiscales.

### Paso 2 — pantalla de datos fiscales + método de entrega → "generar factura"

Este es un componente distinto (`invoice_generation_form`), con su propio
`onSubmit`. Arma un payload combinando `TcInfo` (con los datos ya obtenidos en
el paso 1: `TCNumero`, `NoTransaccion`, `NoTienda`, `NoTerminal`,
`MontoCargado`, `FeTransaccion`, `CveformapagoSAT`, `Articulos`, `Impuestos`,
`Descuentos`, etc.) con `Cliente` (los datos fiscales capturados) y llama:

1. **`POST /ObtenerInfoConjuntoTcInfo`** con el `TcInfo` armado.
2. **`POST /ObtenerInfoConjunto`** con el resultado del paso anterior —
   combina ticket + datos fiscales en un solo objeto de "solicitud de
   factura".
3. (Fuera del alcance de esta lectura de código, pero declarado en el bundle
   como función separada) **`POST /ObtenerFactura`** — es la función que
   efectivamente genera/timbra el CFDI.
4. Recuperación del PDF: `GET /ConsultarFacturaMotorPDFWeb?serie=...&folio=...`
   o `POST /ConsultarFacturaMotorPDF?reintentarPorId=...` (retorna un blob).

Si el modo es "Refacturar" (`s === "R"`) en vez de "Facturar", el primer paso
cambia a **`POST /GetInfoSetReinvoice`** en lugar de
`ObtenerInfoConjuntoTcInfo`.

---

## 4. Estructura de datos observada (`TcInfo` / `Cliente`)

Reconstruida de los objetos default y del armado del payload en el bundle:

```js
TcInfo: {
  NoTienda, NoTransaccion, NoTerminal, FeTransaccion, TCNumero,
  MontoCargado, CveformapagoSAT, IdCompania, TipoDecriptor,
  Transaccion: {
    Articulos: [],
    Impuestos: [],
    Descuentos: [],
    TransaccionBaderas: {},
    TotalImpuestos,
  },
  LeyendaAdicional,
}

Cliente: {
  Cliente_Id, Cliente_Nombre, Cliente_Rfc, Cliente_EsGenerico,
  Cliente_Rfc_iva, Cliente_Rfc_ieps, Cliente_Correo_Electronico,
  Cliente_Membresia_Sams, Domicilio_Id, Cliente_EsExtranjero,
  Cliente_Dom_Calle, Cliente_Dom_Num_Int, Cliente_Dom_Num_Ext,
  Cliente_Dom_Referencia, Cliente_Dom_Colonia,
  Cliente_Dom_Delegacion_Municipio, Cliente_Dom_Ciudad_Estado,
  Cliente_Dom_Codigo_Postal, Cliente_UsoCfdiDesc, Cliente_UsoCfdiCve,
  Cliente_ResidenciaFiscal, RegimenFiscal, Cliente_Paterno, Cliente_Materno,
  Cliente_RazonSocial, Cliente_ExtranjeroResidente,
  TuristaPasajeroExtranjero: {
    tipoTransitoField, fechadeTransitoField,
    datosTransitoField: { nacionalidadField, tipoIdField, numeroIdField,
                           viaField, empresaTransporteField, idTransporteField },
  },
}
```

`TuristaPasajeroExtranjero` sugiere un flujo adicional para "pasajero
extranjero" (devolución de IVA en frontera/aeropuerto) — no relevante para
Bodega Aurrera pero confirma que el mismo backend sirve varios flujos de
facturación bajo un solo formulario.

Nota sobre RFC genérico: el propio portal usa como fallback exactamente
`XAXX010101000` (nacional) / `XEXX010101000` (extranjero) cuando
`Cliente_EsGenerico` es verdadero — son los mismos RFC genéricos oficiales del
SAT que ya usamos en nuestras pruebas.

---

## 5. Catálogo de endpoints identificados (`/api/*`, mismo origen)

| Endpoint | Método | Uso |
|---|---|---|
| `OnlyDecryptTicket?tc=` | GET | Desencripta el ticket, incluye transacción real |
| `ObtenerTipoFactura?tc=` | GET | Tipo de ticket (normal/regalo/grupal/manual/horeca) |
| `ObtenerArticulos?tc=` | GET | Line items del ticket |
| `VerificaTag` | POST | Detecta venta de Automotor (Italika) — **no es anti-bot** |
| `CancelacionActiva?ticketNbr=` | GET | Cancelación activa sobre el ticket |
| `ObtenerInfoConjuntoTcInfo` | POST | Paso 2: confirma/expande TcInfo con datos fiscales |
| `ObtenerInfoConjunto` | POST | Paso 2: combina ticket + fiscal en solicitud de factura |
| `ObtenerFactura` | POST | Genera/timbra el CFDI |
| `GetInfoSetReinvoice` | POST | Igual que ObtenerInfoConjuntoTcInfo pero para refacturación |
| `ConsultarFacturaMotorPDFWeb?serie=&folio=` | GET | Descarga PDF por serie/folio |
| `ConsultarFacturaMotorPDF?reintentarPorId=` | POST | Descarga PDF (blob), con reintento |
| `GetSetInfo?ticketCompraOSerieFolio=` | GET | Usado en la pestaña "Consulta o reenvía tu factura" |
| `ConsultaSerie` | POST | Idem, pestaña de consulta |
| `RegistraActualizaCliente` | POST | Alta/actualización de datos de cliente |
| `GetRealPaymentMethod` / `ValidatePaymentMethod` | POST | Validación de forma de pago SAT |
| `GetCatalogoUsoCfdi` | GET | Catálogo de Uso CFDI (SAT) |
| `ObtenerCatRegimenFiscal` | GET | Catálogo de Régimen Fiscal (SAT) |
| `ObtenClientDomCol` | GET | Catálogo de colonias por código postal |
| `IsRFCInHoreca?rfc=` | GET | Detecta si el RFC pertenece a un cliente Horeca |
| `ObtenerDescripcionError` | GET | Catálogo centralizado de mensajes de error |
| `GetCatalogoAutomotor` / `ConsultaAutomotorItalika` / `ConsultaVentaItalikaEnWalmart` / `ObtAutomotor` / `RegistraVentaItalikaEnWalmart` | GET/POST | Flujo específico de venta de motocicletas Italika |
| `ObtInfoAduaneraActual` | GET | Info aduanera (pasajero extranjero) |

---

## 6. CORS — prueba empírica

Desde `https://v659c8m6d9-lgtm.github.io` (nuestro propio dominio, ya
publicado) se ejecutó:

```js
fetch('https://facturacion-clientes.walmart.com/api/GetCatalogoUsoCfdi',
      { method: 'GET', mode: 'cors' })
```

**Resultado: `TypeError: Failed to fetch`.** No se registró ninguna petición
completada en el panel de red del propio origen — consistente con un rechazo
CORS del lado del navegador (el backend de Walmart no declara
`Access-Control-Allow-Origin` para orígenes de terceros). Se probó contra un
endpoint de solo catálogo, sin datos sensibles, precisamente para no arriesgar
nada real; el comportamiento CORS de un backend es global por servidor, así
que este resultado aplica igual a los endpoints de facturación.

**Conclusión: un frontend puro en GitHub Pages no puede completar ningún paso
de este flujo contra el backend real de Walmart.**

---

## 7. Qué se necesitaría para integración real

1. **Backend propio (mínimo indispensable)** — un proxy que reciba la
   petición de AC Factura y la reenvíe al backend de Walmart desde un
   servidor (sin restricción CORS del lado servidor-a-servidor). Esto por sí
   solo **no garantiza que funcione**: el flujo depende de estado de sesión
   entre pasos (`sessionStorage` del lado del navegador de Walmart) y de
   llamadas encadenadas con reintentos — replicar esa coreografía a mano
   contra una API no documentada y sujeta a cambios es fragil.
2. **Automatización de navegador real (más robusto)** — dado que no hay
   CAPTCHA ni anti-bot detectado, un enfoque tipo Playwright/Puppeteer
   headless que abra el portal real, llene el formulario y siga el flujo tal
   cual lo haría una persona, es técnicamente viable y más resistente a
   cambios internos del bundle que reimplementar las llamadas `/api/*` a
   mano. Sigue requiriendo un backend/servidor (no puede correr en GitHub
   Pages).
3. **Manejo de los bloqueos de negocio** — cualquier automatización real
   necesita anticipar y comunicarle al usuario los casos que el propio
   portal bloquea: tarjeta de regalo, ventana de 24h post-compra,
   cancelación activa del ticket, tipos de ticket no facturables (grupal,
   manual, Horeca), venta de Automotor.
4. **Aspecto legal/términos de servicio** — el portal no publica una API
   pública ni documentación para terceros; automatizarlo probablemente cae
   fuera de sus términos de uso. Antes de construir la integración real vale
   la pena revisar esto explícitamente (no es un tema técnico, es una
   decisión de producto/legal que le corresponde a AC Contadores).

Nada de esto se implementa en esta iteración — queda documentado como el
siguiente paso posible.

---

## 8. Qué NO se hizo (por seguridad y alcance)

- No se envió el ticket real de Bodega Aurrera (ni ningún dato, real o
  ficticio) al formulario del portal. Un intento de llenar el formulario con
  datos de prueba fue bloqueado automáticamente por el clasificador de
  seguridad del entorno de trabajo, y no se buscó ninguna forma de evadirlo.
- No se generó, ni se intentó generar, ninguna factura real.
- Todo lo documentado en la sección 3 (secuencia de llamadas) proviene de
  **leer el código fuente público** del bundle JavaScript de producción
  (`main.de689f7d.js`), no de observar tráfico de red en vivo — es la
  reconstrucción más fiel posible sin interactuar con el formulario real.
