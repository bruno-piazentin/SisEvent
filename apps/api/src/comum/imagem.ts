import { BadRequestException } from '@nestjs/common';

// O tipo da imagem vem do navegador e pode mentir: confere pelos primeiros bytes do arquivo
// (a "assinatura" de cada formato) antes de gravar. Assim só imagem de verdade entra como foto.
const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

export function imagemValida(conteudo: Buffer, tipo: string): boolean {
  return !!ASSINATURAS[tipo]?.(conteudo);
}

/** Barra o envio quando o conteúdo não é a imagem declarada */
export function exigirImagem(conteudo: Buffer, tipo: string) {
  if (!imagemValida(conteudo, tipo)) {
    throw new BadRequestException({ codigo: 'validacao', mensagem: 'O arquivo não é uma imagem JPG, PNG ou WEBP válida.' });
  }
}

/** Logo em data URL (data:image/png;base64,...) */
export function dataUrlImagemValida(dataUrl: string): boolean {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  return !!m && imagemValida(Buffer.from(m[2], 'base64'), m[1]);
}
