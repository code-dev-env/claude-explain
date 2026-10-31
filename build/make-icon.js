// Run with: npx electron build/make-icon.js  -> writes build/icon.png and build/icon.ico
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, frame: false, transparent: true });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), big.toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(s => big.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...entries, ...pngs]));
  console.log('icon written', big.getSize());
  app.quit();
});
