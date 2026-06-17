const unitMap = {
  万: 10000,
  w: 10000,
  W: 10000,
  亿: 100000000
};

export function parseMetricText(value) {
  if (value == null) return { value: null, status: "not_public", raw: "" };

  const raw = String(value).trim();
  if (!raw || /暂无|未公开|不可见|--/.test(raw)) {
    return { value: null, status: "not_public", raw };
  }

  const normalized = raw.replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([万wW亿])?\+?/);
  if (!match) {
    return { value: null, status: "unknown", raw };
  }

  const number = Number(match[1]);
  const unit = match[2];
  const multiplier = unit ? unitMap[unit] : 1;

  return {
    value: Math.round(number * multiplier),
    status: "available",
    raw
  };
}

export function extractFirstMetric(text, labels) {
  for (const label of labels) {
    const after = new RegExp(`${label}[^\\d\\n]{0,8}(\\d+(?:\\.\\d+)?\\s*(?:万|w|W|亿)?\\+?)`, "i");
    const before = new RegExp(`(\\d+(?:\\.\\d+)?\\s*(?:万|w|W|亿)?\\+?)\\s*${label}`, "i");
    const match = text.match(after) || text.match(before);
    if (match) return parseMetricText(match[1]);
  }
  return { value: null, status: "not_public", raw: "" };
}
