import { createContext, useContext } from 'react';
import type { MeResponse } from '../../shared/app-types';

/** The signed-in person, their rooms and server features. refresh() reloads it. */
export interface MeState {
  me: MeResponse;
  refresh: () => Promise<void>;
}

export const MeContext = createContext<MeState | null>(null);

export function useMe(): MeState {
  const v = useContext(MeContext);
  if (!v) throw new Error('useMe outside MeContext');
  return v;
}
