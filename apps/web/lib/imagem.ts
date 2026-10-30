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
