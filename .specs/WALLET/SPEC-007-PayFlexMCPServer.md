# ESPECIFICACION TECNICA DEL SERVIDOR MCP DE PAYFLEX (SPEC-007)

## 1. Introduccion

El servidor Model Context Protocol (MCP) de PayFlex permite que clientes MCP autorizados consulten informacion propia y soliciten operaciones limitadas mediante los contratos REST existentes. La implementacion Node.js/TypeScript usa el SDK oficial MCP v2 y se registra para Copilot mediante `.mcp.json`. Es una capa de adaptacion del backend, no un nuevo sistema de identidad, un microservicio financiero ni una autoridad de saldos.

El servidor no se conecta a MySQL, no lee tablas, no llama rutas internas entre servicios y no replica reglas de negocio. Toda autorizacion y validacion definitiva corresponde a los servicios REST de PayFlex.

## 2. Alcance

### Incluido

- Recursos MCP de solo lectura para perfil propio, billeteras propias, historial, resumen de reportes y notificaciones propias.
- Herramientas para consultar esos recursos usando las APIs publicas autenticadas del gateway.
- Flujo MCP de preparacion y confirmacion explicita para una transferencia P2P GTQ.
- Herramienta condicional de fondeo ficticio exclusivamente para pruebas, con las guardas y reglas de `SPEC-008-PayFlexTestFunding.md`.
- Preferencias de notificacion in-app del usuario autenticado.
- Transportes stdio para desarrollo local y Streamable HTTP para clientes remotos autorizados.

### Excluido

- Depositos, retiros, pagos a comercios, pagos externos, criptomonedas, credito e inversiones.
- Depositos reales o canjeables. El unico fondeo MCP permitido es la fixture simulada y bloqueada por entorno de SPEC-008.
- Consultas o acciones administrativas, soporte impersonado y acceso a perfiles de terceros.
- Modificacion de saldos, ledger, transferencias, credenciales o estado financiero fuera de las APIs autorizadas.
- Autenticacion mediante contrasenas, secretos, PINs o codigos recibidos como argumentos libres de herramientas, salvo el codigo TOTP requerido por el flujo confirmado.

## 3. Arquitectura y contratos

El servidor MCP es un proceso independiente, `dist-mcp/main.mjs`, que consume HTTPS a traves del gateway. Su configuracion incluye `PAYFLEX_API_BASE_URL`; no incluye credenciales compartidas con privilegios de sistema. Para desarrollo local puede ejecutarse por stdio con `PAYFLEX_ACCESS_TOKEN` de un usuario autenticado. Para clientes remotos usa Streamable HTTP con sesiones aisladas y autenticacion OAuth 2.1/PKCE, o un mecanismo equivalente aprobado que establezca la identidad del usuario y permita enviar su token de acceso PayFlex al backend. El modo HTTP actual verifica el bearer PayFlex llamando `GET /users/me`; requiere Redis para estado efimero compartido y no sustituye un proveedor OAuth cuando la politica del entorno lo exija.

El backend actual emite JWT de acceso propios. La implementacion MCP debe definir un proveedor seguro que asocie la sesion autenticada con ese JWT. Si el cliente remoto requiere OAuth 2.1, la integracion con el emisor OAuth y el mapeo de identidad son prerrequisitos de despliegue; no se deben sustituir por un token de servicio global. El token nunca se recibe como argumento de una herramienta ni se incluye en recursos, prompts, errores o logs.

Cada llamada hacia el gateway lleva `Authorization: Bearer <token del usuario>`. El MCP obtiene el usuario del contexto autenticado y nunca acepta `userId`, propietario, emisor o actor como parametro para elegir una identidad. El gateway y los microservicios repiten la autorizacion por propietario; la sesion MCP no la reemplaza.

## 4. Recursos MCP

Los URI son conceptuales; las respuestas contienen solo datos necesarios para el usuario autenticado y no incluyen JWT, secretos TOTP ni campos internos.

