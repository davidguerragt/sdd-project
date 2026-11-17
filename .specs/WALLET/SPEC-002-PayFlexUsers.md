# ESPECIFICACION TECNICA DE GESTION DE USUARIOS (SPEC-002)

## 1. Introducción
El microservicio de Usuarios administra el perfil personal asociado a las credenciales gestionadas por SPEC-001 y a las billeteras de SPEC-003. No autentica usuarios ni almacena contraseñas.

## 2. Requerimientos Funcionales
1. **Perfil**: Crear y consultar el perfil del usuario autenticado, incluyendo nombre, correo y teléfono según los datos requeridos para el registro.
2. **Actualización**: Permitir al propietario actualizar campos editables del perfil. Cambiar correo o teléfono requiere verificación antes de usarlos como identificadores de inicio de sesión.
3. **Consulta administrativa**: Permitir acceso administrativo limitado a los datos necesarios y registrar dicho acceso.
4. **Baja**: Permitir solicitar desactivación de un usuario, sin borrar ni alterar registros financieros. La baja debe impedir nuevas sesiones y transferencias según los contratos de Autenticación, Cuentas y Transacciones.
5. **Privacidad**: Exponer únicamente los datos necesarios para la operación solicitada; no permitir búsquedas públicas de perfiles por identificadores personales.

## 3. Requerimientos No Funcionales
1. Todas las rutas de perfil requieren autenticación; las operaciones administrativas requieren autorización explícita.
2. Los datos personales deben protegerse en tránsito y en almacenamiento, conforme a las políticas del proyecto.
3. Registrar altas, cambios, desactivaciones y accesos administrativos. No incluir secretos ni datos completos innecesarios en los logs.
4. Aplicar validación de esquema, normalización de identificadores y respuestas que no expongan información de otros usuarios.

## 4. Criterios de Aceptación
- Un usuario solo puede consultar y actualizar su propio perfil.
- Un correo o teléfono no verificado no puede sustituir al identificador de acceso vigente.
- La desactivación conserva historial financiero y se propaga a los servicios que deben bloquear operaciones.
- Un acceso administrativo queda asociado al actor, acción y fecha.
