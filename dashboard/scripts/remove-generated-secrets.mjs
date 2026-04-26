import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const generatedSecrets = [
  resolve("dist/ralph_auth_server/.dev.vars"),
  resolve("dist/ralph_auth_server/.prod.vars"),
];

await Promise.all(generatedSecrets.map((path) => rm(path, { force: true })));
