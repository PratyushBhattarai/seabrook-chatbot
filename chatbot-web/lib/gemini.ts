import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Tried in this order. If the first is busy, the second is used.
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

// Wait 1s, then 2s between retries (3 tries per model)
const WAITS_MS = [1000, 2000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Busy" errors are worth retrying. Others (like a bad API key) are not.
function isBusyError(err: any) {
  const status = err?.status;
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    status === 503 || status === 500 || status === 429 ||
    msg.includes("503") || msg.includes("high demand") || msg.includes("overloaded")
  );
}

export async function generateAnswer(systemPrompt: string, userMessage: string): Promise<string> {
  let lastError: unknown;

  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 0; attempt <= WAITS_MS.length; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          systemInstruction: systemPrompt,
          generationConfig: { temperature: 0.3 },
        });
        console.log(`✅ Answered with ${modelName} (attempt ${attempt + 1})`);
        return result.response.text();
      } catch (err) {
        lastError = err;
        if (!isBusyError(err)) throw err; // real bug: stop immediately
        if (attempt < WAITS_MS.length) {
          console.log(`⏳ ${modelName} busy, retrying in ${WAITS_MS[attempt] / 1000}s...`);
          await sleep(WAITS_MS[attempt]);
        }
      }
    }
    console.log(`↪️ ${modelName} still busy, switching to next model...`);
  }

  throw lastError; // every model failed
}

type ChatMessage = { role: string; content: string };

// Turns a follow-up like "tell me more about that" into a full question
// like "Tell me more about the trails in Seabrook", using the recent chat.
export async function rewriteQuestion(history: ChatMessage[], question: string): Promise<string> {
  const recent = history
    .slice(-6) // only the last 6 messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const instructions = `You rewrite follow-up questions so they make sense on their own.
Using the conversation, rewrite the user's latest message as one standalone question.
Replace words like "that", "it", "there" and "those" with what they refer to, and fix spelling mistakes.
If the message is already clear on its own, return it unchanged.
Do not answer the question. Reply with the rewritten question only.`;

  const input = `Conversation:\n${recent}\n\nLatest message: ${question}`;

  try {
    const rewritten = (await generateAnswer(instructions, input)).trim();
    return rewritten || question;
  } catch {
    return question; // if rewriting fails, just use the original message
  }
}