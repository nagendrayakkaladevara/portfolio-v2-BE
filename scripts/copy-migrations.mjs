import { cpSync } from "node:fs";
cpSync("migrations", "build-tools/migrations", { recursive: true });
