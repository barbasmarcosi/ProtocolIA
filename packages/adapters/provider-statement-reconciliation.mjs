// Read-only, provider-neutral statement comparison. Never establishes external
// settlement authority and never mutates a financial ledger or provider journal.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MONEY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const TYPES = new Set(["capture", "refund", "chargeback"]);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function object(value, fields, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== [...fields].sort().join("|"))
    throw Error(label + ": unexpected, missing or malformed fields");
}
function identity(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw Error(label + ": invalid identifier");
  return value;
}
function array(value, label) {
  if (!Array.isArray(value) || value.length > 20000)
    throw Error(label + ": expected bounded array");
  return value;
}
function amount(value, scale, label) {
  if (typeof value !== "string" || !MONEY.test(value))
    throw Error(label + ": exact decimal string required");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale || whole.length > 38 - scale)
    throw Error(label + ": unsupported precision");
  const minor = BigInt(whole) * (10n ** BigInt(scale)) +
    BigInt(fraction.padEnd(scale, "0") || "0");
  if (minor <= 0n || minor >= 10n ** 38n)
    throw Error(label + ": positive bounded amount required");
  return minor;
}
function format(value, scale) {
  const n = value.toString().padStart(scale + 1, "0");
  return scale === 0 ? n : n.slice(0, -scale) + "." + n.slice(-scale);
}
function key(providerId, transactionId) {
  return JSON.stringify([providerId, transactionId]);
}
function invariant(condition, message) {
  if (!condition) throw Error(message);
}

/**
 * Input must be a previously exported, operator-supplied snapshot:
 *   internal: posted/reversed receipts;
 *   links: explicit reviewed receipt-to-provider-transaction crosswalk;
 *   external: purported provider statement entries (never trusted as authority).
 * All amounts are canonical decimal strings, not JS floats.
 *
 * Output is a deterministic discrepancy report, NEVER a bank-cleared verdict.
 */
