# Antigravity - Web Arena Shooter

Um jogo de tiro em arena 3D inspirado em clássicos como CS, desenvolvido com **Three.js** para alta performance no navegador.

## 🚀 Como Executar Localmente
1. Abra a pasta do projeto no seu editor favorito (VS Code recomendado).
2. Utilize uma extensão de "Live Server" ou execute `npx serve .` no terminal.
3. Clique na tela para entrar no modo de jogo.

## 🕹️ Controles
- **WASD**: Movimentação
- **Espaço**: Pulo de Alta Gravidade
- **Mouse**: Mirar
- **Clique Esquerdo**: Atirar
- **1, 2, 3**: Trocar de Armas (Pistola, SMG, Sniper)

## 📦 Como Deployar via GitHub Pages

Como você está usando o **GitHub Desktop**, siga estes passos:

1. **Mover Arquivos**: Mova todos os arquivos desta pasta para `C:\Users\26012215\Documents\GitHub\Tetris`.
2. **GitHub Desktop**:
   - O aplicativo detectará as mudanças.
   - Digite uma mensagem de commit (ex: `feat: add core gameplay and arena`).
   - Clique em **Commit to main**.
   - Clique em **Push origin**.
3. **GitHub Web**:
   - Vá para o seu repositório no site do GitHub.
   - Clique em **Settings** > **Pages**.
   - Em **Source**, selecione a branch `main` e a pasta `root (/)`.
   - Clique em **Save**.
   - Em alguns minutos, seu jogo estará online no link fornecido!

## 🛠️ Arquitetura
- **Engine**: Three.js (WebGL)
- **Asset Budget**: Modelos gerados via código e formas geométricas simples para garantir 60 FPS.
- **Mapas**: Design estilo "Arena" (Pool Day).

---
Desenvolvido por Antigravity AI.
