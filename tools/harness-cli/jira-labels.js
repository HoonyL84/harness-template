"use strict";

/** Human topic labels never replace reserved Harness reconciliation markers. */
function normalizeReadableLabels(value = []) {
  if (!Array.isArray(value) || value.length > 5) throw new Error("Ticket labels must be an array of up to 5 readable labels");
  const labels = value.map(label => {
    if (typeof label !== "string") throw new Error("Ticket label must be a string");
    const normalized = label.normalize("NFC");
    if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(normalized) || /^harness-/i.test(normalized) || /^[a-f0-9]{12,}$/i.test(normalized)) {
      throw new Error("Use short readable labels without spaces or reserved Harness/hash labels");
    }
    return normalized;
  });
  if (new Set(labels).size !== labels.length) throw new Error("Duplicate readable labels");
  return labels;
}

module.exports = { normalizeReadableLabels };
