# Claude Explain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey)
![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848f)

An AI-driven desktop utility that uses Claude to explain source code. Drop in a file and get a plain-language overview, a step-by-step walkthrough, a component breakdown and generated diagrams that show how the code works.

## Features

- **Drag-and-drop analysis.** Drop a source file onto the window, or browse for one.
- **Structured explanation.** Results are organised into four tabs: *Overview*, *Walkthrough*, *Diagrams* and *Components*.
- **Generated diagrams.** Flowcharts, call graphs and sequence diagrams are drawn by a built-in SVG engine, with no external diagramming dependency. Diagrams open in a viewer with zoom, pan and fit-to-window.
- **Source cross-referencing.** Walkthrough steps, components and diagram nodes link back to line ranges in the source pane.
- **Adjustable depth.** Choose *Full* or *Quick* analysis, and a *Beginner*, *Intermediate* or *Expert* level of detail.
- **Local static analysis.** Language detection and code, comment and blank line counts are computed locally, without AI.
- **Streaming output** with live token and timing statistics, and the ability to cancel a run.
- **Two ways to connect to Claude:** your existing [Claude Code](https://docs.claude.com/en/docs/claude-code) login, or an Anthropic API key.
- **Light and dark themes.**

## Requirements

- Windows 10 or later (the packaging targets Windows; the app itself is standard Electron)
- [Node.js](https://nodejs.org/) 18 or later and npm, to run from source or build
- One of the following:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (the default), or
  - an [Anthropic API key](https://console.anthropic.com/)

## Getting started

```bash
git clone https://github.com/code-dev-env/claude-explain.git
cd claude-explain
npm install
npm start
```

### Building a portable executable

```bash
npm run dist
```

This produces a single portable `Claude-Explain.exe` in the `dist/` directory. It needs no installer.

## Usage

1. Launch the app.
2. Choose an analysis mode (*Full* or *Quick*) and a level of detail.
3. Drag a source file onto the window, or click to browse.
4. Read the results. Select a walkthrough step, component or diagram node to highlight the matching lines in the source pane.

Files larger than 400 KB and binary files are rejected.

## Configuration

Open **Settings** (the gear icon) to configure the connection.

| Setting | Description |
| --- | --- |
| Connection | `Claude Code` (uses your existing login) or `Anthropic API key`. |
| Claude Code path | Only needed if the `claude` executable is not found automatically. |
| Anthropic API key | Used in API mode, and as a fallback if Claude Code is unavailable. May also be supplied through the `ANTHROPIC_API_KEY` environment variable. |
| Model | The Claude model ID to use. The default is `claude-sonnet-5-5`. |

Settings are stored in `claude-explain-settings.json`, next to the portable executable when possible and in the app's user-data directory otherwise. If you enter an API key it is saved there in plain text, so keep that file private.

## Privacy

Files you open are sent to Claude for analysis, through Claude Code or directly to the Anthropic API depending on your configuration. Do not analyse files containing secrets or code you are not permitted to share with a third-party service. The app has no telemetry and makes no other network requests.

## Project structure

```
src/
  main.js       Electron main process: windows, settings, file access, Claude Code and API clients
  preload.js    Context-isolated bridge exposed to the renderer
  renderer.js   UI logic, prompt construction and result rendering
  analyze.js    Local language detection and line classification
  diagrams.js   SVG layout and rendering for flowcharts, call graphs and sequence diagrams
  index.html    Application shell
  styles.css    Styling and themes
build/          Application icons
```

The renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled, under a restrictive Content Security Policy. All file and network access happens in the main process.

## Contributing

Contributions are welcome. For anything beyond a small fix, please open an issue first to discuss the change.

1. Fork the repository and create a branch for your change.
2. Make your changes, and confirm the app starts and analyses a file with `npm start`.
3. Open a pull request that describes what changed and why.

Please report bugs through the [issue tracker](https://github.com/code-dev-env/claude-explain/issues) and include your operating system, how you connect to Claude, and the steps to reproduce the problem. Do not include sensitive source code in reports.

## License

Released under the [MIT License](LICENSE).
