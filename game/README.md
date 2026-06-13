# 🔧 Bolt Ranger 3D

Arena de ação **3D** inspirada em **Ratchet & Clank**, feita em WebGL com
[Three.js](https://threejs.org/) e **otimizada para iPhone** (joystick + botões
touch, câmara em terceira pessoa, suporte a PWA).

Não precisa de Xcode, Mac, nem da App Store: corre no **Safari do iPhone** e pode
ser instalado no ecrã principal como uma app em ecrã inteiro. A Three.js está
incluída localmente (`vendor/three.module.js`), por isso o jogo é autossuficiente
e funciona offline.

## 🎮 Como jogar

- **Mover:** joystick analógico (canto inferior esquerdo) — move em todas as direções
- **Saltar:** ⤴ (salto duplo — carrega outra vez no ar)
- **Disparar / atacar:** 🔫 (a mira aponta automaticamente ao inimigo mais próximo)
- **Trocar de arma:** 🔄

Estás numa arena 3D rodeada de robôs. Apanha **bolts (⚙️)** dos inimigos
derrotados e dos caixotes. Entre ondas abre a **loja** para reparar a armadura,
aumentar a vida máxima e comprar novas armas (Espingarda em leque e Pyrocitor de
disparo rápido). Cada onda traz mais inimigos e mais difíceis.

**Teclado (para testar no computador):**
`WASD`/setas mover · `Espaço` saltar · `Z` disparar · `C` trocar arma.

## 📱 Como pôr no iPhone

1. Coloca esta pasta `game/` a ser servida por um servidor (HTTPS de preferência).
2. No iPhone, abre o endereço no **Safari**.
3. Toca em **Partilhar → Adicionar ao ecrã principal**.
4. Abre pelo ícone: arranca em ecrã inteiro, na horizontal, como uma app.

> O Safari não corre ficheiros `file://` com módulos ES/Service Worker, por isso o
> jogo tem de ser servido por um servidor.

## 🚀 Servir o jogo

**Localmente (testar no Opera, Chrome, etc.):**

```bash
cd game
python3 -m http.server 8000
# abre http://localhost:8000 no browser
```

**Online de borla com GitHub Pages:**

1. No repositório, vai a *Settings → Pages*.
2. Em *Source*, escolhe **Deploy from a branch**, o branch e a pasta `/ (root)`.
3. O jogo fica em `https://<utilizador>.github.io/<repo>/game/`.

## 🛠️ Estrutura

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura, HUD, joystick e botões touch (+ importmap da Three.js) |
| `style.css` | Estilo e layout responsivo (safe-area do iPhone) |
| `game.js` | Jogo 3D: cena, câmara, física, inimigos, armas, loja |
| `vendor/three.module.js` | Biblioteca Three.js (local, para funcionar offline) |
| `manifest.json` | Configuração da PWA (ecrã inteiro, ícone) |
| `sw.js` | Service worker para jogar offline |
| `icon.svg` | Ícone da app |

## 🧭 E uma versão nativa para a App Store?

Esta versão web é a forma mais rápida de jogar já no iPhone. Para uma app
**nativa** publicável na App Store seria preciso um Mac com **Xcode** (Swift/
SceneKit) ou empacotar este jogo web com Capacitor — fora do que dá para
compilar/testar neste ambiente. O código está pronto para servir de base a
qualquer dessas opções.
