import { ForbiddenException } from '@nestjs/common';
import { UsuarioLogado } from '../auth/decorators';
import { Tx } from '../db/db.service';

/** Supervisor de campo só enxerga os eventos sob sua responsabilidade. */
export function filtroEscopoEventos(u: UsuarioLogado, alias = 'e'): string {
  return u.perfil === 'supervisor'
    ? `EXISTS (SELECT 1 FROM evento_supervisor es WHERE es.evento_id = ${alias}.id AND es.usuario_id = app_usuario())`
    : 'true';
}

export async function garantirAcessoEvento(tx: Tx, u: UsuarioLogado, eventoId: string) {
  if (u.perfil !== 'supervisor') return;
  const ok = await tx.um('SELECT 1 FROM evento_supervisor WHERE evento_id = $1 AND usuario_id = $2', [eventoId, u.id]);
  if (!ok) throw new ForbiddenException({ codigo: 'fora_do_escopo', mensagem: 'Este evento não está sob sua supervisão.' });
}
