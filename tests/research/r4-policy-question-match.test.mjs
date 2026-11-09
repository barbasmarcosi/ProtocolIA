import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchesMaterialPolicyQuestion as matches} from '../../scripts/research/r4-policy-question-match.mjs';

// These topic names and representative keywords mirror the out-of-band rubric;
// the production scorer still reads that rubric at runtime.
const cadence = {id:'calibration_cadence',terms:['interval','frequency','frecuencia','periodicidad','cadence','cada cuánto']};
const overdue = {id:'overdue_response',terms:['overdue','vencid','caducad','expir','past due','atrasad']};

test('completed independent Qwen response expresses both decisions without oracle keywords', () => {
  assert.ok(matches('What is the calibration interval (e.g., months or days) for each type of tool?', cadence));
  assert.ok(matches("What action should be taken when a tool's calibration due date is exceeded?", overdue));
});

test('ordinary Spanish and English paraphrases preserve distinct policy questions', () => {
  assert.ok(matches('¿Con qué intervalo o frecuencia corresponde calibrar cada tipo de herramienta?', cadence));
  assert.ok(matches('¿Qué acción debe ejecutarse cuando una calibración está vencida?', overdue));
  assert.ok(matches('How often should we calibrate each type of tool?', cadence));
  assert.ok(matches('What response is expected once a calibration deadline has passed?', overdue));
  assert.ok(matches('¿Qué hacer si se supera la fecha prevista de calibración?', overdue));
});

test('topic keywords without a calibration due-date decision are rejected', () => {
  assert.equal(matches('What happens if an invoice is overdue?', overdue), false);
  assert.equal(matches('What action if tool inventory count is exceeded?', overdue), false);
  assert.equal(matches('What action if a tool maintenance deadline is exceeded?', overdue), false);
  assert.equal(matches('The calibration due date is exceeded.', overdue), false);
  assert.equal(matches('What is the inventory interval for generic stock?', cadence), false);
  assert.equal(matches('How do we calibrate tools?', cadence), false);
  assert.equal(matches('What action should be taken when calibration expires?', cadence), false);
});

test('invalid response inputs and unrelated rubric topics fail closed', () => {
  assert.equal(matches(null, overdue), false);
  assert.equal(matches('When does a tool calibration expire?', {id:'new_unknown',terms:['deadline']}), false);
});
