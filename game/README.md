# 🔧 Bolt Ranger 3D

Arena de ação **3D** inspirada em **Ratchet & Clank**, em WebGL com
[Three.js](https://threejs.org/) e **otimizada para iPhone** (dois joysticks
analógicos, câmara em terceira pessoa, PWA instalável).

Corre no **Safari do iPhone** sem Xcode, Mac nem App Store, e pode ser instalado
no ecrã principal como uma app em ecrã inteiro. A Three.js está incluída
localmente (`vendor/three.module.js`), por isso o jogo funciona **offline**.

▶️ **Jogar:** https://r-mourao13.github.io/Copilot-course/

## 🎮 Como jogar

- **Mover:** joystick esquerdo (analógico, todas as direções)
- **Mirar / disparar:** joystick direito — empurra na direção do alvo; um
  indicador no chão mostra para onde apontas
- **Saltar:** botão ⤴ (salto duplo, ou triplo com upgrade) · **dash** com
  upgrade ao tocar em saltar já sem saltos e em movimento
- **Trocar de arma:** 🔄
- **Teclado (PC):** `WASD`/setas mover · `Espaço` saltar · `Z` disparar · `C` trocar

### Objetivo
Derrota os robôs da onda, **ativa os 3 terminais 🔮** espalhados pela arena e só
então aparece o **CHEFE**. Entre ondas abre a **loja** (separadores ❤️ Vida,
🔫 Arma, ⚡ Movimento) para gastar os **bolts ⚙️** em vida, armas e mobilidade.

### Inimigos
- **Perseguidor** (vermelho) — corre direto ao jogador
- **Adormecido** (azul) — dorme até te aproximares ou seres alvejado
- **Atirador** (verde) — mantém distância e dispara com precisão

## 📱 Pôr no iPhone

1. Abre o link acima no **Safari**.
2. Toca em **Partilhar → Adicionar ao ecrã principal**.
3. Abre pelo ícone: arranca em ecrã inteiro como uma app.

> O Safari não corre módulos ES/Service Worker em `file://`, por isso o jogo tem
> de ser servido por um servidor (o GitHub Pages trata disso).

## 🚀 Desenvolvimento

```bash
npm test        # 25 testes unitários da lógica de jogo (node:test)
npm run check   # verificação de sintaxe de game.js / core.js / sw.js
```

A lógica pura (colisões, salto, movimento, IA, loja, ondas) vive em
`game/core.js` e é coberta por testes. O deploy para o GitHub Pages
(`.github/workflows/deploy-pages.yml`) só acontece **depois de os testes
passarem**.

Servir localmente:

```bash
cd game && python3 -m http.server 8000   # abre http://localhost:8000
```

## 🛠️ Estrutura

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura, HUD, joysticks e botões touch (+ importmap da Three.js) |
| `style.css` | Estilo e layout responsivo (safe-area do iPhone) |
| `game.js` | Jogo 3D: cena, câmara, física, inimigos, armas, loja, VFX |
| `core.js` | Lógica pura e testável (sem THREE/DOM) |
| `vendor/three.module.js` | Three.js (local, para funcionar offline) |
| `manifest.json` · `sw.js` · `icon.svg` | PWA: app em ecrã inteiro, offline (network-first), ícone |

O service worker usa estratégia **network-first**: procura sempre a versão mais
recente e só recorre à cache quando estás offline — assim as atualizações chegam
sempre ao jogador.
