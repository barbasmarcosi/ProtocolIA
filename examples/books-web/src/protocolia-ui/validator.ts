import { customizeValidator } from '@rjsf/validator-ajv8';
import Ajv2020 from 'ajv/dist/2020.js';
// RJSF defaults to draft-07. Runtime uses AJV's genuine draft-2020-12
// class. RJSF's exported constructor type is narrower than its documented
// AjvClass extension point; convert ONLY that constructor boundary, not the
// schema, validation result or HTTP models.
type ValidatorOptions = NonNullable<Parameters<typeof customizeValidator>[0]>;
export const validator = customizeValidator({
  AjvClass: Ajv2020 as unknown as ValidatorOptions['AjvClass'],
});