export function reconcileProviderStatement(input) {
  const returnsSupplied = own(input, "internalReturns");
  object(input, returnsSupplied
    ? ["currency","scale","internal","internalReturns","links","external"]
    : ["currency","scale","internal","links","external"], "statement");
  invariant(typeof input.currency === "string" &&
    /^[A-Z]{3}$/.test(input.currency), "Unsupported currency");
  invariant(Number.isInteger(input.scale) && input.scale >= 0 && input.scale <= 6,
    "Currency precision must be explicit (0..6)");
  const {currency, scale} = input;
  const internal = new Map(), internalReturns = new Map(), returnIds = new Set();
  const links = new Map(), linkOwners = new Map();
  const external = new Map(), eventIds = new Set();
  const issues = [];
  const push = (code, receiptId, providerId = null, transactionId = null) =>
    issues.push({code, receiptId, providerId, transactionId});
  let postedTotal = 0n, captureTotal = 0n, returnedTotal = 0n, internalReturnTotal = 0n;

  for (const [i, row] of array(input.internal, "internal").entries()) {
    object(row, ["receiptId","orderId","amount","currency","status","proofState"],
      "internal[" + i + "]");
    const receiptId = identity(row.receiptId, "receipt");
    identity(row.orderId, "order");
    invariant(row.currency === currency, "Internal receipt currency mismatch");
    invariant(["posted","reversed"].includes(row.status), "Unknown receipt status");
    invariant(row.proofState === "unverified",
      "Cannot infer authority from an existing proof state");
    const cents = amount(row.amount, scale, "internal[" + i + "].amount");
    invariant(!internal.has(receiptId), "Duplicate internal receipt identity");
    internal.set(receiptId, { ...row, minor: cents });
    if (row.status === "posted") postedTotal += cents;
  }
  // A zero-row export can mean a mistyped order, missing permissions or an
  // incomplete snapshot. Never report zero exceptions as positive coverage.
  if(internal.size===0)push("empty_internal_snapshot",null);
  // Internal return journal is a separate operator-supplied source, not proof
  // that a refund or chargeback cleared. Voided local entries contribute zero.
  for (const [i, row] of array(returnsSupplied ? input.internalReturns : [], "internalReturns").entries()) {
    object(row, ["receiptId","returnId","kind","amount","currency","status"],
      "internalReturns[" + i + "]");
    const receiptId = identity(row.receiptId, "return receipt");
    const returnId = identity(row.returnId, "return identity");
    invariant(internal.has(receiptId), "Internal return references missing receipt");
    invariant(!returnIds.has(returnId), "Duplicate internal return identity");
    returnIds.add(returnId);
    invariant(row.currency === currency, "Internal return currency mismatch");
    invariant(row.kind === "refund" || row.kind === "chargeback",
      "Unknown internal return kind");
    invariant(row.status === "recorded" || row.status === "voided",
      "Unknown internal return status");
    const minor = amount(row.amount, scale, "internalReturns[" + i + "].amount");
    if (!internalReturns.has(receiptId))
      internalReturns.set(receiptId, {refund:0n,chargeback:0n});
    if (row.status === "recorded") {
      internalReturns.get(receiptId)[row.kind] += minor;
      internalReturnTotal += minor;
    }
  }
  for (const [i, row] of array(input.links, "links").entries()) {
    object(row, ["receiptId","providerId","transactionId"], "links[" + i + "]");
    const receiptId = identity(row.receiptId, "link receipt");
    const providerId = identity(row.providerId, "link provider");
    const transactionId = identity(row.transactionId, "link transaction");
    const k = key(providerId, transactionId);
    invariant(!links.has(receiptId), "Multiple provider mappings for one receipt");
    invariant(!linkOwners.has(k), "Provider transaction mapped to multiple receipts");
    links.set(receiptId, {providerId, transactionId});
    linkOwners.set(k, receiptId);
  }
  for (const [i, row] of array(input.external, "external").entries()) {
    object(row, ["providerId","transactionId","eventId","kind","amount","currency"],
      "external[" + i + "]");
    const providerId = identity(row.providerId, "event provider");
    const transactionId = identity(row.transactionId, "event transaction");
    const eventId = identity(row.eventId, "event id");
    invariant(row.currency === currency, "External entry currency mismatch");
    invariant(TYPES.has(row.kind), "Unknown external movement kind");
    const eventKey = key(providerId,eventId);
    invariant(!eventIds.has(eventKey), "Duplicate external event identity");
    eventIds.add(eventKey);
    const minor = amount(row.amount, scale, "external[" + i + "].amount");
    const k = key(providerId,transactionId);
    if (!external.has(k)) external.set(k, {capture:0n,refund:0n,chargeback:0n,returned:0n,count:0});
    const aggregate = external.get(k);
    aggregate.count++;
    if (row.kind === "capture") {aggregate.capture += minor;captureTotal += minor;}
    else {aggregate[row.kind] += minor;aggregate.returned += minor;returnedTotal += minor;}
  }

  const rows = [];
  for (const [receiptId, receipt] of [...internal].sort(([a],[b])=>a.localeCompare(b, "en"))) {
    const link = links.get(receiptId);
    const recorded = internalReturns.get(receiptId) ?? {refund:0n,chargeback:0n};
    const recordedTotal = recorded.refund + recorded.chargeback;
    let classification;
    if (!link) {
      classification = "unlinked";
      push("unlinked_internal_receipt",receiptId);
    } else {
      const aggregate = external.get(key(link.providerId,link.transactionId));
      if (!aggregate) classification = "missing_external_transaction";
      else if (aggregate.capture === 0n) classification = "no_capture_reported";
      else if (aggregate.returned > aggregate.capture)
        classification = "external_returns_exceed_capture";
      else if (aggregate.capture !== receipt.minor)
        classification = "capture_amount_mismatch";
      else if (receipt.status === "reversed")
        classification = "internal_reversal_requires_review";
      else if (returnsSupplied && recordedTotal > receipt.minor)
        classification = "internal_returns_exceed_receipt";
      else if (returnsSupplied &&
        (aggregate.refund !== recorded.refund ||
         aggregate.chargeback !== recorded.chargeback)) {
        if (recordedTotal === 0n && aggregate.returned > 0n)
          classification = "external_return_requires_review";
        else if (recordedTotal > 0n && aggregate.returned === 0n)
          classification = "internal_return_not_externally_reported";
        else classification = "return_amount_or_kind_mismatch";
      } else if (aggregate.returned > 0n)
        classification = returnsSupplied
          ? "returns_agree_unverified" : "external_return_requires_review";
      else classification = "amounts_agree_unverified";
      if (!["amounts_agree_unverified","returns_agree_unverified"].includes(classification))
        push(classification,receiptId,link.providerId,link.transactionId);
    }
    // The internal journal must never conceal an over-return merely because
    // the external transaction or crosswalk is absent or the receipt reversed.
    if (returnsSupplied && recordedTotal > receipt.minor &&
        classification !== "internal_returns_exceed_receipt")
      push("internal_returns_exceed_receipt",receiptId,
        link?.providerId ?? null,link?.transactionId ?? null);
    const agg=link && external.get(key(link.providerId,link.transactionId));
    rows.push({receiptId,orderId:receipt.orderId,status:receipt.status,
      internalAmount:format(receipt.minor,scale),
      internalRecordedRefund:returnsSupplied ? format(recorded.refund,scale) : null,
      internalRecordedChargeback:returnsSupplied ? format(recorded.chargeback,scale) : null,
      providerId:link?.providerId ?? null,transactionId:link?.transactionId ?? null,
      externalCapture:agg ? format(agg.capture,scale) : null,
      externalRefund:agg ? format(agg.refund,scale) : null,
      externalChargeback:agg ? format(agg.chargeback,scale) : null,
      externalReturns:agg ? format(agg.returned,scale) : null,
      classification});
  }
  for (const [receiptId, link] of links) {
    if (!internal.has(receiptId))
      push("orphan_mapping",receiptId,link.providerId,link.transactionId);
  }
  for (const k of external.keys()) {
    if (!linkOwners.has(k)) {
      const [providerId,transactionId] = JSON.parse(k);
      push("unmatched_external_transaction",null,providerId,transactionId);
    }
  }
  issues.sort((a,b) =>
    JSON.stringify([a.code,a.receiptId,a.providerId,a.transactionId])
      .localeCompare(JSON.stringify([b.code,b.receiptId,b.providerId,b.transactionId]),"en"));
  const agree = rows.filter(x=>x.classification==="amounts_agree_unverified").length;
  const returnsAgree = rows.filter(x=>x.classification==="returns_agree_unverified").length;
  return {
    result: "comparison_only_not_settlement_verification",
    independentlyAuthenticated: false,
    currency,scale,
    totals: {postedInternal:format(postedTotal,scale),
      internallyRecordedReturns:returnsSupplied ? format(internalReturnTotal,scale) : null,
      purportedCaptured:format(captureTotal,scale),
      purportedReturned:format(returnedTotal,scale)},
    counts: {internal:internal.size,internalReturnEvents:returnIds.size,
      linked:links.size,externalEvents:eventIds.size,
      amountsAgreeUnverified:agree,returnsAgreeUnverified:returnsAgree,
      exceptions:issues.length},
    rows,exceptions:issues
  };
}
