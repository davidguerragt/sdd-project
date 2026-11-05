# ESPECIFICACIÓN TÉCNICA (SPEC-001): MÓDULO DE TRANSFERENCIA P2P

Por favor, genera el código del endpoint para transferencias entre usuarios basado en los siguientes requerimientos:

## 1. Definición del Endpoint
- Método: POST
- Ruta: `/api/v1/transactions/p2p`
- Content-Type: `application/json`

## 2. Esquema de Entrada (Request Body JSON)
{
  "sender_id": "UUID v4",
  "receiver_phone": "String (E.164 format)",
  "amount": "Decimal (Exacto, 2 decimales)",
  "pin_hash": "String (SHA-256)"
}

## 3. Lógica del Backend que debes programar:
1. Validar que `sender_id` exista y su estado sea 'ACTIVE'.
2. Validar el `pin_hash` contra la base de datos.
3. Buscar al receptor por su `receiver_phone`.
4. Verificar en una sola transacción de Base de Datos (ACID / SELECT FOR UPDATE):
   - ¿El emisor tiene saldo suficiente?
   - Si sí: Restar `amount` al emisor y sumar `amount` al receptor.
   - Registrar la transacción en la tabla `ledger` con estado 'COMPLETED'.
5. Si ocurre cualquier error, hacer ROLLBACK inmediato de la transacción.

## 4. Respuestas Esperadas
- Código 200: `{ "status": "success", "transaction_id": "UUID" }`
- Código 400: `{ "status": "error", "message": "Saldo insuficiente / PIN inválido" }`
