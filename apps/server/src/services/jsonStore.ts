import fs from "node:fs";
import path from "node:path";

export const ensureParentDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) {
      ensureParentDir(filePath);
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.trim() ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJsonFile = <T>(filePath: string, value: T) => {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};