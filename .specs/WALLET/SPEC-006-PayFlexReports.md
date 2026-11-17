# ESPECIFICACION TECNICA DE REPORTES (SPEC-006)

## 1. Introducción
El servicio de Reportes proporciona historial y resúmenes derivados de transacciones confirmadas. No modifica saldos ni el ledger y no sustituye la consulta transaccional en tiempo real.

## 2. Requerimientos Funcionales
1. **Historial personal**: Permitir a cada usuario consultar sus transferencias enviadas y recibidas, paginadas y ordenadas por fecha.
2. **Filtros**: Permitir filtrar por rango de fechas, dirección (enviada/recibida) y estado, validando límites y formatos.
3. **Resumen**: Presentar totales de entradas y salidas por período en GTQ, basados exclusivamente en operaciones confirmadas.
4. **Reportes administrativos**: Permitir acceso restringido a métricas operativas agregadas; todo acceso a datos identificables debe requerir permiso y quedar auditado.
5. **Consistencia**: Identificar el momento de actualización de los datos derivados y no presentar una vista eventualmente consistente como saldo actual autoritativo.

## 3. Requerimientos No Funcionales
1. Los usuarios solo pueden consultar reportes propios; el acceso administrativo aplica mínimo privilegio.
2. Los importes se agregan en decimal exacto o unidades enteras de centavos, nunca en punto flotante.
3. Los reportes no deben generar carga que bloquee transacciones; usar datos derivados/lecturas separadas cuando sea necesario.
4. Aplicar límites de rango, paginación y protección de datos personales.

## 4. Criterios de Aceptación
- Un usuario no puede consultar historial ni resúmenes de otro usuario.
- Totales incluyen solo transferencias confirmadas y distinguen entradas de salidas.
- El reporte indica su fecha de actualización cuando no refleja datos en tiempo real.
- Los accesos administrativos a información identificable quedan auditados.
