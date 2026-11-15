import * as fs from "fs";
import * as path from "path";

const EXECUTABLE_NAME = "lmplayer";

// electron-builder names the .app folder and the main executable from the same
// setting, so rename the executable after packing to get `Les Mills Player.app/Contents/MacOS/lmplayer`.
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const productFilename = context.packager.appInfo.productFilename;
  const contents = path.join(context.appOutDir, `${productFilename}.app`, "Contents");
  const plistPath = path.join(contents, "Info.plist");

  const plist = fs.readFileSync(plistPath, "utf8");
  const pattern = /(<key>CFBundleExecutable<\/key>\s*<string>)[^<]*(<\/string>)/;
  if (!pattern.test(plist)) throw new Error(`CFBundleExecutable not found in ${plistPath}`);

  fs.renameSync(path.join(contents, "MacOS", productFilename), path.join(contents, "MacOS", EXECUTABLE_NAME));
  fs.writeFileSync(plistPath, plist.replace(pattern, `$1${EXECUTABLE_NAME}$2`));
}
