import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fal } from '@fal-ai/client';
import { loadEnv } from 'vite';

const fluxEndpoint = '/api/flux-render';
const directTripoEndpoint = '/api/tripo-direct-render';

function fluxRenderApi() {
  return {
    name: 'flux-render-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const key = env.FLUX_API_KEY;
      const tripoKey = env.TRIPO_API_KEY || env.TRIP0_API_KEY;
      server.middlewares.use(fluxEndpoint, async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        if (!key) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'FLUX_API_KEY is missing from .env.' }));
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 12_000_000) throw new Error('Sketch image is too large.');
          }
          const { image, prompt, rendererId } = JSON.parse(body);
          const match = typeof image === 'string' && image.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
          const modelId = rendererId === 'trellis'
            ? 'fal-ai/trellis'
            : rendererId === 'tripo-api'
              ? 'tripo3d/tripo/v2.5/image-to-3d'
              : rendererId === 'meshy-text'
                ? 'meshy/v7.1/text-to-3d'
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
              ...(rendererId === 'meshy-text' ? { prompt } : rendererId === 'flux-kontext'
                ? { prompt, image_urls: [image], output_format: 'png' }
                : {
                image_url: new Blob([bytes], { type: `image/${match[1]}` }),
              }),
            },
            ...(rendererId === 'tripo-api' || rendererId === 'meshy-text' || rendererId === 'flux-kontext' ? {
              logs: true,
              onQueueUpdate: (update) => {
                if (update.status === 'IN_PROGRESS') {
                  const rendererName = rendererId === 'meshy-text' ? 'Meshy' : rendererId === 'tripo-api' ? 'Tripo' : 'FLUX Kontext Max';
                  update.logs?.map((log) => log.message).forEach((message) => console.log(`[fal ${rendererName}] ${message}`));
                }
              },
            } : {}),
          });
          const result = rendererId === 'trellis'
            ? { url: output.data?.model_mesh?.url, filename: output.data?.model_mesh?.file_name }
            : rendererId === 'meshy-text'
              ? {
                url: output.data?.model_glb?.url || output.data?.model_urls?.glb?.url,
                previewUrl: output.data?.thumbnail?.url,
                filename: output.data?.model_glb?.file_name || 'meshy-model.glb',
              }
            : rendererId === 'tripo-api'
              ? {
                url: output.data?.model_mesh?.url || output.data?.pbr_model?.url || output.data?.base_model?.url,
                previewUrl: output.data?.rendered_image?.url,
                filename: output.data?.model_mesh?.file_name || 'tripo-model.glb',
              }
              : { url: output.data?.images?.[0]?.url };
          if (!result.url) {
            const rendererName = rendererId === 'trellis' ? 'Trellis' : rendererId === 'tripo-api' ? 'Tripo' : 'FLUX';
            throw new Error(`${rendererName} did not return an output file.`);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ...result, kind: rendererId === 'flux-kontext' ? 'image' : 'model' }));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || 'FLUX rendering failed.' }));
        }
      });
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname !== directTripoEndpoint && !pathname.startsWith(`${directTripoEndpoint}/`)) return next();
        res.setHeader('Content-Type', 'application/json');
        if (!tripoKey) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'TRIPO_API_KEY (or TRIP0_API_KEY) is missing from .env.' }));
          return;
        }
        try {
          let upstream;
          if (req.method === 'POST' && pathname === directTripoEndpoint) {
            let body = '';
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 12_000_000) throw new Error('Sketch image is too large.');
            }
            const { image } = JSON.parse(body);
            const match = typeof image === 'string' && image.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
            if (!match) throw new Error('A PNG or JPEG sketch image is required.');
            const bytes = Buffer.from(match[2], 'base64');
            if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Sketch image must be smaller than 20 MB.');

            const form = new FormData();
            form.append('file', new Blob([bytes], { type: `image/${match[1]}` }), `sketch.${match[1]}`);
            const upload = await fetch('https://openapi.tripo3d.ai/v3/files', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tripoKey}` },
              body: form,
            });
            const uploaded = await upload.json();
            if (!upload.ok || uploaded.code !== 0 || !uploaded.data?.file_token) {
              res.statusCode = upload.status || 502;
              res.end(JSON.stringify({ error: uploaded.message || uploaded.msg || 'Tripo could not upload the sketch.' }));
              return;
            }

            upstream = await fetch('https://openapi.tripo3d.ai/v3/generation/image-to-model', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tripoKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                input: uploaded.data.file_token,
                model: 'v3.1-20260211',
                texture: true,
                pbr: true,
                texture_quality: 'detailed',
              }),
            });
          } else if (req.method === 'GET' && pathname.startsWith(`${directTripoEndpoint}/`)) {
            const taskId = pathname.slice(`${directTripoEndpoint}/`.length);
            if (!/^task_[\w-]+$/.test(taskId)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid Tripo task ID.' }));
              return;
            }
            upstream = await fetch(`https://openapi.tripo3d.ai/v3/tasks/${encodeURIComponent(taskId)}`, {
              headers: { Authorization: `Bearer ${tripoKey}` },
            });
          } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed.' }));
            return;
          }

          const data = await upstream.json();
          res.statusCode = upstream.status;
          if (!upstream.ok || data.code !== 0) {
            res.end(JSON.stringify({ error: data.message || data.msg || 'Tripo request failed.' }));
            return;
          }
          res.end(JSON.stringify(data.data));
        } catch (error) {
          res.statusCode = error instanceof SyntaxError ? 400 : 502;
          res.end(JSON.stringify({ error: error.message || 'Tripo request failed.' }));
        }
      });
    },
  };
}

export default defineConfig({ plugins: [react(), fluxRenderApi()] });
