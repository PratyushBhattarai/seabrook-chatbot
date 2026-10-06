# Seabrook Texas Town Chatbot

A RAG (Retrieval-Augmented Generation) chatbot for [seabrooktexastown.com](https://www.seabrooktexastown.com/). It answers questions **only** from the website's content and politely refuses anything off-topic.

## How it works

```
 ┌──────────── data-pipeline (ChatBot/) ────────────┐
 │ Crawl site → Clean text → Chunk → Embed → Save   │──► Supabase (pgvector)
 └──────────────────────────────────────────────────┘          │
                                                               ▼
 User question → Rewrite follow-ups → Embed → Vector search → Gemini answers
 └──────────────────── web app (chatbot-web/) ──────────────────────────┘
```

1. **Crawl** – Puppeteer opens each page of the site (so JavaScript-rendered content is included); Cheerio extracts the text.
2. **Clean** – removes menus, scripts, the live weather widget and shop clutter; keeps email addresses and outside links.
3. **Chunk** – splits text into ~500-character pieces with 50 characters of overlap. The page title is added to each chunk.
4. **Embed** – `gemini-embedding-001` turns each chunk into a 3072-number vector (L2-normalized).
5. **Store** – chunks and vectors are saved in a Supabase `documents` table.
6. **Answer** – for each question, the app finds the 5 most similar chunks and asks Gemini to answer using only those.

## Tech stack

| Part | Technology |
|---|---|
| Crawler | Node.js, Puppeteer, Cheerio, LangChain text splitter |
| Embeddings | Google `gemini-embedding-001` (3072 dimensions) |
| Vector database | Supabase (PostgreSQL + pgvector) |
| Web app | Next.js 15 (App Router), React 19, TypeScript |
| Chat model | `gemini-3.5-flash-lite`, with `gemini-3.8-flash` as backup |

## Features

- Answers only from website content; refuses off-topic questions and prompt-injection attempts
- **Follow-up questions** – "tell me more about that" is rewritten into a full question using the recent conversation (this also fixes typos)
- **Shop questions** – product names and prices are read from the shop's product cards and stored as tidy per-category price lists
- **Reliability** – retries when Gemini is busy, then switches to a backup model
- **Shares useful links** – e.g. the official events calendar and city portal
- **Never invents live data** – e.g. it won't report "today's weather" from an old snapshot

## Design decisions

- **Retry + fallback model** – Gemini sometimes returns 503 "high demand" errors. The app retries (1s, then 2s) and falls back to a second model.
- **Low temperature (0.3)** – makes answers consistent; early tests showed the same question being answered and refused at random.
- **Links are collected before menus/footers are removed** – otherwise pages linked only from the menu (like Contact Us) were never crawled.
- **Footer saved once** – it contains the support email but repeats on every page, so it is stored as a single chunk.
- **Product cards instead of product pages** – product detail pages load their content in the browser and have no structured data; the category pages have clean name + price cards.
- **Corrections during the crawl** – the website lists City Hall at 1400 Cook Street, which is actually the police station (City Hall is at 1700 1st Street, per seabrooktx.gov). Since the website can't be edited, `ingest.js` has a `CORRECTIONS` list that fixes known errors before they reach the database. The crawl log reports whether each correction was applied.
- **Resumable ingestion** – chunks already in the database are skipped, so a run interrupted by the free-tier daily limit can continue where it stopped.

## Security

- Row Level Security is **enabled** on `documents` with no policies, so the public (anon) key has no direct table access.
- The web app only searches through the `match_documents` function, which is `SECURITY DEFINER`.
- The crawler uses the Supabase **secret (service role) key**, which stays in the local `ChatBot/.env` and is never used by the web app.
- All keys live in `.env` files, which are excluded from Git. See the `.env.example` files.

## Known limitations

- **Free-tier limits** – Google's free tier allows 1,000 embeddings per day. A full crawl uses ~270, and every question uses 1. A production deployment should use a paid plan.
- **No rate limiting yet** – a single visitor could send unlimited questions.
- **Shop coverage** – only the first page of each shop category is read (147 products currently).
- **Freshness** – the bot only knows the site as of the last crawl. Re-crawl after the website changes.
- **Website errors** – the bot repeats whatever the site says (e.g. "free shipping above $2,500"), except for errors listed in `CORRECTIONS`.

## Project structure

```
ChatBot/                  Data pipeline
  ingest.js               Crawl, clean, chunk, embed and save
  test-search.js          Checks that vector search returns relevant chunks
  .env.example

chatbot-web/              Next.js app
  app/api/chat/route.ts   API: rewrite question → embed → search → answer
  app/chat/page.tsx       Chat UI
  lib/gemini.ts           Gemini calls with retry/fallback + follow-up rewriting
  lib/embeddings.ts       Question embedding (normalized)
  lib/supabase.ts         Supabase client
  .env.example

supabase/setup.sql        Database table, search function and security settings
```

## Setup

### 1. Database (Supabase)

Create a Supabase project, then run `supabase/setup.sql` in the SQL Editor.

### 2. Data pipeline

```bash
cd ChatBot
npm install
cp .env.example .env      # then fill in the values
node ingest.js
```

To rebuild the data from scratch, first run `delete from documents;` in Supabase.

### 3. Web app

```bash
cd chatbot-web
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000/chat

## Example questions

| Question | Expected behaviour |
|---|---|
| What is Seabrook known for? | Summary of the bay, wetlands, trails and history |
| How do I contact the city? | City Hall address and phone, plus the website support email |
| What events are happening? | Overview + link to the official calendar (visitseabrook.com) |
| Tell me about the trails → Tell me more about that | Follow-up understood |
| How much is a tote bag? | From $43.99, with a link to the shop |
| What's the weather today? | Says it can't check live conditions |
| What is the capital of France? | Politely refused |

## Next steps

- Rate limiting and a message-length limit
- Friendly error message in the chat when the API fails
- Deploy to Vercel and turn the chat into an embeddable floating widget
- Analytics on unanswered questions
- Scheduled re-crawls
