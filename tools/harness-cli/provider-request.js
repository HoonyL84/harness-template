"use strict";

/** Shared provider transport; never execute returned text or grant tool authority. */
async function requestAgent({ provider, model, systemPrompt, prompt, postJson, env = process.env, maxOutputTokens }) {
  const required = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" }[provider];
  if (!required || !env[required] || /^(?:your_|replace|placeholder)/i.test(env[required]) || ["sk-...", "sk-ant-...", "AIza..."].includes(env[required])) throw new Error("Provider credential is missing or placeholder");
  let response, text;
  if (provider === "openai") {
    response = await postJson("https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${env[required]}` }, {
      model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
      ...(maxOutputTokens ? { max_completion_tokens: maxOutputTokens } : {})
    });
    text = response.choices?.[0]?.message?.content || "";
  } else if (provider === "anthropic") {
    response = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": env[required], "anthropic-version": "2023-06-01" }, {
      model, max_tokens: maxOutputTokens || 8192, system: systemPrompt, messages: [{ role: "user", content: prompt }]
    });
    text = Array.isArray(response.content) ? response.content
      .filter(part => part && (part.type === "text" || part.type === undefined) && typeof part.text === "string")
      .map(part => part.text).join("") : "";
  } else {
    response = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": env[required] }, {
      contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n\n${prompt}` }] }],
      ...(maxOutputTokens ? { generationConfig: { maxOutputTokens } } : {})
    });
    const parts = response.candidates?.[0]?.content?.parts;
    text = Array.isArray(parts) ? parts.filter(part => part && part.thought !== true && typeof part.text === "string")
      .map(part => part.text).join("") : "";
  }
  return { text, response, response_model: response.model || response.modelVersion || null };
}

module.exports = { requestAgent };
