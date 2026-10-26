import { createServer } from 'node:http';
import { fal } from '@fal-ai/client';

const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://irisyangs.github.io';
const maxBodyBytes = 12_000_000;

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.headers.origin && req.headers.origin !== allowedOrigin) {
    send(res, 403, { error: 'Origin not allowed.' });
    return;
  }
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }
  if (req.url !== '/api/flux-render' || req.method !== 'POST') {
    send(res, 404, { error: 'Not found.' });
    return;
  }

  const key = process.env.FLUX_API_KEY;
  if (!key) {
    send(res, 503, { error: 'FLUX_API_KEY is not configured on the API server.' });
    return;
  }

  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Sketch image is too large.');
    }
    const { image, prompt, rendererId } = JSON.parse(body);
    const match = typeof image === 'string' && image.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
    const modelId = rendererId === 'trellis'
      ? 'fal-ai/trellis'
      : rendererId === 'tripo-api'
        ? 'tripo3d/tripo/v2.5/image-to-3d'
        : rendererId === 'meshy-text'
          ? 'meshy/v7.1/text-to-3d'
          : rendererId === 'hunyuan3d'
            ? 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d'
            : rendererId === 'flux-kontext'
              ? 'fal-ai/flux-pro/kontext/max/multi'
              : null;
    const validPrompt = typeof prompt === 'string' && prompt.trim().length > 0;
    if (!modelId || (rendererId === 'meshy-text' && (!validPrompt || prompt.length > 600)) ||
      (rendererId !== 'meshy-text' && !match) || (rendererId === 'flux-kontext' && !validPrompt)) {
      throw new Error('A sketch and supported fal renderer are required.');
    }

    fal.config({ credentials: key });
    const bytes = match ? Buffer.from(match[2], 'base64') : null;
    const output = await fal.subscribe(modelId, {
      input: {
        ...(rendererId === 'meshy-text' ? { prompt } : rendererId === 'hunyuan3d'
          ? { input_image_url: image }
          : rendererId === 'flux-kontext'
            ? { prompt, image_urls: [image], output_format: 'png' }
            : { image_url: new Blob([bytes], { type: `image/${match[1]}` }) }),
      },
    });
    const result = rendererId === 'trellis'
      ? { url: output.data?.model_mesh?.url, filename: output.data?.model_mesh?.file_name }
      : rendererId === 'meshy-text'
        ? { url: output.data?.model_glb?.url || output.data?.model_urls?.glb?.url, previewUrl: output.data?.thumbnail?.url, filename: output.data?.model_glb?.file_name || 'meshy-model.glb' }
        : rendererId === 'hunyuan3d'
          ? { url: output.data?.model_glb?.url || output.data?.model_urls?.glb?.url, previewUrl: output.data?.thumbnail?.url, filename: output.data?.model_glb?.file_name || 'hunyuan-model.glb' }
          : rendererId === 'tripo-api'
            ? { url: output.data?.model_mesh?.url || output.data?.pbr_model?.url || output.data?.base_model?.url, previewUrl: output.data?.rendered_image?.url, filename: output.data?.model_mesh?.file_name || 'tripo-model.glb' }
            : { url: output.data?.images?.[0]?.url };
    if (!result.url) throw new Error('The renderer did not return an output file.');
    send(res, 200, { ...result, kind: rendererId === 'flux-kontext' ? 'image' : 'model' });
  } catch (error) {
    send(res, 502, { error: error.message || 'FLUX rendering failed.' });
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => console.log(`Render API listening on port ${port}`));
