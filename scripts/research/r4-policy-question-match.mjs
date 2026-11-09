// Participant answers are free-form business questions. This bounded matcher
// recognizes an overdue-date EVENT, not just a fixed keyword, and requires a
// concrete decision about calibration. It is not a general semantic evaluator.
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u2018\u2019]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

const calibrationSubject = /\b(?:calibr[a-z]*|calibrationdueat)\b/;
const questionOrDecision = /[?¿]|\b(?:what|which|how|should|must|action|actions|response|decide|define|determine|specify|que|cual|como|debe|hacer|accion|acciones|actuar|medida|proceder|decidir|definir)\b/;
const overdueWords = /\b(?:overdue|past due|venc(?:e|en|io|ida?s?|idos?|idas?)|caducad[a-z]*|expir[a-z]*|atrasad[a-z]*)\b/;
const dueDate = /\b(?:due date|deadline|calibration date|calibrationdueat|fecha (?:prevista|limite|de (?:calibracion|vencimiento))|vencimiento)\b/;
const passed = /\b(?:exceed[a-z]*|surpass[a-z]*|pass(?:ed|es)?|elaps[a-z]*|super[a-z]*|exced[a-z]*|rebas[a-z]*|transcurr[a-z]*)\b/;
const dateExceeded = s => dueDate.test(s) && passed.test(s);

/**
 * Recognize a decision still owed by the business owner. The rubric defines
 * the topic, but ordinary paraphrases cannot depend on a single English or
 * Spanish substring. Require both a relevant subject and a decision/request.
 * This does NOT certify approval, factual correctness or TypeSpec behavior.
 */
export function matchesMaterialPolicyQuestion(answer, rubric) {
  if (typeof answer !== 'string' || !rubric || !Array.isArray(rubric.terms)) return false;
  const s = normalize(answer);
  if (!questionOrDecision.test(s)) return false;
  const literal = rubric.terms.some(term =>
    typeof term === 'string' && s.includes(normalize(term)));
  if (rubric.id === 'calibration_cadence') {
    return calibrationSubject.test(s) &&
      (literal || /\b(?:how often|every how many|cada cuanto|cada cuantos)\b/.test(s));
  }
  if (rubric.id === 'overdue_response') {
    return calibrationSubject.test(s) && (literal || overdueWords.test(s) || dateExceeded(s));
  }
  return literal;
}
