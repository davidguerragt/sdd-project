# ESPECIFICACION TECNICA DE AUTENTICACION (SPEC-001)
## 1. Introducción
El módulo de autenticación de usuarios es un componente crítico del sistema PayFlex, encargado de gestionar la verificación de identidad y el acceso seguro a la plataforma. Este módulo implementa un flujo de autenticación robusto, asegurando que solo los usuarios autorizados puedan acceder a sus cuentas y realizar transacciones financieras.

## 2. Requerimientos Funcionales
1. **Registro**: Crear credenciales asociadas a un usuario registrado, validando y normalizando correo y teléfono y rechazando identificadores duplicados. El perfil se administra según SPEC-002.
2. **Inicio de sesión**: Permitir autenticación con correo o teléfono y contraseña; responder con errores genéricos que no revelen si un identificador existe.
3. **Recuperación de contraseña**: Emitir un enlace de restablecimiento de un solo uso, de vida limitada y enviado al correo registrado. Invalidar sesiones activas al cambiar la contraseña.
4. **Sesiones y cierre de sesión**: Emitir tokens de acceso de vida corta y gestionar renovación segura. El cierre de sesión invalida el token de renovación o la sesión correspondiente.
5. **Segundo factor**: Permitir habilitar y deshabilitar 2FA con verificación adicional. Su estado debe aplicarse al iniciar sesión y a operaciones sensibles.
6. **Protección contra abuso**: Aplicar límites de intentos, demoras o bloqueo temporal ante intentos repetidos y registrar eventos de autenticación para auditoría.

## 3. Requerimientos No Funcionales
1. **Seguridad**: Usar HTTPS en tránsito y almacenar contraseñas con un hash adaptativo y sal (bcrypt según el stack aprobado); nunca guardar contraseñas ni tokens en texto plano. Los secretos deben mantenerse fuera del código y los logs.
2. **Autorización**: Los endpoints protegidos deben identificar al usuario desde la sesión autenticada, nunca desde un identificador confiado en el cuerpo de la solicitud.
3. **Auditoría**: Registrar intentos exitosos y fallidos, recuperación y cambios de contraseña, 2FA y cierre de sesión, sin incluir contraseñas, tokens ni secretos.
4. **Disponibilidad y escalabilidad**: El servicio debe poder escalar horizontalmente y mantener sesiones y límites de intentos en almacenamiento compartido cuando se despliegue más de una instancia.

## 4. Criterios de Aceptación
- Correo y teléfono duplicados se rechazan sin crear credenciales adicionales.
- Una contraseña incorrecta y un usuario inexistente producen una respuesta externa indistinguible.
- Un enlace de recuperación usado, vencido o inválido no cambia la contraseña.
- Tras cerrar sesión o cambiar la contraseña, la sesión invalidada no puede renovar tokens.
- Los logs no contienen contraseñas, tokens de acceso ni tokens de recuperación.
