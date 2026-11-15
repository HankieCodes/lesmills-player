import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import * as path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "resources", "logo.svg"));
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(path.join(root, "resources", "icon.png"), png);
