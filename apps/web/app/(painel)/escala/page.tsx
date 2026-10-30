'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
/** A escala é montada dentro de cada evento */
export default function Escala() {
  const router = useRouter();
  useEffect(() => { router.replace('/eventos'); }, [router]);
  return null;
}
