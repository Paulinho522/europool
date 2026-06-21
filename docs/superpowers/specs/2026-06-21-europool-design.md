# EuroPool — Documento de Design
**Data:** 2026-06-21  
**Estado:** Aprovado para implementação

---

## 1. Visão Geral

EuroPool é uma aplicação web de grupo fechado que replica a dinâmica de um jogo partilhado inspirado no Euromilhões. Cada jogador tem uma chave de 15 números fixos por temporada. O admin introduz os 5 números sorteados em cada sorteio real do Euromilhões. O primeiro jogador cujos 15 números apareçam nos sorteios acumulados da temporada ganha. Quando alguém ganha, o vencedor é registado e começa uma nova temporada com novas chaves.

**Público-alvo:** Grupo fechado de família/amigos (50+ participantes)  
**Acesso:** Sem contas de utilizador — convidados acedem diretamente em modo leitura. Apenas o admin tem login.

---

## 2. Stack Tecnológica

| Componente | Tecnologia |
|------------|-----------|
| Frontend | HTML + CSS + JavaScript (vanilla) |
| Base de dados | Supabase (PostgreSQL) |
| Autenticação | Supabase Auth (email + password, só para admin) |
| Hosting | Netlify ou Vercel (gratuito) |
| SDK | `@supabase/supabase-js` via CDN |

**Justificação:** Supabase oferece PostgreSQL relacional, autenticação pronta, e SDK JavaScript — tudo no plano gratuito. Sem servidor próprio a gerir. O frontend é vanilla JS para simplicidade máxima.

---

## 3. Modelo de Dados

### Tabelas

#### `seasons`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `name` | text | Ex: "Temporada 1", "Temporada 2026" |
| `start_date` | date | Data de início |
| `end_date` | date (nullable) | Data de fim (null se ativa) |
| `is_active` | boolean | Só uma temporada ativa de cada vez |
| `winner_player_id` | uuid (FK → players, nullable) | Vencedor da temporada |
| `created_at` | timestamptz | Auto |

#### `players`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `name` | text | Nome do jogador (persiste entre temporadas) |
| `created_at` | timestamptz | Auto |

#### `season_players`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `season_id` | uuid (FK → seasons) | Temporada |
| `player_id` | uuid (FK → players) | Jogador |
| `key_numbers` | integer[] | Array de exatamente 15 números (1–50) |
| `created_at` | timestamptz | Auto |

> **Constraint:** `UNIQUE(season_id, player_id)` — um jogador só pode ter uma chave por temporada.

#### `draws`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `season_id` | uuid (FK → seasons) | Temporada a que pertence |
| `draw_date` | date | Data do sorteio |
| `numbers` | integer[] | Array de exatamente 5 números sorteados |
| `created_at` | timestamptz | Auto |

> **Nota:** Não existe tabela de "acertos" — os matches são calculados dinamicamente fazendo a interseção entre `key_numbers` e todos os `numbers` dos sorteios da temporada.

### Segurança (Row Level Security)
- `SELECT` em todas as tabelas: acesso público (convidados)
- `INSERT`, `UPDATE`, `DELETE`: apenas autenticados (admin via Supabase Auth)

---

## 4. Lógica de Negócio

### Cálculo de Progresso
Para um jogador numa temporada:
```
números_acertados = ARRAY (
  SELECT DISTINCT unnest(d.numbers)
  FROM draws d
  WHERE d.season_id = :season_id
  AND unnest(d.numbers) = ANY(sp.key_numbers)
)
progresso = cardinality(números_acertados) -- de 0 a 15
```
Este cálculo é feito no frontend em JavaScript após buscar os dados do Supabase.

### Regra de Vitória
Quando `progresso = 15` para qualquer jogador, o admin pode declarar esse jogador como vencedor:
1. Atualiza `seasons.winner_player_id` e `seasons.end_date`
2. Define `seasons.is_active = false`
3. Cria nova temporada com `is_active = true`

### Restrições dos Números
- Chave: exatamente 15 números inteiros únicos no intervalo 1–50
- Sorteio: exatamente 5 números inteiros únicos no intervalo 1–50
- Validação feita no frontend antes de enviar para o Supabase

---

## 5. Páginas e Navegação

```
Página Inicial
├── [Botão] Entrar como Convidado → Vista Convidado
└── [Botão] Área Admin → Login Admin → Painel Admin
```

### 5.1 Página Inicial
- Logo e nome da aplicação
- Nome da temporada ativa em destaque
- Botão principal: **"Entrar como Convidado"**
- Botão secundário (discreto): **"Área Admin"**
- Estilo visual: Verde Esmeralda (fundo `#064e3b`, destaques `#34d399`)

### 5.2 Vista Convidado (só leitura)
- **Cabeçalho:** nome da app + temporada ativa
- **Último sorteio:** data + 5 bolas em destaque
- **Pesquisa:** campo de texto para filtrar jogadores por nome (em tempo real)
- **Leaderboard:** lista ordenada por progresso decrescente
  - Medalhas 🥇🥈🥉 para os 3 primeiros
  - Posição numérica para os restantes
  - Nome do jogador + contador (ex: `11/15`) + barra de progresso
  - Clicar num jogador abre o seu perfil
