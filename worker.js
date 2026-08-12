// worker.js — Cloudflare Worker proxy for all three live demos on the portfolio.
//
// Routes:
//   POST /sketchful  -> Roboflow (doodle classifier)
//   POST /xray       -> Roboflow (object detection)
//   POST /face       -> Hugging Face (age + gender + race, called in parallel)
//
// All API keys/tokens are read from encrypted secrets (see DEPLOY.md) and
// never appear in the portfolio's client-side code.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your domain once deployed
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64ToBytes(base64) {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function callRoboflow(modelId, apiKey, base64Image) {
  const clean = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
  const url = `https://serverless.roboflow.com/${modelId}?api_key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: clean,
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Roboflow ${modelId} error (${resp.status}): ${detail}`);
  }
  return resp.json();
}

async function callHFImageClassification(modelId, token, base64Image) {
  const bytes = base64ToBytes(base64Image);
  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: bytes,
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`HF ${modelId} error (${resp.status}): ${detail}`);
  }
  return resp.json(); // array of {label, score}, sorted descending
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { image } = body;
    if (!image) return json({ error: "Missing 'image' in request body" }, 400);

    try {
      if (url.pathname === "/sketchful") {
        const data = await callRoboflow(env.ROBOFLOW_MODEL_SKETCHFUL, env.ROBOFLOW_API_KEY, image);
        return json(data);
      }

      if (url.pathname === "/xray") {
        const data = await callRoboflow(env.ROBOFLOW_MODEL_XRAY, env.ROBOFLOW_API_KEY, image);
        return json(data);
      }

      if (url.pathname === "/face") {
        const [age, gender, race] = await Promise.all([
          callHFImageClassification(env.HF_MODEL_AGE, env.HF_TOKEN_AGE, image),
          callHFImageClassification(env.HF_MODEL_GENDER, env.HF_TOKEN_GENDER, image),
          callHFImageClassification(env.HF_MODEL_RACE, env.HF_TOKEN_RACE, image),
        ]);
        return json({ age, gender, race });
      }

      return json({ error: `Unknown route: ${url.pathname}` }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
