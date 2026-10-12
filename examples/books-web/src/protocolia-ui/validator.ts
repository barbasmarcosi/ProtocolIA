import { customizeValidator } from '@rjsf/validator-ajv8';
import Ajv2020 from 'ajv/dist/2020.js';
// RJSF's default AJV8 instance is draft-07. This pilot explicitly requires
// JSON Schema 2020-12 emitted by ProtocolIA; regressions are tested in browser.
export const validator=customizeValidator({AjvClass:Ajv2020});
