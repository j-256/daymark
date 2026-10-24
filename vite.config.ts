import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "daymark-offline-shell",
      closeBundle() {
        const files: string[] = [];
        const walk = (directory: string, prefix = "") => {
          for (const file of readdirSync(directory, { withFileTypes: true })) {
            const relative = `${prefix}${file.name}`;
            if (file.name === ".DS_Store") {
              rmSync(join(directory, file.name));
              continue;
            }
            if (file.isDirectory()) walk(join(directory, file.name), `${relative}/`);
            else if (!["sw.js", "_headers", "_redirects", ".assetsignore"].includes(relative))
              files.push(relative);
          }
        };
        walk("dist");
        files.sort();
        const hash = createHash("sha256");
        for (const file of files) {
          hash.update(file);
          hash.update(readFileSync(join("dist", file)));
        }
        const source = readFileSync("public/sw.js", "utf8")
          .replaceAll("__CACHE_VERSION__", hash.digest("hex").slice(0, 16))
          .replace(
            "const FILES = [];",
            `const FILES = ${JSON.stringify(files.map((file) => (file === "index.html" ? "/" : `/${file}`)))};`,
          );
        writeFileSync("dist/sw.js", source);
      },
    },
  ],
  build: { outDir: "dist", emptyOutDir: true },
});
