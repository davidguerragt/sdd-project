# CONSTITUTION.md

## Stack permitido

### Vision y propósito del proyecto
El proyecto "PayFlex" es una billetera electrónica móvil diseñada para ofrecer a los usuarios una experiencia de pago segura, rápida y confiable. La arquitectura de microservicios permitirá escalar y mantener la aplicación de manera eficiente, asegurando alta disponibilidad y consistencia en las transacciones financieras.

### Lenguajes de programación
- Node.js (JavaScript/TypeScript)
- Dart (Flutter para aplicaciones móviles)

### Frameworks y Bibliotecas
- Express.js (para API REST)
- Flutter (para desarrollo de aplicaciones móviles)
- MySQL (para base de datos relacional)

### ORM
- TypeORM (para Node.js)

### Validación de datos
- zod (para validación de datos en Node.js)

## Pruebas y Calidad de Código
- Jest (para pruebas unitarias y de integración)
- ESLint (para análisis estático de código)

### Arquitectura de Microservicios
- Cada microservicio debe ser independiente y desplegable de manera autónoma.
- Debe existir un microservicio para cada módulo funcional: Autenticación, Gestión de Usuarios, Gestión de Cuentas, Transacciones, Notificaciones y Reportes.
- Cada microservicio debe exponer una API REST y comunicarse con otros microservicios a través de HTTP o gRPC.

### Principios no negociables
1. Seguridad: Implementar autenticación y autorización robusta, cifrado de datos en tránsito y en reposo, y protección contra ataques comunes (inyección SQL, XSS, CSRF, etc.).
2. Escalabilidad: Diseñar la arquitectura para soportar un alto volumen de transacciones concurrentes y permitir la adición de nuevos microservicios sin afectar la estabilidad del sistema.
3. Alta Disponibilidad: Implementar estrategias de replicación y balanceo de carga para garantizar que el sistema esté disponible incluso en caso de fallos de hardware o software.


### Rol de la IA
Actúa como un Arquitecto de Software Senior y Tech Lead experto en FinTech y Sistemas de Pago de Alta Disponibilidad.

### Objetivo de la Fase 1
Generar el código fuente, la arquitectura de microservicios y los scripts de despliegue para una Billetera Electrónica Móvil llamada "PayFlex".

### Reglas de Negocio Estrictas
1. Moneda Base: Quetzales (Q).
2. Seguridad Bancaria: Todo el código generado debe seguir las directrices de OWASP Top 10 y estar preparado para certificación PCI-DSS.
3. Consistencia Financiera: Todas las operaciones de balance deben ser transaccionales (Cumplimiento ACID). Está estrictamente prohibido usar tipos de datos flotantes (float/double) para dinero; usa tipos numéricos exactos (Decimal o enteros en centavos).

# Exclusiones de la Fase 1
Si el usuario pide funciones de Criptomonedas, Créditos o Inversiones, la IA debe responder: "Esta funcionalidad está fuera del alcance de la Fase 1".