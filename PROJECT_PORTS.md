# capture data Ports

This file is managed by Local Project Launcher.

## Port Table

| Role | Port | URL |
| --- | ---: | --- |
| Frontend | 3102 | http://localhost:3102 |
| Backend API | 8102 | http://localhost:8102 |
| Media service | 8202 | http://localhost:8202 |
| Admin | 9102 | http://localhost:9102 |
| WebSocket | 8302 | ws://localhost:8302 |

## Local Paths

- Media root: configure locally with `MEDIA_ROOT` in `.env.development`
- Obsidian test vault: configure locally with `OBSIDIAN_ROOT` in `.env.development`

## Commands

- Start: `npm run dev:safe`
- Check ports: use Local Project Launcher or `node scripts/check-ports.js` if generated.
- Repair ports: use Local Project Launcher and confirm before applying changes.

## Do Not Use

- 3000
- 5173
- 8000
- 8080
- 5000
- 3306
- 5432
- 6379

Do not automatically kill unknown processes.
