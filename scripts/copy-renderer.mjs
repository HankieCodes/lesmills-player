import { copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import * as path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "out", "renderer"), { recursive: true });
copyFileSync(path.join(root, "src", "renderer", "index.html"), path.join(root, "out", "renderer", "index.html"));
copyFileSync(path.join(root, "resources", "logo.svg"), path.join(root, "out", "renderer", "logo.svg"));
copyFileSync(path.join(root, "resources", "icon.png"), path.join(root, "out", "renderer", "icon.png"));
