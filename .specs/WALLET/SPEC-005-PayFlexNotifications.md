# ESPECIFICACION TECNICA DE NOTIFICACIONES (SPEC-005)

## 1. Introducción
El servicio de Notificaciones informa a los usuarios de eventos relevantes de PayFlex. En la fase 1 consume transferencias confirmadas y no participa en la autorización ni en la contabilización de movimientos.

## 2. Requerimientos Funcionales
1. **Transferencias**: Notificar al emisor y receptor cuando una transferencia se confirma, con referencia, monto y moneda, sin revelar información innecesaria.
2. **Preferencias**: Permitir consultar y administrar preferencias de notificación por canal disponible. Los canales concretos se habilitan según configuración del producto.
3. **Reintentos**: Reintentar fallas transitorias y registrar el resultado final del envío.
4. **Duplicados**: Deduplicar eventos usando el identificador de evento/transferencia para no enviar avisos repetidos por reentregas.
5. **Privacidad**: No incluir contraseñas, tokens, números completos de instrumentos financieros ni secretos en mensajes o logs.

## 3. Requerimientos No Funcionales
1. El procesamiento es asíncrono y tolerante a fallas; un fallo de notificación no revierte una transferencia.
2. Los eventos se autentican y validan antes de procesarse.
3. Mantener trazabilidad de evento, destinatario, canal, estado y reintentos, protegiendo los datos personales.
4. El diseño no depende de un proveedor externo específico hasta que se seleccione uno.

## 4. Criterios de Aceptación
- Reprocesar el mismo evento no genera un segundo aviso exitoso al mismo destinatario.
- La indisponibilidad del servicio no cambia el resultado de una transferencia confirmada.
- Un evento inválido se rechaza y registra sin exponer datos sensibles.
