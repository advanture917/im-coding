import crypto from "node:crypto";

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}
