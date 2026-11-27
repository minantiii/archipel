# Archipel

- O plano do projeto está em `docs/roadmap.md`. Antes de começar algo, veja em que fase está.
- Ao terminar e testar um item, marque `[x]` nele. Ideia nova vai para "Ideias soltas".
- Não comece um item do roadmap sem o Gabriel decidir; planejar e explicar pode.
- O mapa é desenhado pelo `src/renderer/src/mapa/motor.ts` (PixiJS) e a física roda em
  `mapa/simulacao.worker.ts`. O `Palco.tsx` é só a casca React.
- Temas: `src/renderer/src/lib/tema.ts` (paletas do mapa e do terminal) + regras
  `:root[data-tema=...]` no `styles.css`.
- Terminal embutido: `src/main/terminal.ts` (node-pty) e `components/PainelTerminal.tsx` (xterm.js).
- Commits neste repo saem na conta pessoal (Minantiii): confira `git config user.email`
  antes do primeiro commit numa máquina nova.
- Publicar versão: subir `version` no `package.json`, commitar, e enviar a tag
  (`git tag vX.Y.Z && git push origin vX.Y.Z`). O workflow `.github/workflows/publicar.yml`
  compila no GitHub e cria a release sozinho. NÃO criar a release na mão com
  `gh release create`: a tag dispara o workflow, que falha com "release already exists".
  O botão do site baixa sempre a última release.
