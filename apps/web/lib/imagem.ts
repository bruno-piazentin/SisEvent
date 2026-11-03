'use client';

const LADO_MAX = 1600;      // px — suficiente para ver o local com detalhe
const QUALIDADE = 0.82;

/**
 * Reduz a foto no navegador antes do envio (fotos de celular passam de 5 MB).
 * Devolve JPEG em base64 sem o prefixo "data:".
 */
export async function prepararFoto(arquivo: File): Promise<{ nome_arquivo: string; tipo_mime: 'image/jpeg'; base64: string; tamanho: number }> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).');
  const bitmap = await createImageBitmap(arquivo).catch(() => { throw new Error('Não foi possível ler esta imagem. Tente JPG ou PNG.'); });
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';                       // PNG transparente não fica preto no JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', QUALIDADE);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const nome = arquivo.name.replace(/\.[^.]+$/, '') || 'foto';
  return { nome_arquivo: `${nome}.jpg`, tipo_mime: 'image/jpeg', base64, tamanho: Math.round((base64.length * 3) / 4) };
}

const LOGO_LADO_MAX = 512;
const LOGO_MAX = 300_000;   // caracteres da data URL (~220 KB), o mesmo limite da API

/**
 * Logo da empresa: reduz a até 512 px e mantém a transparência (PNG; WEBP se o PNG ficar grande).
 * Aceita também SVG, convertido em imagem. Devolve a data URL completa.
 */
export async function prepararLogo(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (PNG, JPG, WEBP ou SVG).');
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error('Não foi possível ler esta imagem. Tente PNG ou JPG.'); });
    const largura = img.naturalWidth || LOGO_LADO_MAX, altura = img.naturalHeight || LOGO_LADO_MAX;
    const escala = Math.min(1, LOGO_LADO_MAX / Math.max(largura, altura));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round(altura * escala);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const [tipo, qualidade] of [['image/png', undefined], ['image/webp', 0.9], ['image/webp', 0.75]] as const) {
      const dataUrl = canvas.toDataURL(tipo, qualidade);
      // navegador sem WEBP devolve PNG de novo: só aceita se veio no formato pedido
      if (dataUrl.startsWith(`data:${tipo};`) && dataUrl.length <= LOGO_MAX) return dataUrl;
    }
    throw new Error('O logo ficou grande demais mesmo reduzido. Use uma imagem mais simples (até 220 KB).');
  } finally {
    URL.revokeObjectURL(url);
  }
}
