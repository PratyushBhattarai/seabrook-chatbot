import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { embedQuestion } from '@/lib/embeddings';
import { generateAnswer, rewriteQuestion } from '@/lib/gemini';

export const maxDuration = 30;

const SIMILARITY_THRESHOLD = 0.55;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('📩 Received:', JSON.stringify(body, null, 2));

    const messages = body.messages || [];
    if (messages.length === 0) {
      return Response.json({ error: 'No messages provided' }, { status: 400 });
    }

    const userMessage = messages[messages.length - 1].content;
    console.log('🔍 User question:', userMessage);

    // 0. Turn follow-ups ("tell me more about that") into full questions
    const history = messages.slice(0, -1);
    const question =
      history.length > 0 ? await rewriteQuestion(history, userMessage) : userMessage;
    console.log('✏️ Search question:', question);

    // 1. Embed the question
    const questionEmbedding = await embedQuestion(question);
    console.log('✅ Embedded question');

    // 2. Search Supabase
    const { data: matches, error } = await supabase.rpc('match_documents', {
      query_embedding: questionEmbedding,
      match_threshold: SIMILARITY_THRESHOLD,
      match_count: 5,
    });

    if (error) {
      console.error('❌ Supabase error:', error);
      return Response.json({ error: 'Search failed' }, { status: 500 });
    }

    console.log(`📚 Found ${matches?.length || 0} matches`);
    matches?.forEach((m: any, i: number) => {
      console.log(`  [${i + 1}] similarity ${m.similarity?.toFixed(2)}: ${m.content.slice(0, 200).replace(/\s+/g, ' ')}`);
    });

    // 3. Refuse questions with nothing relevant on the website
    if (!matches || matches.length === 0) {
      const refusal =
        "I couldn't find anything about that on the Seabrook Texas Town website. Try asking about the town's parks, trails, history, things to do, or the online shop.";
      return Response.json({ reply: refusal });
    }

    // 4. Build context
    const context = matches
      .map((m: any, i: number) => `[${i + 1}] ${m.content}`)
      .join('\n\n');

    // 5. Build prompt for Gemini
    const systemPrompt = `You are the assistant for the Seabrook Texas Town website (seabrooktexastown.com).

RULES:
1. Answer ONLY using the CONTEXT provided below.
2. Never use your own general knowledge.
3. The context is often written in a storytelling style. Combine and summarize what it says to answer. Only if the context has nothing related to the question, say: "I don't have that information on the website. You can contact the town directly for help."
4. If the question is not about Seabrook or this website (including its online shop), politely say: "I can only answer questions about Seabrook and the Seabrook Texas Town website."
5. Keep answers concise — 2 to 4 sentences.
6. Use a friendly, welcoming tone. Don't start every answer with a greeting.
7. Answer naturally, as if you simply know this. Never mention "the context", "the text", "the website content", or say "based on the website".
8. Never give today's weather or other live information. The context may contain an old temperature reading copied from the website. For weather, say you can't check live conditions and suggest a weather app.
9. If the context includes a web address or email that helps answer the question, include it in your answer.
10. When the context has a phone number or address for what the user asked about, always include it.
11. For shop questions, give product names and prices from the context. Prices are "from" amounts and may vary by size or option. Point people to the shop at seabrooktexastown.com/shop.

CONTEXT:
${context}`;

    // 6. Call Gemini (with retries + fallback model)
    console.log('🤖 Calling Gemini...');
    const reply = await generateAnswer(systemPrompt, question);
    console.log('✅ Gemini replied:', reply.substring(0, 100));

    return Response.json({ reply });

  } catch (err: any) {
    console.error('💥 Chat API error:', err);
    return Response.json(
      { error: err.message || 'Something went wrong' },
      { status: 500 }
    );
  }
}