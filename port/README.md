# port/

Your game port lives here. It is created by Claude Code during "Port this game" and is
**private by default**: everything in this directory except this README is git-ignored, and
`npm run leakcheck` refuses to commit it unless `port/game.json` says `"private": false`.
Only set that if you hold the rights to publish the port.

Expected shape (see `examples/sample2d` and `.claude/skills/implement-port/SKILL.md`):

```
port/game.json        id, name, "private": true, sources, assets, touch, input
port/src/*.c          BGT game (bgt_init / bgt_update / bgt_render / bgt_shutdown)
port/assets/          recovered/converted assets (private)
port/tests/*.spec.ts  Playwright tests for the port (npm run test:port)
```

Build with `npm run build:port`, then open `http://localhost:5173/?game=<id>`.
