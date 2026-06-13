# 🔧 Bolt Ranger

Jogo de ação 2D (plataformas + tiros) inspirado em **Ratchet & Clank**, feito em
HTML5/Canvas e **otimizado para iPhone** (controlos touch + suporte a PWA).

Não precisa de Xcode, Mac, nem da App Store: corre no **Safari do iPhone** e pode
ser instalado no ecrã principal como uma app em ecrã inteiro.

## 🎮 Como jogar

- **Mover:** joystick analógico (canto inferior esquerdo) — quanto mais inclinas, mais rápido andas
- **Saltar:** ⤴ (salto duplo — carrega outra vez no ar)
- **Disparar / atacar:** 🔫
- **Trocar de arma:** 🔄

Apanha **bolts (⚙️)** dos robôs derrotados e dos caixotes. Entre ondas abre a
**loja** para reparar a armadura, aumentar a vida máxima e comprar novas armas
(Espingarda e Pyrocitor). Cada onda traz mais inimigos e mais difíceis.

**Teclado (para testar no computador):**
`←/→` mover · `↑`/`Espaço` saltar · `Z`/`X` disparar · `C` trocar arma.

## 📱 Como pôr no iPhone

1. Coloca esta pasta `game/` a ser servida por HTTPS (ver abaixo).
2. No iPhone, abre o endereço no **Safari**.
3. Toca em **Partilhar → Adicionar ao ecrã principal**.
4. Abre pelo ícone: arranca em ecrã inteiro, na horizontal, como uma app.

> O Safari da Apple não corre ficheiros `file://` com Service Worker, por isso o
> jogo tem de ser servido por um servidor (HTTPS de preferência).

## 🚀 Servir o jogo

**Localmente (testar):**

```bash
cd game
python3 -m http.server 8000
# abre http://localhost:8000 no browser
```

**Online de borla com GitHub Pages:**

1. No repositório, vai a *Settings → Pages*.
2. Em *Source*, escolhe o branch e a pasta `/` (ou move `game/` para a raiz).
3. O jogo fica em `https://<utilizador>.github.io/<repo>/game/`.

## 🛠️ Estrutura

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura, HUD e botões touch |
| `style.css` | Estilo e layout responsivo (safe-area do iPhone) |
| `game.js` | Motor do jogo: física, inimigos, armas, loja, render |
| `manifest.json` | Configuração da PWA (ecrã inteiro, ícone) |
| `sw.js` | Service worker para jogar offline |
| `icon.svg` | Ícone da app |

## 🧭 E uma versão nativa para a App Store?

Esta versão web é a forma mais rápida de jogar já no iPhone. Para uma app
**nativa** publicável na App Store seria preciso um Mac com **Xcode** e
desenvolver em Swift/SpriteKit ou empacotar este jogo web com Capacitor —
fora do que dá para compilar/testar neste ambiente. O código está pronto para
servir de base a qualquer dessas opções.
