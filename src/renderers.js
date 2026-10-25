// Each renderer wants a different kind of input. A renderer entry says what to send and builds the text for it.
// These are STARTING templates. Tune each one against real outputs (see the benchmark task) before trusting it.
// To add a renderer: add an entry here. To make the prompts smarter, replace buildPrompt with a call to a language model.

const base = (domain, design) => domain.describe(design).replace(/\s*(Flat-lay product photo|Product photo), plain background\.$/, '').replace(/\.$/, '');

export const renderers = [
  {
    id: 'flux-kontext',
    name: 'FLUX Kontext Max Multi (sketch to photo)',
    sends: 'the sketch image plus an instruction',
    output: '2D image',
    buildPrompt: (domain, design) =>
      `Turn this line drawing into a photorealistic 3D studio product render. Preserve its exact silhouette, proportions, and colors. ` +
      `It shows: ${base(domain, design)}. Soft even lighting, plain light-gray background, no text, no extra objects.`,
  },
  {
    id: 'meshy-text',
    name: 'Meshy (text to 3D)',
    sends: 'text only',
    output: '3D model',
    buildPrompt: (domain, design) =>
      `${base(domain, design)}. A single object, centered, complete and closed, realistic materials, no base, no background, no text.`,
  },
  {
    id: 'tripo-api',
    name: 'Tripo via fal (v2.5 image to 3D)',
    sends: 'the sketch image (white background, object centered)',
    output: '3D model',
    buildPrompt: () => 'No text prompt. Send the sketch image. If the result ignores the colors, render the sketch to a photo first (FLUX Kontext), then send that photo.',
  },
  {
    id: 'hunyuan3d',
    name: 'Hunyuan 3D Pro (v3.1 image to 3D)',
    sends: 'the sketch image to Hunyuan through fal',
    output: '3D model',
    buildPrompt: () => 'No text prompt. Send the sketch image to Hunyuan 3D Pro.',
  },
  {
    id: 'trellis',
    name: 'TRELLIS 2 (image to 3D, open models)',
    sends: 'one image (white background, object centered)',
    output: '3D model',
    buildPrompt: () => 'No text prompt. These models take one image. They are trained on photos and renders, so a photo made from the sketch usually works better than the line drawing itself.',
  }
];
