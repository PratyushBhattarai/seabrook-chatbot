'use client';

import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await res.json();
      console.log('📥 Response:', data);

      const reply = data.reply || data.error || 'Sorry, something went wrong.';
      setMessages([...updatedMessages, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.error('💥 Error:', err);
      setMessages([
        ...updatedMessages,
        { role: 'assistant', content: 'Network error. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: '720px',
        margin: '0 auto',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f8fafc',
      }}
    >
      <header
        style={{
          background: '#1d4ed8',
          color: 'white',
          padding: '16px 24px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
          Seabrook Texas Town Assistant
        </h1>
        <p style={{ fontSize: '12px', opacity: 0.85, margin: '4px 0 0' }}>
          Ask me about the town, events, parks, and more
        </p>
      </header>

      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 16px',
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', marginTop: '40px' }}>
            <p style={{ fontSize: '20px', margin: '0 0 8px' }}>👋 Welcome!</p>
            <p style={{ fontSize: '14px', margin: 0 }}>Try asking:</p>
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              {[
                'What is Seabrook known for?',
                'What parks are in Seabrook?',
                'Tell me about the town history',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  style={{
                    padding: '10px 20px',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '999px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#334155',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '10px 16px',
                borderRadius:
                  m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: m.role === 'user' ? '#2563eb' : 'white',
                color: m.role === 'user' ? 'white' : '#0f172a',
                border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                fontSize: '14px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                boxShadow: m.role === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
            <div
              style={{
                padding: '10px 16px',
                borderRadius: '16px 16px 16px 4px',
                background: 'white',
                border: '1px solid #e2e8f0',
                color: '#64748b',
                fontSize: '14px',
                fontStyle: 'italic',
              }}
            >
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '8px',
          padding: '16px',
          background: 'white',
          borderTop: '1px solid #e2e8f0',
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about Seabrook..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: '1px solid #cbd5e1',
            borderRadius: '999px',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '12px 24px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '999px',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}