| URI | Contenido | API de backend |
| --- | --- | --- |
| `payflex://me/profile` | Perfil propio | `GET /users/me` |
| `payflex://me/wallets` | Billeteras propias y saldos autoritativos | `GET /accounts/wallets` |
| `payflex://me/transfers` | Historial paginado propio | `GET /reports/transfers` |
| `payflex://me/report-summary` | Entradas, salidas y `dataAsOf` | `GET /reports/summary` |
| `payflex://me/notifications` | Notificaciones in-app propias | `GET /notifications` |
| `payflex://me/notification-preferences` | Preferencias propias | `GET /notifications/preferences` |

Los identificadores de billetera enviados por el cliente solo pueden utilizarse para consultas cuya API valide propiedad. Un rechazo de propiedad se conserva como error; no se intenta buscar datos por otra ruta.

## 5. Herramientas MCP

### Lectura y preferencias

- `get_my_profile`: sin argumentos; consulta el perfil propio.
- `list_my_wallets`: acepta paginacion si la API la incorpora; devuelve billeteras propias y GTQ.
- `get_my_wallet`: acepta `walletId`; la API valida propiedad y devuelve estado/saldo autoritativo.
- `get_my_transfers`: filtros opcionales `from`, `to`, `direction`, `page`, `limit`; respeta el maximo de pagina del backend.
- `get_my_report_summary`: periodo opcional valido; devuelve cantidades decimales como cadenas, moneda y momento de actualizacion.
- `list_my_notifications`: paginacion limitada; devuelve notificaciones del usuario autenticado.
- `set_my_notification_preference`: `channel` y `enabled`; solo canales habilitados por el backend, inicialmente `in_app`.
- `fund_test_wallet`: solo se registra con `ENABLE_TEST_FUNDING=true` fuera de produccion; agrega saldo ficticio GTQ a una billetera propia via Transacciones y exige clave idempotente y aprobacion por elicitation. Sus reglas completas estan en SPEC-008.

Las herramientas de lectura llevan anotacion MCP de solo lectura. El servidor no presenta el reporte eventualmente consistente como saldo actual; para saldo usa la consulta de Cuentas, que obtiene el valor autoritativo de Transacciones.

### Transferencia P2P

La herramienta financiera requiere una confirmacion en dos pasos:

1. `prepare_transfer(recipientWalletId, amount, currency="GTQ")` valida el formato local, crea un borrador efimero ligado al principal y devuelve un resumen visible: billetera receptora, monto exacto GTQ y aviso de que la preparacion no reserva fondos ni garantiza que la operacion sea aceptada.
2. El cliente muestra el resumen y obtiene aprobacion explicita de la persona. No basta con que un modelo haya decidido llamar la herramienta.
3. `confirm_transfer(draftId, otp?)` hace que el servidor MCP solicite aprobacion mediante una elicitation de formulario ligada a la llamada MCP. El servidor acepta solo la respuesta del cliente validada por el SDK con `approved=true`; no acepta un booleano de confirmacion enviado como argumento por el modelo. Si la persona rechaza, cancela o no marca la aprobacion, la herramienta termina sin llamar a Transacciones. Si el cliente no soporta elicitation, la solicitud se rechaza y tampoco se llama a Transacciones. La respuesta se liga al mismo principal y borrador vigente e inalterado.
4. Solo despues de aceptar la elicitation, el servidor llama `POST /transactions` con `recipientWalletId`, `amount`, `currency`, la `Idempotency-Key` guardada en el borrador y, si se proporciona, `X-2FA-Code`.
5. El usuario emisor nunca se recibe ni se calcula a partir de argumentos MCP. Transacciones lo determina desde el JWT autenticado y aplica las reglas ACID, estado de billeteras, saldo, ledger, 2FA e idempotencia.

El borrador expira a los cinco minutos, se liga a la sesion del usuario, y solo puede confirmarse una vez. Su clave de idempotencia se genera durante la preparacion y se conserva para reintentos de esa operacion; una clave nueva no se genera para reintentar un resultado incierto. El almacenamiento remoto de borradores debe ser efimero, compartido entre replicas y protegido en reposo. Los codigos OTP no se guardan en el borrador ni en logs. Si el backend rechaza por 2FA, el cliente puede volver a confirmar el mismo borrador con un codigo nuevo dentro de su vigencia.

