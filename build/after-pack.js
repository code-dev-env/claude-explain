// signAndEditExecutable is off (it needs the winCodeSign toolchain), so stamp the icon into the
// app exe here. Without this the installed app shows Electron's default icon in Start and shortcuts.
const path = require("path");
const { rcedit } = require("rcedit");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, { icon: path.join(ctx.packager.projectDir, "build", "icon.ico") });
};
