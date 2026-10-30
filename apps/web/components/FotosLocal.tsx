'use client';
import { GaleriaFotos } from './GaleriaFotos';

/** Fotos do local do evento */
export function FotosLocal({ eventoId, podeEditar }: { eventoId: string; podeEditar: boolean }) {
  return (
    <GaleriaFotos lista={`/eventos/${eventoId}/fotos`} arquivo={(id) => `/fotos/${id}`} podeEditar={podeEditar}
                  vazio="Nenhuma foto do local ainda." exemploLegenda="Ex.: entrada principal, área do estande…" />
  );
}
