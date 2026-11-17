# PLAN DE IMPLEMENTACION (PROYECTO PAYFLEX)

Implementar las fases en orden, revisando los criterios de aceptación de las especificaciones. El alcance inicial es autenticación, usuarios, billeteras, transferencias P2P, notificaciones y reportes. No se implementan depósitos, retiros ni proveedores externos hasta aprobar su alcance.

## Fase 1: Arquitectura y Base de Datos (Inputs y Modelos)
- Generar el diagrama de arquitectura Mermaid con los seis microservicios y contratos de comunicación.
- Definir esquemas y scripts MySQL para usuarios, credenciales, billeteras, transferencias, ledger, idempotencia y auditoría.
- Mantener los asientos y actualización de ambos saldos en una única transacción ACID; solo Transacciones escribe saldos y ledger.
- Documentar índices, claves foráneas, restricciones de saldo no negativo y estrategia de eventos durables.

## Fase 2: Backend Core (Lógica de Negocio)
- Implementar Autenticación (SPEC-001) y Usuarios (SPEC-002).
- Implementar Cuentas/Billeteras (SPEC-003), sin modificar saldos.
- Implementar Transacciones (SPEC-004) con ledger balanceado, idempotencia, bloqueos y pruebas de concurrencia.
- Implementar Notificaciones (SPEC-005) y Reportes (SPEC-006) consumiendo eventos confirmados.

## Fase 3: API Gateway e Integraciones
- Generar documentación OpenAPI para las APIs de los seis módulos y definir autenticación, autorización, errores y paginación.
- Configurar gateway, límites de solicitudes, trazabilidad y manejo de errores.
- No integrar pasarelas de pago externas en esta fase; no están definidos depósitos, retiros ni proveedor.

## Fase 4: Frontend y UI
- Generar en Flutter las pantallas de registro/inicio de sesión, perfil, billetera/saldo, envío P2P, confirmación y recibo, historial y preferencias de notificaciones.
- Mostrar moneda GTQ y montos con dos decimales; no permitir iniciar transferencias inválidas desde la interfaz, sin sustituir validaciones del backend.
- Aplicar Material Design y accesibilidad; cubrir estados de carga, error y confirmación.

## Fase 5: Calidad y Despliegue
- Ejecutar pruebas unitarias, integración y concurrencia financiera; verificar rollback, idempotencia, permisos y privacidad.
- Aplicar ESLint/Jest en Node.js y pruebas Flutter; documentar configuración, despliegue, secretos y recuperación.

## Fase 6: Integración MCP
- Diseñar el servidor MCP PayFlex como adaptador autenticado del gateway según `SPEC-007-PayFlexMCPServer.md`; no accede directamente a bases de datos ni sustituye la autorización del backend.
- Implementar primero recursos y herramientas de consulta propia; habilitar transferencias solo con borrador, aprobación explícita, 2FA e idempotencia delegada a Transacciones.
- Validar aislamiento de identidad, sesiones/transportes, límites de solicitudes, privacidad, errores y reintentos antes de habilitar clientes remotos.
