# PLAN DE GENERACIÓN EN CASCADA (PROYECTO PAYFLEX)

La IA debe ejecutar y generar el proyecto siguiendo estrictamente este orden cronológico. No pases a la siguiente fase hasta que el usuario confirme la anterior:

## Fase 1: Arquitectura y Base de Datos (Inputs y Modelos)
- Generar el diagrama de arquitectura (en formato Mermaid.js).
- Generar los scripts SQL de PostgreSQL (Tablas de usuarios, cuentas, transacciones y auditoría).

## Fase 2: Backend Core (Lógica de Negocio)
- Generar el código del microservicio de autenticación (JWT + hashing).
- Generar el microservicio de transacciones (Ledger de saldos).

## Fase 3: API Gateway e Integraciones
- Generar la documentación OpenAPI/Swagger.
- Generar los mocks de integración con la pasarela de pagos (Stripe/Plaid).

## Fase 4: Frontend y UI
- Generar los componentes limpios en [Tecnología, ej: Flutter/React Native].
