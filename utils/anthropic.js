/**
 * Lightweight Anthropic API wrapper using native fetch.
 *
 * The official @anthropic-ai/sdk fails on Railway with APIConnectionError
 * because its internal HTTP client streams request bodies in a way that
 * Railway's proxy rejects. Plain fetch works perfectly.
 */

async function anthropicMessages({ apiKey, model, system, max_tokens = 1024, messages }) {
  const body = { model, max_tokens, messages };
  if (system) body.system = system;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok) {
    const msg = data?.error?.message || `Anthropic API error ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.anthropicError = data?.error;
    throw err;
  }

  // Return object shaped like the SDK response so callers need minimal changes
  return {
    content: data.content,          // [{ type: 'text', text: '...' }]
    stop_reason: data.stop_reason,
    usage: data.usage,
  };
}

module.exports = { anthropicMessages };