- **Rodapé:** contador total de jogadores

### 5.3 Perfil do Jogador (só leitura)
- Botão "← Voltar" para o leaderboard
- Nome do jogador + temporada
- Contador grande de progresso (ex: `13/15`)
- Barra de progresso
- Grelha 5×3 com as 15 bolas:
  - **Verde** (`#34d399`): número já sorteado nesta temporada
  - **Cinzento** (borda `#374151`): número ainda pendente
- Legenda simples: Acertado / Pendente
- Mensagem motivacional quando faltam ≤ 3 números

### 5.4 Login Admin
- Formulário simples: email + password
- Autenticação via Supabase Auth
- Redireciona para Painel Admin após login bem-sucedido
- Mensagem de erro clara em caso de falha

### 5.5 Painel Admin (autenticado)
Organizado em 4 tabs:

#### Tab Sorteios
- Formulário: data + 5 campos numéricos (um por número)
- Validação: 5 números únicos, 1–50, sem repetição
- Lista dos sorteios da temporada ativa (data + 5 bolas)
- Ação: apagar sorteio (com confirmação)

#### Tab Jogadores
- Lista de todos os jogadores (globais)
- Adicionar jogador: nome
- Editar nome do jogador
- Secção "Jogadores nesta temporada":
  - Associar jogador existente à temporada + inserir chave de 15 números
  - Editar chave de um jogador na temporada atual
  - Remover jogador da temporada atual

#### Tab Temporadas
- Temporada ativa: nome, data início, nº de sorteios, nº de jogadores
- Botão: Declarar Vencedor (selecionar jogador da lista)
- Botão: Criar Nova Temporada (pede nome)
- Histórico de temporadas anteriores com vencedor

#### Tab Leaderboard
- Identical à vista convidado (para o admin acompanhar o jogo)

---

## 6. Estilo Visual

**Paleta:** Verde Esmeralda
| Elemento | Cor |
|----------|-----|
| Fundo principal | `#064e3b` |
| Fundo cards | `#065f46` |
| Fundo profundo | `#022c22` |
| Destaque (verde néon) | `#34d399` |
| Texto secundário | `#a7f3d0` |
| Texto terciário | `#6ee7b7` |
| Admin / aviso | `#fbbf24` (amarelo) |
| Erro / apagar | `#f87171` (vermelho) |

**Tipografia:** System font stack (sem dependências externas)  
**Bolas de números:** círculos perfeitos com `border-radius: 50%`  
**Barras de progresso:** gradiente `#34d399` → `#059669`

---

## 7. Estrutura de Ficheiros

```
/
├── index.html          → Página inicial
├── guest.html          → Vista convidado (leaderboard)
├── player.html         → Perfil do jogador
├── admin-login.html    → Login admin
├── admin.html          → Painel admin (tabs)
├── css/
│   └── style.css       → Estilos globais (paleta verde esmeralda)
├── js/
│   ├── supabase.js     → Inicialização do cliente Supabase
│   ├── guest.js        → Lógica do leaderboard e pesquisa
│   ├── player.js       → Lógica do perfil do jogador
│   ├── admin.js        → Lógica do painel admin
│   └── utils.js        → Funções partilhadas (cálculo de progresso, validações)
└── docs/
    └── superpowers/specs/
        └── 2026-06-21-europool-design.md
```

---

## 8. Hosting e Deploy

1. Criar projeto no [Supabase](https://supabase.com) (gratuito)
2. Criar as 4 tabelas via SQL Editor do Supabase
3. Configurar Row Level Security (RLS)
4. Criar conta admin via Supabase Auth → Authentication → Users
5. Publicar frontend no [Netlify](https://netlify.com) ou [Vercel](https://vercel.com) (arrastar pasta ou ligar a GitHub)
6. Adicionar variáveis de ambiente: `SUPABASE_URL` e `SUPABASE_ANON_KEY`

---

## 9. Fora de Âmbito (YAGNI)

Os seguintes pontos foram conscientemente excluídos para manter a simplicidade:
- Notificações por email/push
- Registo de utilizadores (sem contas de jogador)
- Integração automática com resultados do Euromilhões (admin insere manualmente)
- App mobile nativa
- Múltiplos admins
- Exportação de dados

---

## 10. Critérios de Sucesso

- [ ] Convidado consegue ver o leaderboard sem fazer login
- [ ] Convidado consegue pesquisar jogadores por nome
- [ ] Convidado consegue ver os 15 números de qualquer jogador com acertos destacados
- [ ] Admin consegue fazer login e aceder ao painel
- [ ] Admin consegue registar sorteios com data e 5 números
- [ ] Admin consegue adicionar jogadores e atribuir chaves por temporada
- [ ] Admin consegue declarar vencedor e criar nova temporada
- [ ] Leaderboard ordena corretamente por progresso decrescente
- [ ] A app funciona em desktop e mobile
- [ ] Deploy público acessível via URL
