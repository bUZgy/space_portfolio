// worker.js — Cloudflare Worker proxy for all three live demos on the portfolio.
//
// Routes:
//   POST /sketchful  -> Roboflow (doodle classifier)
//   POST /xray       -> Roboflow (object detection)
//   POST /face       -> Gradio Space (age + gender + ethnicity, local inference)
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

// Gradio's REST API is a 3-step flow (the gradio_client Python library hides
// this): upload the file, kick off the call to get an event_id, then read
// the result back as a Server-Sent Events stream.
async function callGradioFace(spaceUrl, base64Image) {
  const bytes = base64ToBytes(base64Image);
  const blob = new Blob([bytes], { type: "image/jpeg" });

  // 1. Upload the image, get back a server-side file path
  const form = new FormData();
  form.append("files", blob, "face.jpg");
  const uploadResp = await fetch(`${spaceUrl}/gradio_api/upload`, {
    method: "POST",
    body: form,
  });
  if (!uploadResp.ok) {
    throw new Error(`Gradio upload failed (${uploadResp.status}): ${await uploadResp.text()}`);
  }
  const uploadedPaths = await uploadResp.json(); // e.g. ["/tmp/gradio/xxx/face.jpg"]
  const filePath = uploadedPaths[0];

  // 2. Kick off the /classify call, referencing the uploaded file
  const callResp = await fetch(`${spaceUrl}/gradio_api/call/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [{ path: filePath, meta: { _type: "gradio.FileData" } }],
    }),
  });
  if (!callResp.ok) {
    throw new Error(`Gradio call failed (${callResp.status}): ${await callResp.text()}`);
  }
  const { event_id } = await callResp.json();
  if (!event_id) {
    throw new Error("Gradio call did not return an event_id");
  }

  // 3. Read the result back as a Server-Sent Events stream
  const resultResp = await fetch(`${spaceUrl}/gradio_api/call/classify/${event_id}`);
  if (!resultResp.ok || !resultResp.body) {
    throw new Error(`Gradio result fetch failed (${resultResp.status})`);
  }

  const reader = resultResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalData = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep any incomplete trailing line for next chunk

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        try {
          finalData = JSON.parse(jsonStr);
        } catch {
          // ignore heartbeat/non-JSON lines
        }
      }
    }
  }

  if (!finalData) {
    throw new Error("No data received from Gradio's event stream");
  }

  // finalData is the tuple [age, gender, ethnicity] per the app's outputs
  return finalData;
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
        const [age, gender, ethnicity] = await callGradioFace(env.GRADIO_FACE_SPACE_URL, image);
        return json({ age, gender, ethnicity });
      }

      return json({ error: `Unknown route: ${url.pathname}` }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
