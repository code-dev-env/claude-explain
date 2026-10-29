const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const MAX_FILE_BYTES = 400 * 1024;

// Keep settings next to the portable exe when possible, otherwise in userData.
function settingsPath() {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData");
  return path.join(dir, "claude-explain-settings.json");
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
function saveSettings(s) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  } catch {
    fs.writeFileSync(
      path.join(app.getPath("userData"), "claude-explain-settings.json"),
      JSON.stringify(s, null, 2),
    );
  }
}

let win;
const inflight = new Map();
let lastDir = null; // last folder used this session (not persisted)

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#1e1e24",
    title: "Claude Explain",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
  // Dropped files must never navigate the window.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

function readSource(filePath) {
  lastDir = path.dirname(filePath);
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES)
    throw new Error(
      `File is ${(stat.size / 1024).toFixed(0)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.`,
    );
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0))
    throw new Error("This looks like a binary file, not source code.");
  return {
    name: path.basename(filePath),
    path: filePath,
    content: buf.toString("utf8"),
  };
}

function publicSettings(s) {
  return {
    mode: s.mode || "claude-code",
    hasKey: !!(s.apiKey || process.env.ANTHROPIC_API_KEY),
    model: s.model || "claude-sonnet-5-5",
    cliPath: s.cliPath || "",
  };
}
ipcMain.handle("settings:get", () => publicSettings(loadSettings()));
ipcMain.handle("settings:set", (_e, patch) => {
  const s = { ...loadSettings(), ...patch };
  if (patch.apiKey === "") delete s.apiKey;
  if (!s.cliPath) delete s.cliPath;
  saveSettings(s);
  return publicSettings(s);
});

ipcMain.handle("file:open", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    title: "Select a source code file",
    ...(lastDir && { defaultPath: lastDir }),
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readSource(r.filePaths[0]);
});
ipcMain.handle("file:read", (_e, p) => readSource(p));

ipcMain.handle("claude:cancel", (_e, id) => {
  inflight.get(id)?.abort();
});

// Flatten the chat into one prompt for the CLI (which is run statelessly).
function flatten(messages) {
  if (messages.length === 1) return messages[0].content;
  const turns = messages.map((m, i) =>
    i === 0
      ? m.content
      : "[" + (m.role === "user" ? "User" : "Assistant") + "]\n" + m.content,
  );
  return (
    "Conversation so far (the file was given in the first message):\n\n" +
    turns.join("\n\n") +
    "\n\nReply to the last [User] message."
  );
}

function cliCandidates(s) {
  return [
    s.cliPath,
    "claude",
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(os.homedir(), ".local", "bin", "claude"),
  ].filter(Boolean);
}

// Uses the locally installed, already logged-in Claude Code CLI.
function streamCli({ id, system, messages }, s, send) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--tools",
      "",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--system-prompt",
      system,
    ];
    if (s.model) args.push("--model", s.model);
    const candidates = cliCandidates(s);
    let started = false,
      gotText = false;
    const meta = { source: "Claude Code" };

    const tryNext = () => {
      const cmd = candidates.shift();
      if (!cmd)
        return resolve({
          error:
            "Claude Code was not found on this PC. Install it, or set its path / an API key in Settings.",
          setup: true,
        });
      const child = spawn(cmd, args, { cwd: os.tmpdir(), windowsHide: true });
      let buf = "",
        err = "",
        finalText = "",
        cliError = null,
        cancelled = false;
      inflight.set(id, {
        abort: () => {
          cancelled = true;
          child.kill();
        },
      });
      child.on("error", (e) => {
        if (e.code === "ENOENT" && !started) tryNext();
        else resolve({ error: e.message, setup: true });
      });
      child.on("spawn", () => {
        started = true;
      });
      child.stderr.on("data", (d) => {
        err += d;
      });
      child.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (
              ev.type === "stream_event" &&
              ev.event?.type === "content_block_delta" &&
              ev.event.delta?.type === "text_delta"
            ) {
              gotText = true;
              send("delta", ev.event.delta.text);
            } else if (
              ev.type === "stream_event" &&
              ev.event?.type === "message_start" &&
              ev.event.message?.model
            )
              meta.model = ev.event.message.model;
            else if (ev.type === "result") {
              if (ev.is_error)
                cliError = ev.result || "Claude Code reported an error.";
              finalText = ev.result || "";
              const u = ev.usage || {};
              meta.inputTokens =
                (u.input_tokens || 0) +
                (u.cache_creation_input_tokens || 0) +
                (u.cache_read_input_tokens || 0);
              meta.cachedTokens = u.cache_read_input_tokens || 0;
              meta.outputTokens = u.output_tokens || 0;
              meta.costUsd = ev.total_cost_usd;
              meta.apiMs = ev.duration_api_ms;
            }
          } catch {}
        }
      });
      child.on("close", (code) => {
        if (cancelled) return resolve({ ok: true, cancelled: true });
        if (!gotText && finalText && !cliError) send("delta", finalText);
        if (cliError || (code !== 0 && !gotText && !finalText)) {
          const msg = (
            cliError ||
            err ||
            `Claude Code exited with code ${code}`
          ).trim();
          return resolve({ error: msg, setup: !gotText });
        }
        resolve({ ok: true, meta });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(flatten(messages));
    };
    tryNext();
  });
}

// Direct Anthropic API call with an API key (optional fallback).
async function streamApi({ id, system, messages }, s, send) {
  const apiKey = s.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "No API key set." };
  const meta = { source: "API key" };
  const ac = new AbortController();
  inflight.set(id, ac);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ac.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: s.model || "claude-sonnet-5-5",
        max_tokens: 16000,
        stream: true,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        msg = (await res.json()).error?.message || msg;
      } catch {}
      return { error: msg };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf(String.fromCharCode(10, 10))) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block
          .split(String.fromCharCode(10))
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta"
          )
            send("delta", ev.delta.text);
          else if (ev.type === "message_start") {
            meta.model = ev.message?.model;
            meta.inputTokens =
              (ev.message?.usage?.input_tokens || 0) +
              (ev.message?.usage?.cache_read_input_tokens || 0) +
              (ev.message?.usage?.cache_creation_input_tokens || 0);
          } else if (ev.type === "message_delta" && ev.usage)
            meta.outputTokens = ev.usage.output_tokens;
          else if (ev.type === "error")
            return { error: ev.error?.message || "Stream error" };
        } catch {}
      }
    }
    return { ok: true, meta };
  } catch (err) {
    return err.name === "AbortError"
      ? { ok: true, cancelled: true }
      : { error: err.message };
  } finally {
    inflight.delete(id);
  }
}

ipcMain.handle("claude:stream", async (e, req) => {
  const s = loadSettings();
  const hasKey = !!(s.apiKey || process.env.ANTHROPIC_API_KEY);
  const send = (type, data) =>
    !e.sender.isDestroyed() &&
    e.sender.send("claude:event", { id: req.id, type, data });
  let sent = false;
  const tracked = (t, d) => {
    sent = true;
    send(t, d);
  };
  try {
    if ((s.mode || "claude-code") === "api")
      return await streamApi(req, s, tracked);
    const r = await streamCli(req, s, tracked);
    // Claude Code failed before producing anything: fall back to the API key if one exists.
    if (r.error && !sent && hasKey) return await streamApi(req, s, tracked);
    if (r.error && r.setup)
      r.error +=
        " Open Settings to point to Claude Code or use an API key instead.";
    return r;
  } finally {
    inflight.delete(req.id);
  }
});
