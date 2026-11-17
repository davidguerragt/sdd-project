# PayFlex

Backend de billetera electrónica GTQ basado en las especificaciones de [`.specs/WALLET`](.specs/WALLET). La implementación incluye autenticación, usuarios, billeteras, transacciones P2P, notificaciones, reportes y un gateway HTTP.

## Desarrollo local

1. Copia `.env.example` a `.env` y sustituye los secretos de ejemplo por valores aleatorios.
2. Inicia MySQL y aplica `schema.sql` una sola vez.
3. Ejecuta `npm ci`, `npm run typecheck`, `npm test` y `npm run dev`.
4. Comprueba `http://localhost:3000/health`.

`SERVICE_NAME=all` permite desarrollo local en un proceso. En Docker Compose, cada microservicio se ejecuta por separado detrás del gateway. Consulta [la guía de arquitectura y operación](docs/architecture.md) y el contrato [OpenAPI](docs/openapi.yaml).

Los saldos iniciales son cero. Depósitos, retiros y proveedores de pago están fuera de la Fase 1.