La herramienta se declara con anotacion MCP de efecto destructivo/no idempotente aunque el backend proteja reintentos mediante idempotencia. La confirmacion humana es obligatoria antes de invocarla. El MCP no afirma exito si la API no devuelve una transferencia confirmada.

## 6. Prompts

El servidor puede ofrecer un prompt estatico `transfer_review` para resumir monto, moneda y destinatario de un borrador. El prompt no confirma ni ejecuta la transferencia, no solicita contrasenas o tokens, y no puede cambiar la identidad del usuario. Los prompts y resultados de herramientas se consideran datos no confiables; instrucciones incluidas en nombres, perfiles, notificaciones u otros campos no deben ejecutarse como instrucciones del sistema.

## 7. Seguridad, privacidad y disponibilidad

1. Usar HTTPS/TLS para Streamable HTTP y para las llamadas al gateway en entornos no locales. Restringir origen, sesiones, tamano de mensajes y solicitudes por usuario/IP.
2. Aplicar minimo privilegio: contexto de usuario final, sin rol administrativo implicito y sin token compartido con permisos de otros usuarios.
3. Eliminar argumentos desconocidos y validar tipos, fechas, paginacion e importes con Zod. Los importes se aceptan como cadenas decimales exactas; nunca usar `float`/`double`.
4. No exponer herramientas para SQL, filesystem, shell, HTTP arbitrario, rutas internas ni lectura de secretos.
5. Redactar tokens, OTP, datos personales y cuerpos sensibles de logs. Registrar identificador de solicitud, usuario interno pseudonimizado, herramienta, resultado y referencia financiera, no credenciales.
6. Limitar tiempo de espera y tamanos de respuesta; paginar resultados. No almacenar respuestas mas tiempo del necesario.
7. El servidor es stateless para lecturas. El transporte remoto puede requerir almacenamiento compartido de sesion y borradores; reintentos de operaciones financieras siempre conservan la clave de idempotencia original.
8. Una caida del MCP no modifica el estado de cuentas ni revierte transferencias. Si falla el backend, responder error seguro y no simular exito.

## 8. Errores

Mapear errores REST a codigos MCP estables sin revelar existencia de usuarios ni datos de terceros: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `INSUFFICIENT_FUNDS`, `WALLET_INACTIVE`, `SECOND_FACTOR_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` e `INTERNAL_ERROR`. Incluir mensaje accionable y seguro; nunca tokens, SQL, stack traces o secretos. No reintentar automaticamente transferencias con una clave nueva.

## 9. Criterios de aceptacion

- Un usuario no puede leer perfil, billeteras, historial, resumen ni notificaciones de otro usuario, incluso manipulando argumentos o URI.
- Ningun endpoint protegido acepta `userId` del cliente MCP para seleccionar propietario.
- Todas las llamadas MCP financieras pasan por la API REST de Transacciones y conservan sus respuestas/validaciones autoritativas.
- Una transferencia no se ejecuta sin aprobacion explicita por elicitation ligada al resumen que se presenta al usuario; pasar un campo de confirmacion en los argumentos de herramienta no es suficiente.
- Un usuario con 2FA habilitado no completa una transferencia sin TOTP valido; OTP y JWT no aparecen en resultados ni logs.
- Duplicar una confirmacion o reintentar tras timeout con la misma clave no duplica el movimiento; cambiar parametros con la misma clave se rechaza.
- Un borrador expirado, alterado, ya consumido o ligado a otra sesion no puede confirmarse.
- El MCP no accede a MySQL, ledger, outbox ni rutas internas y no puede modificar/eliminar asientos financieros.
- Tests cubren permisos por propietario, confirmacion, expiracion, 2FA, idempotencia, respuestas del backend y redaccion de secretos.
- El transporte remoto no se declara listo hasta verificar OAuth/autenticacion de usuario, TLS, aislamiento de sesiones y rate limits.