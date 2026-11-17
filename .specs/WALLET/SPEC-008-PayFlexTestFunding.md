# ESPECIFICACION TECNICA DE FONDEO SIMULADO PARA PRUEBAS (SPEC-008)

## 1. Proposito y limites

Esta especificacion permite preparar saldo ficticio para probar billeteras y transferencias en ambientes locales/de prueba. No implementa depositos, pagos, dinero electronico canjeable ni integraciones financieras; el monto no representa fondos reales y no puede retirarse ni transferirse fuera de este entorno.

El fondeo simulado es una fixture administrativa de pruebas, no una operacion financiera de cliente ni un asiento del ledger P2P. Se persiste por separado en `test_wallet_fundings` y en auditoria. Transacciones continua siendo la unica autoridad autorizada para cambiar el saldo.

## 2. Activacion obligatoria

El endpoint y la herramienta MCP solo existen cuando ambas condiciones se cumplen en el proceso Transacciones y MCP:

- `NODE_ENV` es `development` o `test` (cualquier otro valor los desactiva).
- `ENABLE_TEST_FUNDING=true` esta configurado explicitamente.

En `production` no se habilitan aunque la variable este configurada. Si la funcion no esta habilitada, el endpoint devuelve `404` y MCP no registra `fund_test_wallet`. El despliegue de produccion debe fijar `ENABLE_TEST_FUNDING=false` y excluir las credenciales de ambientes de prueba.

## 3. Contrato REST de Transacciones

`POST /transactions/test/fund`

Headers:

- `Authorization: Bearer <JWT de acceso PayFlex>`.
- `Idempotency-Key: <UUID o clave aleatoria de 8 a 128 caracteres>`.
- `X-2FA-Code: <TOTP>` cuando el usuario tiene segundo factor habilitado.

Body:

```json
{
  "walletId": "uuid de la billetera propia",
  "amount": "100.00",
  "currency": "GTQ"
}
```

El actor y el propietario de la billetera se derivan de la sesion autenticada; no se acepta `userId`, `ownerId`, saldo, estado ni identificador de actor en el body. Solo se puede fondear una billetera propia, activa y GTQ.

## 4. Reglas de negocio

1. Aceptar solo monto decimal positivo con hasta dos posiciones, representado internamente en centavos enteros y limitado al rango de `DECIMAL(18,2)`.
2. No permitir que el saldo exceda el maximo representable ni modificar billeteras suspendidas, cerradas, deshabilitadas o de terceros.
3. En una transaccion ACID de MySQL, bloquear la cuenta financiera, validar propietario/estado/moneda y limite, incrementar saldo y registrar el fondeo y su auditoria. Un error revierte el saldo y el registro completos.
4. La clave de idempotencia es unica. La misma clave y los mismos actor/billetera/monto devuelven el resultado original sin aumentar saldo otra vez. Reutilizarla con datos distintos devuelve `409`.
5. Si 2FA esta habilitado, verificar TOTP mediante el contrato interno de Auth antes del movimiento. No escribir ni registrar el OTP.
6. La respuesta exitosa identifica el fondeo, billetera, importe, GTQ y saldo resultante. No crea una transferencia P2P, un asiento `ledger_entries`, un evento `transfer.confirmed`, una notificacion ni una fila de reportes.
7. Registrar `transactions.test_funding.created` con actor, billetera, referencia, monto, moneda y fecha; nunca incluir token o TOTP.

## 5. Integracion MCP

La herramienta `fund_test_wallet` solo se registra cuando el MCP se ejecuta fuera de produccion y `ENABLE_TEST_FUNDING=true`. Argumentos: `walletId`, `amount`, `currency="GTQ"`, `idempotencyKey` y `otp?`.

Antes de llamar la API, solicita aprobacion por elicitation ligada a la llamada MCP y muestra importe, moneda, billetera y aviso de que son fondos simulados sin valor real. Un rechazo, cancelacion, falta de soporte de elicitation o respuesta sin marcar termina sin llamar a Transacciones. La herramienta declara efecto de escritura/destructivo aunque sea solo una fixture.

El MCP envia la clave como `Idempotency-Key`; el llamador debe conservarla al reintentar la misma operacion. El MCP nunca escribe en MySQL ni modifica directamente el saldo. Si Transacciones no habilita el modo, MCP no publica la herramienta.

## 6. Criterios de aceptacion

- En `production`, o sin `ENABLE_TEST_FUNDING=true`, endpoint y herramienta no estan disponibles.
- Usuarios autenticados solo pueden fondear sus propias billeteras activas GTQ.
- Monto no positivo, mas de dos decimales, moneda incorrecta y desbordamiento se rechazan sin cambios.
- Saldo y fila `test_wallet_fundings` se confirman juntos o ninguno cambia.
- Reintentar una clave con igual contenido no duplica el incremento; contenido distinto produce conflicto.
- Con 2FA habilitado se requiere TOTP valido; nunca se persiste ni registra el OTP.
- No se crea ledger P2P ni evento/aviso/reporte de transferencia para fondos ficticios.
- Rechazar la elicitation MCP o usar otro usuario no produce cambios.
- Las pruebas cubren doble solicitud concurrente, rollback, autorizacion, flag de entorno, idempotencia, limites exactos y redaccion de secretos.