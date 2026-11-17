# TAREAS DE IMPLEMENTACION (PAYFLEX)

## Instrucciones Generales
1. Ejecutar por fases según `PLAN-PayFlexWallet.md`; verificar criterios de aceptación y pruebas antes de avanzar.
2. Usar el stack de `CONSTITUTION.md`: Node.js/TypeScript, Express, MySQL, TypeORM, Zod, Jest, ESLint y Flutter.
3. No implementar depósitos, retiros ni integración con proveedores externos en esta fase.

## Fase 1: Arquitectura y Base de Datos (Inputs y Modelos)
- [TASK-01]: Crear el diagrama Mermaid con Autenticación, Usuarios, Cuentas, Transacciones, Notificaciones y Reportes, mostrando límites de datos y flujos de eventos.
- [TASK-02]: Diseñar el esquema MySQL con usuarios, credenciales, billeteras, transferencias, ledger, claves de idempotencia y auditoría. Usar UUID e índices, GTQ y valores monetarios exactos; impedir saldos negativos.
- [TASK-03]: Definir el contrato de eventos de transferencia confirmada y la estrategia de entrega durable y deduplicación.

## Fase 2: Backend Core (Lógica de Negocio)
- [TASK-04]: Implementar Autenticación según SPEC-001: registro, login, recuperación, sesiones, 2FA y límites de intentos.
- [TASK-05]: Implementar Usuarios según SPEC-002: perfil propio, validación y desactivación con permisos.
- [TASK-06]: Implementar Cuentas/Billeteras según SPEC-003: apertura, consulta, suspensión/reactivación y cierre; no escribir saldos.
- [TASK-07]: Implementar Transacciones según SPEC-004: transferencia P2P ACID, ledger balanceado, idempotencia, control de concurrencia e historial.
- [TASK-08]: Implementar Notificaciones según SPEC-005: consumo asíncrono, reintentos y deduplicación.
- [TASK-09]: Implementar Reportes según SPEC-006: historial paginado y resúmenes de operaciones confirmadas.

## Fase 3: API Gateway e Integraciones
- [TASK-10]: Generar documentación OpenAPI para todos los endpoints y definir autenticación, autorización, paginación y errores.
- [TASK-11]: Configurar gateway con TLS, límites de solicitudes, trazabilidad y propagación segura de identidad.

## Fase 4: Frontend y UI
- [TASK-12]: Implementar en Flutter registro, inicio/cierre de sesión, recuperación de acceso y perfil.
- [TASK-13]: Implementar billetera, saldo, envío P2P, confirmación, recibo e historial con montos GTQ.
- [TASK-14]: Implementar estados de carga/error, preferencias de notificación y componentes accesibles siguiendo Material Design.

## Fase 5: Calidad y Despliegue
- [TASK-15]: Probar autorización, validación de montos, saldo insuficiente, rollback, idempotencia y transferencias concurrentes.
- [TASK-16]: Probar eventos repetidos y fallas de notificación sin afectar transferencias confirmadas; verificar privacidad y límites de reportes.
- [TASK-17]: Configurar despliegue, health checks, logs sin secretos, métricas y documentación operativa.