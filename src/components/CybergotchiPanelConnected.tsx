import React from 'react';
import { useCybergotchi } from '../cybergotchi/useCybergotchi.js';
import CybergotchiPanel from './CybergotchiPanel.js';

/**
 * Self-contained wrapper that owns the useCybergotchi hook.
 * Isolates all 500ms animation re-renders to this subtree only,
 * preventing the parent REPL from re-rendering on every tick.
 */
export default function CybergotchiPanelConnected() {
  const cybergotchi = useCybergotchi();
  if (!cybergotchi.config) return null;
  return <CybergotchiPanel config={cybergotchi.config} state={cybergotchi.state} />;
}
