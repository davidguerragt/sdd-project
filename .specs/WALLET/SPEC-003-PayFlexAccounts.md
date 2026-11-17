# ESPECIFICACION TECNICA DE BILLETERAS Y CUENTAS (SPEC-003)
## 1. Introducción
El módulo expone los flujos de gestión de billeteras asociadas a los usuarios. La gestión del perfil personal se especifica en SPEC-002. El saldo, el ledger y el estado financiero utilizado para autorizar movimientos son responsabilidad exclusiva del microservicio de Transacciones. Este módulo no ejecuta movimientos ni escribe esos datos directamente.

## 2. Requerimientos Funcionales
1. **Apertura**: Permitir varias billeteras por usuario autenticado, cada una con identificador único, moneda base GTQ y estado inicial definido. La apertura debe ser idempotente por `Idempotency-Key`: una repetición devuelve la misma billetera y una clave nueva puede crear otra billetera para ese usuario.
2. **Consulta**: Permitir al propietario consultar estado y saldo. El saldo y el estado que habilita transferencias deben obtenerse del servicio de Transacciones; el usuario solo puede consultar sus propias billeteras.
3. **Estado**: Permitir solicitar suspensión o reactivación según permisos y reglas de negocio. El cambio debe confirmarse en el servicio de Transacciones antes de responder como exitoso. Una billetera suspendida no puede enviar ni recibir transferencias.
4. **Cierre**: Permitir solicitar cierre únicamente cuando el servicio de Transacciones confirme que no existe saldo ni movimiento pendiente; preservar los registros financieros y de auditoría.
5. **Acceso administrativo**: Las operaciones administrativas deben requerir autorización explícita y quedar auditadas.

## 3. Requerimientos No Funcionales
1. **Seguridad**: Usar HTTPS, autenticación y autorización por propietario; no almacenar contraseñas ni datos de autenticación en este servicio.
2. **Consistencia**: Las mutaciones del estado financiero deben delegarse síncronamente al servicio de Transacciones. Este módulo nunca escribe el saldo, estado financiero ni ledger, y no responde éxito antes de confirmar la operación delegada.
3. **Auditoría**: Registrar aperturas, cambios de estado, consultas administrativas y cierres, sin guardar secretos.

## 4. Criterios de Aceptación
- Una solicitud de consulta de billetera ajena no devuelve información financiera.
- Un usuario puede abrir más de una billetera propia; una clave idempotente repetida no crea otra billetera.
- Una billetera suspendida no puede participar en una transferencia, incluso ante solicitudes concurrentes con el cambio de estado.
- Una billetera con saldo distinto de cero o una operación pendiente no puede cerrarse.
- Ninguna operación de este servicio puede alterar saldo o asientos del ledger.