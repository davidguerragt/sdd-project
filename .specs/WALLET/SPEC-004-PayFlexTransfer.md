# ESPECIFICACION TECNICA DE TRANSFERENCIAS P2P (SPEC-004)
## 1. Introducción
El microservicio de Transacciones es la autoridad para transferencias, saldos y ledger. La primera fase contempla únicamente transferencias entre billeteras PayFlex activas en quetzales; no incluye depósitos, retiros ni pagos a comercios.

## 2. Requerimientos Funcionales
1. **Crear transferencia**: El usuario autenticado selecciona `senderWalletId` entre sus billeteras propias activas y envía billetera receptora, monto y clave de idempotencia. Transacciones deriva al propietario de la identidad autenticada y valida que la billetera emisora seleccionada pertenezca a ese usuario; nunca acepta `sender_id` ni `owner_id` confiados al cliente.
2. **Validación**: Rechazar monto cero o negativo, más de dos decimales, moneda distinta de GTQ, billeteras iguales, billeteras inexistentes o inactivas y saldo insuficiente. No aceptar un hash de PIN calculado por el cliente como prueba de autenticación.
3. **Atomicidad**: En una única transacción ACID de MySQL, bloquear las billeteras en orden determinista, verificar estado y saldo, debitar al emisor, acreditar al receptor y registrar los asientos balanceados del ledger. Ante cualquier fallo, revertir todo.
4. **Idempotencia**: Una repetición con la misma clave y los mismos datos devuelve el resultado original sin duplicar movimientos; reutilizar la clave con datos diferentes se rechaza.
5. **Historial**: Exponer historial paginado solo para las partes de la transferencia, con monto, moneda, fecha, referencia y estado.
6. **Estados**: La transferencia P2P se confirma de forma atómica; no ofrecer cancelación de una transferencia ya confirmada. Los fallos no dejan movimientos parciales.
7. **Eventos**: Después de confirmar una transferencia, publicar un evento durable para notificaciones y reportes. La falla de esos consumidores no revierte la operación financiera.

## 3. Requerimientos No Funcionales
1. **Precisión monetaria**: Representar el monto con decimal exacto de dos posiciones o entero en centavos; nunca usar `float`/`double`. La moneda almacenada y devuelta es GTQ.
2. **Seguridad**: Usar HTTPS, autorización por propietario, validación de entrada y consultas parametrizadas. No incluir datos sensibles en logs.
3. **Concurrencia**: Bloqueos y restricciones de base de datos deben impedir doble gasto y mantener la suma de débitos y créditos balanceada.
4. **Auditoría**: Conservar actor, referencia, monto, moneda, resultado y fecha de cada operación, sin permitir editar o eliminar asientos financieros.

## 4. Criterios de Aceptación
- Una transferencia válida debita y acredita el mismo monto y crea asientos balanceados, o no cambia nada.
- Dos solicitudes concurrentes no pueden gastar el mismo saldo dos veces.
- Una solicitud repetida con la misma clave de idempotencia no crea una segunda transferencia.
- Un usuario no puede consultar transferencias ajenas ni transferir desde una billetera que no posee.
- Si un usuario tiene varias billeteras, solo puede transferir desde la billetera emisora propia seleccionada y verificada por Transacciones.
- Los montos no representables en centavos GTQ y los saldos insuficientes son rechazados.