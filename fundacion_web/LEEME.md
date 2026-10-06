# Fundación (fundacion_web)

Sistema independiente de la Fundación. Recibe las solicitudes de referencia del asilo, el personal de la
Fundación programa la cita y el especialista, y el asilo consulta el resultado por API. No comparte base de
datos ni código con el asilo.

- Puerto: **3002** · Base de datos propia: **fundacion_db**
- Pantalla web (personal de la Fundación): `http://localhost:3002`
- API (para el asilo): `http://localhost:3002/api`

## Puesta en marcha

1. En MySQL, ejecutar `base/fundacion_db.sql` (crea la base y las tablas).
2. `npm install`
3. Copiar `.env.example` como `.env` y llenar los valores (la base y la `API_KEY`).
4. Crear un usuario del personal: `node crear-usuario.js coordinador MiClave123 Coordinación de Referencias`
5. `npm run dev`
6. En el `.env` **del asilo** agregar (la clave igual a la `API_KEY` de aquí):
   ```
   FUNDACION_URL=http://localhost:3002
   FUNDACION_API_KEY=la-misma-clave-del-API_KEY
   ```
   Mientras el asilo no tenga `FUNDACION_URL`, trabaja en modo simulado.

## API

Todas las llamadas llevan la cabecera `X-API-KEY` con la clave compartida. Responden JSON.

| Método y ruta | Qué hace | Respuestas |
|---|---|---|
| `POST /api/referencias` | El asilo envía una solicitud | `201` nueva · `200` ya recibida antes (mismo código) · `400` datos inválidos · `401` clave incorrecta |
| `GET /api/referencias/:codigo` | El asilo consulta el seguimiento | `200` · `404` no existe · `401` |
| `GET /api/especialidades` | Catálogo de especialidades activas | `200` lista de nombres · `401` |
| `PUT /api/especialistas` | El asilo manda la lista COMPLETA de sus médicos especialistas | `200` `{ "recibidos": n }` · `400` datos inválidos · `401` |

**Los especialistas los registra el asilo**, no la Fundación: son los usuarios del asilo con un rol que exige
especialidad (por ejemplo `medico_especialista`) y su especialidad escrita. El asilo los manda con
`PUT /api/especialistas` al arrancar, cada 5 minutos y cada vez que se crea, edita o activa/desactiva un usuario:

```json
{ "especialistas": [ { "id_externo": 4, "nombre_completo": "Nombre Apellido", "especialidad": "Cardiología" } ] }
```

Quien no viene en la lista queda desactivado, y una especialidad solo está activa si tiene al menos un
especialista activo. Por eso la lista de especialidades del asilo y el desplegable de especialistas de la
pantalla de la Fundación salen de aquí.

`POST /api/referencias` (cuerpo):

```json
{
  "id_solicitud": 12,
  "interno": { "nombre_completo": "Nombre Apellido", "edad": 78, "sexo": "M" },
  "especialidad": "Geriatría",
  "es_externa": false,
  "evaluacion_inicial": "Texto de la evaluación del médico general...",
  "padecimientos": [
    { "nombre_padecimiento": "Hipertensión", "descripcion": null, "medicamento_cajon": "Losartán", "dosis": "50 mg" }
  ]
}
```

Respuesta: `{ "codigo": "REF-000012", "estado": "Pendiente de Asignación" }`.
Enviar dos veces el mismo `id_solicitud` **no** crea dos referencias: devuelve el mismo código.

`GET /api/referencias/REF-000012`:

```json
{
  "codigo": "REF-000012",
  "estado": "Programada",
  "fecha_cita": "2026-10-09 09:00:00",
  "especialista": { "id_externo": 4, "nombre": "Nombre Apellido", "especialidad": "Geriatría" },
  "motivo_rechazo": null
}
```

## Estados (regla RN3)

`Pendiente de Asignación` → `Programada` · `En espera de disponibilidad` · `Rechazada`
`En espera de disponibilidad` → `Programada` · `Rechazada`
`Programada` / `Reprogramada` → `Reprogramada`
(`Atendida` la registra el asilo al guardar la visita médica.)

Un especialista no puede tener dos citas a menos de 1 hora una de otra.
