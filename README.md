# rllyU

> Talk to a clone of yourself, built from your texts.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + Vanilla TypeScript |
| Backend | Fastify + TypeScript |
| DB | SQLite + Prisma (Postgres-ready) |
| Auth | Server sessions via HttpOnly cookies |
| AI | OpenAI API (GPT-4o, server-side only) |

---

## Quick start

### Prerequisites

- Node.js 20+
- pnpm / npm / yarn
- An OpenAI API key

### 1. Clone & install

```bash
git clone <repo>
cd rllyu

# Install backend deps
cd backend && npm install && cd ..

# Install frontend deps
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cd backend
cp ../.env.example .env
```

Edit `backend/.env`:

```env
OPENAI_API_KEY=sk-...
SESSION_SECRET=your-random-32-char-secret-here
DATABASE_URL="file:./dev.db"
```

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Set up the database

```bash
cd backend
npm run db:push    # Creates SQLite file and applies schema
npm run db:generate  # Generates Prisma client
```

### 4. Run

**Backend** (terminal 1):
```bash
cd backend
npm run dev
# → http://localhost:3001
```

**Frontend** (terminal 2):
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173)

---

## User flow

1. **Sign up** → land on import page
2. **Import texts** — paste raw chat logs or upload `.txt` / `.csv` / `.jsonl`
3. **Clone builds** — single OpenAI call analyzes voice, extracts quirks
4. **Chat** — full-screen immersive chat; clone opens with a "holy sh*t" first message
5. **Paywall** at reply #6 — blurred bubble + modal: "You built it. Don't stop now."

---

## Import formats

### Pasted text (auto-detected)
```
[12/15/23, 2:34 PM] You: yo did you see that movie
[12/15/23, 2:35 PM] Friend: which one lol
[12/15/23, 2:35 PM] You: the one i mentioned like 3 times
```

### CSV
```csv
timestamp,author,text
2023-12-15,You,yo did you see that movie
```

### JSONL
```jsonl
{"author":"You","text":"yo did you see that movie"}
{"author":"Friend","text":"which one lol"}
```

---

## Architecture notes

### Ingestion pipeline
- `backend/src/lib/ingestion.ts` — format detection → normalize → deduplicate via SHA-256 hash
- Filters to the most active author (assumed to be "you")

### Clone profile
- Single GPT-4o-mini call: extracts `styleSummary` + `quirksJson`
- Stored in `CloneProfile` table, rebuilt on demand

### Lightweight RAG
- `backend/src/lib/rag.ts` — TF-IDF scoring over `MessageRow.text`
- Top 5 relevant excerpts injected into every system prompt as "memory"

### Safety
- `backend/src/lib/safety.ts` — crisis keyword detection
- Detected → override response with care message + resources

### Paywall
- `User.cloneReplyCount` incremented server-side on every clone reply
- At reply ≥ 6, backend returns 402; frontend blurs partial message + shows modal
- Frontend also has a client-side guard (UX only — backend is the source of truth)

---

## Upgrading to Postgres

1. In `backend/prisma/schema.prisma`, change:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL=postgresql://...` in `.env`
3. Run `npm run db:push`

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✓ | OpenAI secret key |
| `SESSION_SECRET` | ✓ | ≥32-char session encryption secret |
| `DATABASE_URL` | ✓ | SQLite: `file:./dev.db` or Postgres URL |
| `PORT` | | Backend port (default: 3001) |
| `FRONTEND_URL` | | CORS origin (default: http://localhost:5173) |
| `NODE_ENV` | | `development` or `production` |

---

## Production checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong, random `SESSION_SECRET`
- [ ] Switch to Postgres for durability
- [ ] Serve frontend build via CDN or static host
- [ ] Put backend behind a reverse proxy (nginx/Caddy) with TLS
- [ ] Set `FRONTEND_URL` to your real domain
- [ ] Add Stripe for the paywall CTA

---

*Built different · 2025*
