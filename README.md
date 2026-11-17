# PayFlex

Backend de billetera electrónica GTQ basado en las especificaciones de [`.specs/WALLET`](.specs/WALLET). La implementación incluye autenticación, usuarios, billeteras, transacciones P2P, notificaciones, reportes y un gateway HTTP.

## Desarrollo local

1. Copia `.env.example` a `.env` y sustituye los secretos de ejemplo por valores aleatorios.
2. Inicia MySQL y aplica `schema.sql` una sola vez.
3. Ejecuta `npm ci`, `npm run typecheck`, `npm test`, `npm run test:mcp` y `npm run dev`.
4. Comprueba `http://localhost:3000/health`.

`SERVICE_NAME=all` permite desarrollo local en un proceso. En Docker Compose, cada microservicio se ejecuta por separado detrás del gateway. Consulta [la guía de arquitectura y operación](docs/architecture.md) y el contrato [OpenAPI](docs/openapi.yaml).

Los saldos iniciales son cero. Depósitos, retiros y proveedores de pago están fuera de la Fase 1.

## Servidor MCP

El servidor MCP está registrado para Copilot en [`.mcp.json`](.mcp.json). Ejecuta `npm run build`, configura `PAYFLEX_ACCESS_TOKEN` como variable del entorno de VS Code con un JWT PayFlex vigente y reinicia VS Code. El token no se guarda en el repositorio ni se pasa como argumento de herramienta. El transporte stdio usa el gateway local `http://127.0.0.1:8080` por defecto. `confirm_transfer` muestra una solicitud de aprobación al cliente MCP y no mueve fondos si la persona la rechaza.

Para probar Streamable HTTP solo en localhost, ejecuta `docker compose --profile mcp up --build`; el endpoint queda en `http://localhost:4000/mcp`. El perfil levanta Redis efímero para borradores y rate limits. No expongas ese perfil local a Internet; un despliegue remoto requiere TLS y configurar hosts/orígenes permitidos y `MCP_PUBLIC_URL` HTTPS.

Para agregar saldo ficticio de prueba, pon `ENABLE_TEST_FUNDING=true` en `.env` únicamente en un entorno `development` o `test` y reinicia backend/MCP. La herramienta MCP recibe `{ "walletId": "...", "amount": "100.00", "currency": "GTQ", "idempotencyKey": "UUID" }` y pedirá aprobación explícita; agrega una clave nueva por operación y reutiliza la misma si reintentas. Requiere billetera propia activa. El fondeo queda auditado en `test_wallet_fundings`, no crea una transferencia/ledger P2P y no debe usarse con dinero real. En `production` permanece bloqueado aunque la variable esté activa.
