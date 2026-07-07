export function splitLongText(text, maxLength = 3500) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return [value];

  const chunks = [];
  let offset = 0;
  const rawChunkSize = Math.max(1, maxLength - 16);
  while (offset < value.length) {
    chunks.push(value.slice(offset, offset + rawChunkSize));
    offset += rawChunkSize;
  }

  const total = chunks.length;
  return chunks.map((chunk, index) => {
    const prefix = `[${index + 1}/${total}]\n`;
    return `${prefix}${chunk}`.slice(0, maxLength);
  });
}

export function commandLine(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [name, ...rest] = trimmed.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim(),
  };
}
