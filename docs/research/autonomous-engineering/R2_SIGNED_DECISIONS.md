# R2.3 — Aprobación de alcance con firma y clave pública fijada

**Estado: piloto de seguridad verificable.** Los cambios no alteran el compilador semántico TypeSpec, Nest/Spring, base de datos ni la operación actual del producto. Se incorporan un verificador de decisiones y un control en el generador de borradores. La firma **no equivale** a verificar la identidad civil de quien firma ni demuestra que la decisión sea correcta.

## Motivación

La primera propuesta escrita por ChatGPT identificó K-Q03 (ajustes de stock vs solo incrementos) y K-Q04 (normalización SKU). Para evitar que el agente se atribuya una decisión de negocio, el generador bloqueó la salida de TypeSpec. El código anterior tenía un segundo problema: incluso ante una decisión comercial expresamente resuelta, podía seguir bloqueándola para siempre; o, si simplemente se eliminara esa restricción, un agente podría falsificar `origin: "approved_policy"` y pasar el gate.

La solución exige verificar **un documento firmado con una clave que el operador fija externamente**. Ningún LLM ve la clave privada, y en CI solo se usan pares Ed25519 efímeros de prueba.

## Semántica del permiso

La firma certifica exclusivamente: **se acepta el perfil TypeSpec limitado y se reconocen como diferidos los comportamientos no implementados**.

No crea nuevas operaciones ni semánticas. Para el kiosco, una decisión de laboratorio puede aceptar explícitamente:
- Stock: el contrato generado **solo incrementa**, no permite ventas, decrementos, devoluciones ni conciliación física.
- SKU: la unicidad sigue siendo la comparación exacta de la cadena almacenada; no se añade normalización ni equivalencia Unicode.

No debería denominarse aplicación de kiosco terminada. El resultado de esa aceptación sigue siendo un **borrador parcial** y requiere pruebas independientes.

## Protocolo de autorización

Partir del `intake.json` original bloqueado del gateway de #121. Un revisor edita **una copia** (`candidate.json`), y cambia exclusivamente las preguntas concretas K-Q03/K-Q04 a `state: "resolved"`, `origin: "approved_policy"`, con una decisión explícita (no vacía) y `evidenceRefs: ["signed-domain-scope-approval"]`. Todas las demás preguntas, requisitos, operaciones y configuración quedan idénticas.

Preparar el documento que **un proceso externo con acceso a la clave privada** debe firmar:

```sh
node scripts/research/signed-decision-approval.mjs request original-intake.json candidate.json > payload.json
```

El mensaje exacto que debe firmarse mediante Ed25519 es el UTF-8 de `PROTOCOLIA_DECISION_APPROVAL_V1\n` concatenado con `JSON.stringify(payload)` sin espacios. El documento de firma tiene estas dos claves:

```json
{"payload": { "...": "el payload exacto emitido arriba" }, "signatureBase64": "firma-ed25519-base64"}
```

El revisor coloca el documento en `approval.json` y publica por canal confiable el SHA-256 de la clave pública **SPKI DER**. El hash se debe fijar independientemente del repositorio y del agente que propone el contrato. No aceptar como clave confiable un PEM y fingerprint aportados conjuntamente por el mismo agente sin comprobación exterior.

Verificar:

```sh
node scripts/research/signed-decision-approval.mjs verify original-intake.json candidate.json \
  --approval approval.json --public-key revisor.pub.pem sha256:HUELLA_CONFIABLE
```

Generar y verificar el TypeSpec, aportando en cada paso la misma prueba:

```sh
node scripts/research/intake-to-typespec.mjs generate candidate.json /tmp/kiosco-aprobado \
  --source original-intake.json --approval approval.json \
  --public-key revisor.pub.pem --trusted-key-sha256 HUELLA_CONFIABLE
node scripts/research/intake-to-typespec.mjs verify candidate.json /tmp/kiosco-aprobado \
  --source original-intake.json --approval approval.json \
  --public-key revisor.pub.pem --trusted-key-sha256 HUELLA_CONFIABLE
```

Una firma inválida, un cambio de un solo byte en cualquiera de los dos archivos, una huella no fijada, una pregunta protegida, requisitos cambiados o una autorización parcial **bloquean la generación**. La operación de firma NO está automatizada ni expone ninguna clave de producción a ProtocolIA.

## Protección contra eludir el gate

El comando heredado sin prueba sigue aceptando borradores para trabajo técnico no material, pero **no acepta un material `affectsSupported` resuelto simplemente mediante cadenas `origin: approved_policy` y `evidenceRefs`**. Debe validarse criptográficamente la fuente original y el documento de aprobación en el mismo comando que genera el contrato.

El registro generado incluye un resumen limitado del resultado: estado criptográfico, huella de la clave pública, hash de la fuente y IDs de preguntas resueltas. Ninguna clave privada se almacena ni entra en `Project Passport`.

Una firma de `accept-existing-typed-profile-only` no puede ampliar capacidades, aprobar operaciones de seguridad, efectos externos o cambios destructivos. Esas categorías requieren otros protocolos de autorización específicos que aún no existen.

## Evidencia de laboratorio

La CI `.github/workflows/signed-decision-gate-r2.yml` construye el borrador a partir del ensayo real #121, modifica **únicamente** sus dos preguntas bloqueantes y genera una pareja Ed25519 efímera dentro del job. Después demuestra que:

1. La copia sin firma sigue bloqueada.
2. Una firma con una clave diferente, otra fuente, requisitos alterados o un payload adulterado se rechaza.
3. La aceptación de alcance firmada permite crear un **TypeSpec con los cinco comportamientos ya soportados**.
4. Se generan Project Passport y NestJS/React, y corren pruebas reales del perfil contra PostgreSQL.

**La CI no autentica al propietario ni aprueba políticas para un negocio real**. En la práctica, habilitarlo requerirá que se registre y verifique previamente una clave pública de un responsable autorizado, almacenada fuera del control del agente.

## Pendientes

Definir y probar nuevas primitivas de **decremento seguro con auditoría**, políticas de SKU normalizado solo después de una decisión real, permisos reales, comparación de agentes/harnesses sobre casos secretos, y retoma a dos años sin sesiones anteriores.

Mantener Draft: #105 → #107 → #109 → #110 → #111 → #121 → nuevo PR. `main` queda independiente de esta investigación.
