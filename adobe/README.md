# AE Agent 1.0.0 (Claude)

Modified build of the experimental AE Agent 0.8.1 CEP 12 panel for After Effects 26.x. The Codex App Server backend is replaced by the Claude Code CLI (bundled with the Claude desktop app), using the user's own Claude login. See [LEIA-ME.txt](LEIA-ME.txt) for installation, usage and removal (Portuguese).

## Changes in 1.0.0

- Voice input: the microphone recording is converted to 16 kHz WAV in the panel, transcribed, and written into the message box. Engines: whisper.cpp on the computer (one-click install on Windows, `brew install whisper-cpp` on macOS, models downloaded from Hugging Face) or the OpenAI / Groq transcription APIs with the user's key (`js/media.js`).
- Video understanding: attached videos are sampled into timestamped JPEG frames (FFmpeg, one-click install from the `ffmpeg-static` releases; the panel's own decoder is the fallback) plus a timestamped transcript of the soundtrack, and sent to Claude with the clip metadata and file path.
- Attachments: images are re-encoded when too large or in formats Claude cannot read (TIFF/PSD/EXR/HEIC via FFmpeg); audio files arrive as transcripts; PDFs as document blocks; text files inline. Drop or paste files anywhere on the panel.
- References library (`js/references.js`): files are copied into `AE Agent/References` with a name and a note for the agent; pinned references are sent with the first message of every new chat.
- Settings → Voice & video: engine, language, model, API key, auto-send, frames per video, video audio transcription, tool status and installers.

## How it works

- The panel starts a local MCP server (Streamable HTTP, `127.0.0.1`, random bearer token) exposing the `after_effects` tools defined in `js/app.js`.
- Each request runs `claude -p` headless with `--strict-mcp-config`, built-in tools disabled, only `mcp__after_effects` allowed, and `--resume` for conversation continuity.
- Claude Code is located via `CLAUDE_BIN`, `claude-path.txt` in the panel data folder, `~/.local/bin`, Homebrew/npm locations on macOS, or the Claude desktop app's bundled copy (newest version, searched recursively).

## Changes in 0.9.1

- macOS: wider Claude Code discovery (Finder-launched apps lack the shell PATH) with an executable-bit check.
- macOS: login opens Terminal through a generated `.command` file instead of osascript (no Automation permission prompt).

## Changes from 0.8.1

- Claude Code backend instead of Codex; Claude model/effort picker; no audio input.
- Fixed `undo_last_action` resolving to Edit > Purge > Undo (wiped the Undo history); it now uses command 16.
- Fixed empty preview frames by waiting for `saveFrameToPng` to finish writing each PNG.

## Validation

0.9.1 was tested on Windows 11 with After Effects 26.5 and Claude Code 2.1.308: read-only inspection, shape creation, preview frame delivered to the model, and Revert last run. macOS support is implemented but has not been tested on a Mac.

1.0.0: syntax checks and unit checks of transcript parsing, frame sampling, WAV encoding and the reference store pass; the panel UI was checked in a browser. Not yet tested inside After Effects: microphone capture in CEP, whisper.cpp/FFmpeg downloads and runs, and Claude Code accepting the `document` (PDF) block.
