// Local (no-AI) static analysis: language detection and line classification.
const LANGS = {
  js: ["JavaScript", "slash"],
  mjs: ["JavaScript", "slash"],
  cjs: ["JavaScript", "slash"],
  jsx: ["React JSX", "slash"],
  ts: ["TypeScript", "slash"],
  tsx: ["React TSX", "slash"],
  c: ["C", "slash"],
  h: ["C Header", "slash"],
  cpp: ["C++", "slash"],
  cc: ["C++", "slash"],
  hpp: ["C++ Header", "slash"],
  cs: ["C#", "slash"],
  java: ["Java", "slash"],
  go: ["Go", "slash"],
  rs: ["Rust", "slash"],
  swift: ["Swift", "slash"],
  kt: ["Kotlin", "slash"],
  kts: ["Kotlin", "slash"],
  scala: ["Scala", "slash"],
  php: ["PHP", "slash"],
  dart: ["Dart", "slash"],
  groovy: ["Groovy", "slash"],
  v: ["Verilog", "slash"],
  py: ["Python", "hash"],
  rb: ["Ruby", "hash"],
  sh: ["Shell", "hash"],
  bash: ["Bash", "hash"],
  zsh: ["Zsh", "hash"],
  ps1: ["PowerShell", "hash"],
  pl: ["Perl", "hash"],
  r: ["R", "hash"],
  yml: ["YAML", "hash"],
  yaml: ["YAML", "hash"],
  toml: ["TOML", "hash"],
  mk: ["Makefile", "hash"],
  sql: ["SQL", "dash"],
  lua: ["Lua", "dash"],
  hs: ["Haskell", "dash"],
  asm: ["Assembly", "semi"],
  lisp: ["Lisp", "semi"],
  clj: ["Clojure", "semi"],
  ini: ["INI", "semi"],
  m: ["MATLAB / Obj-C", "percent"],
  tex: ["LaTeX", "percent"],
  html: ["HTML", "xml"],
  xml: ["XML", "xml"],
  vue: ["Vue", "xml"],
  svg: ["SVG", "xml"],
  css: ["CSS", "cblock"],
  scss: ["SCSS", "slash"],
  vb: ["Visual Basic", "quote"],
  bat: ["Batch", "rem"],
  cmd: ["Batch", "rem"],
  json: ["JSON", "none"],
};
const LINE_PREFIX = {
  slash: ["//"],
  hash: ["#"],
  dash: ["--"],
  semi: [";"],
  percent: ["%"],
  quote: ["'"],
  rem: ["rem ", "::"],
  none: [],
  xml: [],
  cblock: [],
};
const BLOCKS = {
  slash: ["/*", "*/"],
  cblock: ["/*", "*/"],
  xml: ["<!--", "-->"],
  dash: ["--[[", "]]"],
};

function analyzeSource(name, content) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const [lang, style] = LANGS[ext] || [
    ext ? ext.toUpperCase() : "Source",
    "slash",
  ];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const prefixes = LINE_PREFIX[style] || [];
  const block = BLOCKS[style];
  const types = new Array(lines.length);

  let inBlock = false,
    code = 0,
    comment = 0,
    blank = 0,
    longest = 0,
    maxIndent = 0;
  const indent = new Array(lines.length).fill(0);

  lines.forEach((raw, i) => {
    const t = raw.trim();
    longest = Math.max(longest, raw.length);
    const ind = raw.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
    indent[i] = ind;
    let type = "c";

    if (inBlock) {
      type = "m";
      if (block && t.includes(block[1])) inBlock = false;
    } else if (!t) type = "b";
    else if (block && t.startsWith(block[0])) {
      type = "m";
      if (!t.includes(block[1], block[0].length)) inBlock = true;
    } else if (prefixes.some((p) => t.toLowerCase().startsWith(p))) type = "m";
    types[i] = type;

    if (type === "c") {
      code++;
      maxIndent = Math.max(maxIndent, ind);
    } else if (type === "m") comment++;
    else blank++;
  });

  return {
    lang,
    total: lines.length,
    code,
    comment,
    blank,
    longest,
    maxIndent,
    types,
    indent,
    lines,
  };
}
